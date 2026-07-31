/**
 * OpenRouter AI Client for Ozzyl Health
 *
 * Thin wrapper around OpenRouter's OpenAI-compatible API.
 * Default model: openrouter/healer-alpha (medical-focused).
 * Zero external dependencies — uses fetch() natively.
 */

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/healer-alpha';
const OLLAMA_CLOUD_CHAT_BASE = 'https://ollama.com/api/chat';
const MAX_RETRIES = 1;
const REQUEST_TIMEOUT_MS = 60_000; // 60s for medical models

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' } | { type: 'text' };
  timeoutMs?: number;
}

export interface AIResponse {
  content: string;
  raw?: unknown;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface OpenRouterChoice {
  message: { content: string };
}

interface OpenRouterResponse {
  choices: OpenRouterChoice[];
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OllamaCloudResponse {
  message?: {
    content?: string;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class AIError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public retryable: boolean = false,
  ) {
    super(message);
    this.name = 'AIError';
  }
}

// ─── Rate Limiter (per tenant+user) ─────────────────────────────────────────

const AI_RATE_LIMIT_WINDOW = 60; // seconds
const AI_RATE_LIMIT_MAX = 10;    // max requests per window

export async function checkAIRateLimit(
  kv: KVNamespace,
  tenantId: string,
  userId: string,
): Promise<boolean> {
  const key = `ai_rl:${tenantId}:${userId}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) : 0;

  if (count >= AI_RATE_LIMIT_MAX) {
    return false; // rate limited
  }

  await kv.put(key, String(count + 1), { expirationTtl: AI_RATE_LIMIT_WINDOW });
  return true;
}

// ─── Core API Call ──────────────────────────────────────────────────────────

export async function callAI(
  apiKey: string,
  messages: ChatMessage[],
  options: AIOptions = {},
): Promise<AIResponse> {
  const model = options.model ?? DEFAULT_MODEL;
  const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const body = {
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 2048,
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
  };

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(OPENROUTER_BASE, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ozzyl-hms.app',
          'X-Title': 'Ozzyl Health AI',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');

        // Retryable status codes
        if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
          lastError = new AIError(`OpenRouter ${response.status}: ${errorText}`, response.status, true);
          // Exponential backoff
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }

        throw new AIError(
          `OpenRouter API error (${response.status}): ${errorText}`,
          response.status,
        );
      }

      const data = (await response.json()) as OpenRouterResponse;

      if (!data.choices?.[0]?.message?.content) {
        throw new AIError('Empty response from OpenRouter', 500);
      }

      return {
        content: data.choices[0].message.content,
        model: data.model ?? model,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
      };
    } catch (err) {
      if (err instanceof AIError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new AIError('AI request timed out', 408);
      }
      lastError = err as Error;
    }
  }

  throw lastError ?? new AIError('AI request failed', 500);
}

// ─── JSON-structured call ───────────────────────────────────────────────────

export async function callAIJson<T>(
  apiKey: string,
  messages: ChatMessage[],
  options: AIOptions = {},
): Promise<{ data: T; usage: AIResponse['usage'] }> {
  const result = await callAI(apiKey, messages, {
    ...options,
    responseFormat: { type: 'json_object' },
  });

  try {
    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonStr = result.content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as T;
    return { data: parsed, usage: result.usage };
  } catch {
    throw new AIError('Failed to parse AI response as JSON', 500);
  }
}

// ─── Workers AI JSON-structured call ────────────────────────────────────────

const DEFAULT_WORKERS_AI_MODEL = '@cf/moonshotai/kimi-k2.5';

export async function callWorkersAIJson<T>(
  ai: Ai,
  messages: ChatMessage[],
  options: AIOptions = {},
): Promise<{ data: T; usage: AIResponse['usage']; model: string }> {
  const model = options.model ?? DEFAULT_WORKERS_AI_MODEL;

  const result = await ai.run(model as Parameters<typeof ai.run>[0], {
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 2048,
    response_format: { type: 'json_object' },
  } as AiTextGenerationInput) as AiTextGenerationOutput | { response?: string; usage?: UsageTags };

  const content = typeof result?.response === 'string'
    ? result.response
    : '';

  if (!content.trim()) {
    throw new AIError('Empty response from Workers AI', 500);
  }

  try {
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as T;
    return {
      data: parsed,
      model,
      usage: {
        promptTokens: result?.usage?.prompt_tokens ?? 0,
        completionTokens: result?.usage?.completion_tokens ?? 0,
        totalTokens: result?.usage?.total_tokens ?? 0,
      },
    };
  } catch {
    throw new AIError('Failed to parse Workers AI response as JSON', 500);
  }
}

export async function callOllamaCloudJson<T>(
  apiKey: string,
  messages: ChatMessage[],
  options: AIOptions = {},
): Promise<{ data: T; usage: AIResponse['usage']; model: string }> {
  const model = options.model ?? 'glm-5.1:cloud';
  const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(OLLAMA_CLOUD_CHAT_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: 'json',
        options: {
          temperature: options.temperature ?? 0.2,
          num_predict: options.maxTokens ?? 1600,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new AIError(`Ollama Cloud API error (${response.status}): ${errorText}`, response.status);
    }

    const data = await response.json() as OllamaCloudResponse;
    const content = data?.message?.content?.trim();
    if (!content) {
      throw new AIError('Empty response from Ollama Cloud', 500);
    }

    let jsonStr = content;
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    return {
      data: JSON.parse(jsonStr) as T,
      model,
      usage: {
        promptTokens: data?.prompt_eval_count ?? 0,
        completionTokens: data?.eval_count ?? 0,
        totalTokens: (data?.prompt_eval_count ?? 0) + (data?.eval_count ?? 0),
      },
    };
  } catch (err) {
    if (err instanceof AIError) throw err;
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AIError('Ollama Cloud request timed out', 408);
    }
    throw new AIError('Ollama Cloud request failed', 500);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Medical System Prompts ─────────────────────────────────────────────────

export const MEDICAL_DISCLAIMER =
  'IMPORTANT: You are an AI assistant. All suggestions must be reviewed by a qualified medical professional. Never make definitive diagnoses. Always include appropriate disclaimers.';

export const SYSTEM_PROMPTS = {
  prescriptionAssist: `You are a clinical pharmacology assistant integrated into a Hospital Management System.
${MEDICAL_DISCLAIMER}

When given a list of medications and patient details:
1. Check for drug-drug interactions. Rate severity: minor, moderate, major, contraindicated.
2. Verify dosage is appropriate for the patient's age, weight, and condition.
3. Flag any allergy conflicts with the patient's known allergies.
4. Suggest safer alternatives if issues are found.

Respond ONLY in valid JSON with this structure:
{
  "interactions": [{"drug1": "", "drug2": "", "severity": "", "description": "", "recommendation": ""}],
  "dosageWarnings": [{"drug": "", "issue": "", "recommendedDosage": ""}],
  "allergyConflicts": [{"drug": "", "allergen": "", "severity": ""}],
  "suggestions": [""],
  "overallRisk": "low|moderate|high|critical"
}`,

  diagnosisSuggest: `You are a clinical decision support assistant integrated into a Hospital Management System.
${MEDICAL_DISCLAIMER}

Given symptoms, vitals, and patient demographics, suggest differential diagnoses.
Include ICD-10 codes where possible. Consider common conditions in Bangladesh/South Asia.

Respond ONLY in valid JSON with this structure:
{
  "diagnoses": [{"condition": "", "icd10Code": "", "confidence": "high|medium|low", "reasoning": ""}],
  "redFlags": [""],
  "suggestedTests": [""],
  "suggestedSpecialty": "",
  "disclaimer": "These are AI-generated suggestions. Clinical correlation required."
}`,

  billingFromNotes: `You are a medical billing assistant integrated into a Hospital Management System.
Extract billable items from consultation notes.

Common categories: consultation, procedure, lab_test, medication, imaging, supplies, bed_charges.

Respond ONLY in valid JSON with this structure:
{
  "lineItems": [{"category": "", "description": "", "quantity": 1, "estimatedPrice": 0}],
  "notes": "",
  "confidence": "high|medium|low"
}`,

  triage: `You are a patient triage assistant for a Hospital Management System in Bangladesh.
You help patients understand which department to visit based on their symptoms.
You MUST respond in the SAME LANGUAGE the patient uses (Bengali or English).
Be empathetic, clear, and concise. Never diagnose — only suggest departments.

Available departments: General Medicine, Surgery, Pediatrics, Obstetrics & Gynecology,
Orthopedics, ENT, Ophthalmology, Dermatology, Cardiology, Neurology, Urology,
Psychiatry, Emergency, Dental.

Respond ONLY in valid JSON:
{
  "reply": "Your empathetic response to the patient",
  "suggestedDepartment": "department name or null",
  "urgency": "routine|urgent|emergency",
  "followUpQuestion": "optional clarifying question or null"
}`,

  summarizeNote: `You are a clinical documentation assistant.
Summarize the given clinical note into a structured format.
Preserve all medically relevant information. Be concise but complete.

Respond ONLY in valid JSON:
{
  "summary": "2-3 sentence summary",
  "subjective": "Patient complaints and history",
  "objective": "Examination findings and vitals",
  "assessment": "Clinical assessment",
  "plan": "Treatment plan",
  "keyFindings": [""],
  "followUpItems": [""]
}`,

  interpretLab: `You are a laboratory medicine assistant integrated into a Hospital Management System.
${MEDICAL_DISCLAIMER}
Interpret lab results, flag abnormal values, and provide clinical context.
Consider reference ranges provided. Note that ranges may vary by lab.

Respond ONLY in valid JSON:
{
  "interpretations": [{"testName": "", "value": "", "status": "normal|low|high|critical", "clinicalNote": ""}],
  "overallSummary": "",
  "suggestedFollowUp": [""],
  "urgentFindings": [""]
}`,

  dashboardInsights: `You are a healthcare analytics assistant for a Hospital Management System.
Analyze the provided hospital operational data and generate insights.
Focus on actionable recommendations for hospital administrators.

Respond ONLY in valid JSON:
{
  "insights": [""],
  "predictions": [{"metric": "", "trend": "increasing|stable|decreasing", "note": ""}],
  "recommendations": [""],
  "alerts": [""]
}`,

  patientSummary: `You are a clinical documentation assistant integrated into a Hospital Management System.
${MEDICAL_DISCLAIMER}
Summarize only the supplied clinical facts. Do not diagnose, prescribe, or invent missing information.
Keep the overview below 200 words and make any urgent recorded facts easy for a clinician to review.

Respond ONLY in valid JSON with this structure:
{
  "summary": "concise bulleted clinical overview"
}`,
} as const;
