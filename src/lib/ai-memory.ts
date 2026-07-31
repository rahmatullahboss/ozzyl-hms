/**
 * AI Memory Service
 *
 * Uses Cloudflare Vectorize + Workers AI embeddings to give the AI
 * a "memory" of past interactions and doctor preferences.
 *
 * Flow:
 * 1. Doctor makes an AI request → response is generated
 * 2. Interaction is saved to D1 (ai_interactions table)
 * 3. Input summary is embedded via Workers AI (bge-base-en-v1.5)
 * 4. Embedding is stored in Vectorize with metadata
 * 5. On next similar request, we query Vectorize for past interactions
 * 6. Past context is injected into the system prompt
 * 7. Doctor feedback (accepted/rejected/modified) updates preferences
 */

import type { Env } from '../types';

// ─── Types ──────────────────────────────────────────────────────────────────

export type AIFeature =
  | 'prescription_assist'
  | 'diagnosis_suggest'
  | 'billing_from_notes'
  | 'triage'
  | 'summarize_note'
  | 'interpret_lab'
  | 'dashboard_insights'
  | 'patient_health_planner';

export type UserAction = 'accepted' | 'rejected' | 'modified' | 'pending';

export interface InteractionRecord {
  id: number;
  tenant_id: string;
  user_id: string;
  feature: AIFeature;
  input_summary: string;
  ai_response: string;
  user_action: UserAction;
  user_modification: string | null;
  vector_id: string | null;
  created_at: string;
}

export interface DoctorPreference {
  preference_type: string;
  preference_key: string;
  preference_value: string;
  frequency: number;
}

export interface SimilarInteraction {
  score: number;
  inputSummary: string;
  aiResponse: string;
  userAction: UserAction;
  userModification: string | null;
}

// ─── Embedding Generation (Workers AI) ──────────────────────────────────────

interface EmbeddingResponse {
  shape: number[];
  data: number[][];
}

async function generateEmbedding(
  ai: Ai,
  text: string,
): Promise<number[]> {
  const result = await ai.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  }) as EmbeddingResponse;

  if (!result.data?.[0]) {
    throw new Error('Failed to generate embedding');
  }
  return result.data[0];
}

// ─── Save Interaction ───────────────────────────────────────────────────────

export async function saveInteraction(
  env: Env,
  tenantId: string,
  userId: string,
  feature: AIFeature,
  inputSummary: string,
  aiResponse: string,
): Promise<number> {
  // 1. Insert into D1
  const { meta } = await env.DB.prepare(
    `INSERT INTO ai_interactions (tenant_id, user_id, feature, input_summary, ai_response)
     VALUES (?, ?, ?, ?, ?)`,
  ).bind(tenantId, userId, feature, inputSummary, aiResponse).run();

  const interactionId = meta.last_row_id;

  // 2. Generate embedding & store in Vectorize (non-blocking)
  try {
    if (env.AI && env.VECTORIZE) {
      const vectorId = `${tenantId}:${feature}:${interactionId}`;
      const embedding = await generateEmbedding(env.AI, inputSummary);

      await env.VECTORIZE.upsert([{
        id: vectorId,
        values: embedding,
        metadata: {
          tenantId,
          userId,
          feature,
          interactionId: interactionId.toString(),
        },
      }]);

      // Update D1 with vector_id
      await env.DB.prepare(
        `UPDATE ai_interactions SET vector_id = ? WHERE id = ? AND tenant_id = ?`,
      ).bind(vectorId, interactionId, tenantId).run();
    }
  } catch (err) {
    // Don't fail the main request if vectorization fails
    console.error('[AI Memory] Failed to vectorize interaction:', err);
  }

  return interactionId;
}

// ─── Find Similar Past Interactions ─────────────────────────────────────────

