# Universal NFC/QR Emergency Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an emergency-only QR/NFC profile that exposes a minimal lifesaving dataset through dedicated emergency cards and a public scan route.

**Architecture:** Reuse the existing health-card and public-token infrastructure, but gate the emergency route by `card_type = 'emergency'` and build its response from a dedicated minimal-profile library instead of the full portable summary builder.

**Tech Stack:** Hono, D1, TypeScript, Vitest

---

### Task 1: Extend card issuance contract for emergency cards

**Files:**
- Modify: `src/schemas/healthCards.ts`
- Modify: `src/routes/tenant/healthRecord.ts`
- Test: `test/integration/health-cards.test.ts`

- [ ] **Step 1: Add the failing issuance test**

```ts
expect(data.card_type).toBe('emergency');
expect(data.profile_kind).toBe('emergency');
expect(data.public_url).toContain('/api/public/emergency/');
expect(data.qr_payload).toBe(data.public_url);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/integration/health-cards.test.ts`
Expected: FAIL because `emergency` card type and emergency URL metadata are not supported yet

- [ ] **Step 3: Implement schema + response changes**

```ts
card_type: z.enum(['hospital', 'global', 'emergency']).default('hospital')
```

```ts
const publicPath = data.card_type === 'emergency'
  ? `/api/public/emergency/${rawToken}`
  : `/api/public/summary/${rawToken}`;
```

- [ ] **Step 4: Run the focused test**

Run: `pnpm vitest run test/integration/health-cards.test.ts`
Expected: PASS for the new issuance contract

- [ ] **Step 5: Commit**

```bash
git add src/schemas/healthCards.ts src/routes/tenant/healthRecord.ts test/integration/health-cards.test.ts
git commit -m "feat: add emergency card issuance metadata"
```

### Task 2: Build the emergency profile library

**Files:**
- Create: `src/lib/emergency-profile.ts`
- Test: `test/public-emergency-profile.test.ts`

- [ ] **Step 1: Add the failing emergency profile test**

```ts
expect(body.profile.patient.blood_group).toBe('A+');
expect(body.profile.allergies[0].allergen).toBe('Penicillin');
expect(body.profile.emergency_contacts[0].phone).toBe('01700000000');
expect(body.profile.current_medications[0].medication_name).toBe('Warfarin');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run test/public-emergency-profile.test.ts`
Expected: FAIL because the route and builder do not exist

- [ ] **Step 3: Implement the builder**

```ts
export async function buildEmergencyHealthProfile(DB, tenantId, patientId) {
  // patient demographics
  // top severe allergies
  // active meds (names only)
  // active problems
  // emergency contacts
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run test/public-emergency-profile.test.ts`
Expected: still FAIL on missing route wiring, but builder compiles

- [ ] **Step 5: Commit**

```bash
git add src/lib/emergency-profile.ts test/public-emergency-profile.test.ts
git commit -m "feat: add emergency profile builder"
```

### Task 3: Add the public emergency scan route

**Files:**
- Modify: `src/routes/public/healthRecord.ts`
- Test: `test/public-emergency-profile.test.ts`
- Test: `test/public-health-record-rate-limit.test.ts`

- [ ] **Step 1: Add route expectations to the failing tests**

```ts
expect(res.status).toBe(200);
expect(body.access_type).toBe('qr_scan');
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm vitest run test/public-emergency-profile.test.ts test/public-health-record-rate-limit.test.ts`
Expected: FAIL because `/public/emergency/:token` does not exist

- [ ] **Step 3: Implement the route with emergency-card gating**

```ts
publicHealthRecordRoutes.get('/emergency/:token', async (c) => {
  // validate token
  // throttle
  // join token -> health_cards and require emergency + active
  // buildEmergencyHealthProfile
  // update access count
  // audit as qr_scan
});
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run test/public-emergency-profile.test.ts test/public-health-record-rate-limit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/public/healthRecord.ts test/public-emergency-profile.test.ts test/public-health-record-rate-limit.test.ts
git commit -m "feat: add public emergency scan route"
```

### Task 4: Update docs and run verification

**Files:**
- Modify: `ozzyl_hms_assessment.md`
- Modify: `ozzyl-health-ecosystem-vision.md`
- Modify: `docs/superpowers/specs/2026-04-10-emergency-profile-design.md`

- [ ] **Step 1: Update assessment and vision progress**

```md
- Universal NFC Emergency Profile | 🟡 Basic backend done | PHASE 2
```

- [ ] **Step 2: Run focused verification**

Run: `pnpm vitest run test/public-emergency-profile.test.ts test/public-health-record-rate-limit.test.ts test/integration/health-cards.test.ts`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add ozzyl_hms_assessment.md ozzyl-health-ecosystem-vision.md docs/superpowers/specs/2026-04-10-emergency-profile-design.md docs/superpowers/plans/2026-04-10-emergency-profile.md
git commit -m "docs: update emergency profile progress"
```