export async function findSimilarInteractions(
  env: Env,
  tenantId: string,
  feature: AIFeature,
  inputSummary: string,
  topK: number = 5,
): Promise<SimilarInteraction[]> {
  if (!env.AI || !env.VECTORIZE) return [];

  try {
    const embedding = await generateEmbedding(env.AI, inputSummary);

    const matches = await env.VECTORIZE.query(embedding, {
      topK,
      returnMetadata: 'all',
      filter: {
        tenantId,
        feature,
      },
    });

    if (!matches.matches?.length) return [];

    // Extract interaction IDs from Vectorize metadata
    const matchMap = new Map<string, number>(); // interactionId -> score
    for (const m of matches.matches) {
      const iid = m.metadata?.interactionId as string;
      if (iid) matchMap.set(iid, m.score);
    }

    const interactionIds = [...matchMap.keys()];
    if (!interactionIds.length) return [];

    const placeholders = interactionIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT id, input_summary, ai_response, user_action, user_modification
       FROM ai_interactions
       WHERE id IN (${placeholders}) AND tenant_id = ? AND user_action != 'pending'`,
    ).bind(...interactionIds, tenantId).all<{
      id: number;
      input_summary: string;
      ai_response: string;
      user_action: UserAction;
      user_modification: string | null;
    }>();

    // Build results using Map lookup (correct correlation, not index-based)
    return results
      .map((r) => ({
        score: matchMap.get(r.id.toString()) ?? 0,
        inputSummary: r.input_summary,
        aiResponse: r.ai_response,
        userAction: r.user_action,
        userModification: r.user_modification,
      }))
      .sort((a, b) => b.score - a.score);
  } catch (err) {
    console.error('[AI Memory] Failed to find similar interactions:', err);
    return [];
  }
}

// ─── Record Doctor Feedback ─────────────────────────────────────────────────

export async function recordFeedback(
  env: Env,
  tenantId: string,
  interactionId: number,
  action: UserAction,
  modification?: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE ai_interactions
     SET user_action = ?, user_modification = ?, updated_at = datetime('now')
     WHERE id = ? AND tenant_id = ?`,
  ).bind(action, modification ?? null, interactionId, tenantId).run();

  // If the doctor modified the suggestion, learn the preference
  if (action === 'modified' && modification) {
    const interaction = await env.DB.prepare(
      `SELECT user_id, feature, input_summary FROM ai_interactions WHERE id = ? AND tenant_id = ?`,
    ).bind(interactionId, tenantId).first<{
      user_id: string; feature: string; input_summary: string;
    }>();

    if (interaction) {
      await upsertDoctorPreference(
        env,
        tenantId,
        interaction.user_id,
        `${interaction.feature}_correction`,
        interaction.input_summary.substring(0, 200),
        modification.substring(0, 500),
      );
    }
  }
}

// ─── Doctor Preferences ─────────────────────────────────────────────────────

async function upsertDoctorPreference(
  env: Env,
  tenantId: string,
  doctorId: string,
  preferenceType: string,
  key: string,
  value: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ai_doctor_preferences (tenant_id, doctor_id, preference_type, preference_key, preference_value, frequency)
     VALUES (?, ?, ?, ?, ?, 1)
     ON CONFLICT (tenant_id, doctor_id, preference_type, preference_key)
     DO UPDATE SET preference_value = ?, frequency = frequency + 1, last_used_at = datetime('now')`,
  ).bind(tenantId, doctorId, preferenceType, key, value, value).run();
}

export async function getDoctorPreferences(
  env: Env,
  tenantId: string,
  doctorId: string,
  feature?: string,
): Promise<DoctorPreference[]> {
  const query = feature
    ? `SELECT preference_type, preference_key, preference_value, frequency
       FROM ai_doctor_preferences
       WHERE tenant_id = ? AND doctor_id = ? AND preference_type LIKE ?
       ORDER BY frequency DESC, last_used_at DESC LIMIT 20`
    : `SELECT preference_type, preference_key, preference_value, frequency
       FROM ai_doctor_preferences
       WHERE tenant_id = ? AND doctor_id = ?
       ORDER BY frequency DESC, last_used_at DESC LIMIT 20`;

  const params = feature
    ? [tenantId, doctorId, `${feature}%`]
    : [tenantId, doctorId];

  const { results } = await env.DB.prepare(query).bind(...params).all<DoctorPreference>();
  return results;
}

// ─── Build Context from Memory ──────────────────────────────────────────────

export async function buildMemoryContext(
  env: Env,
  tenantId: string,
  userId: string,
  feature: AIFeature,
  inputSummary: string,
): Promise<string> {
  const parts: string[] = [];

  // 1. Get similar past interactions
  const similar = await findSimilarInteractions(env, tenantId, feature, inputSummary, 3);
  if (similar.length > 0) {
    const acceptedOrModified = similar.filter((s) => s.userAction !== 'rejected');
    if (acceptedOrModified.length > 0) {
      parts.push('PAST INTERACTIONS (this doctor has previously handled similar cases):');
      for (const s of acceptedOrModified) {
        if (s.userAction === 'modified') {
          parts.push(`- For "${s.inputSummary}", the doctor modified AI suggestion to: ${s.userModification}`);
        } else {
          parts.push(`- For "${s.inputSummary}", the doctor accepted the AI suggestion.`);
        }
      }
    }

    const rejected = similar.filter((s) => s.userAction === 'rejected');
    if (rejected.length > 0) {
      parts.push('REJECTED SUGGESTIONS (avoid these patterns):');
      for (const s of rejected) {
        parts.push(`- Suggestion for "${s.inputSummary}" was rejected.`);
      }
    }
  }

  // 2. Get doctor-specific preferences
  const prefs = await getDoctorPreferences(env, tenantId, userId, feature);
  if (prefs.length > 0) {
    parts.push('DOCTOR PREFERENCES (learned from past interactions):');
    for (const p of prefs) {
      parts.push(`- ${p.preference_key}: ${p.preference_value} (used ${p.frequency} times)`);
    }
  }

  return parts.length > 0
    ? `\n\n--- PERSONALIZED CONTEXT ---\n${parts.join('\n')}\n--- END CONTEXT ---\n`
    : '';
}
