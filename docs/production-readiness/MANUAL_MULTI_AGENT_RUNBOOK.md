# HMS Manual Multi-Agent Runbook

এই runbook সেই environment-এর জন্য যেখানে agent নিজে sub-agent তৈরি করতে পারে না। Owner আলাদা আলাদা agent session খুলে manualভাবে task assign করবেন।

## 1. সবচেয়ে গুরুত্বপূর্ণ নিয়ম

- একজন worker agent = একটি task ID
- প্রতিটি worker = আলাদা branch/worktree
- worker verified branch তৈরি করে থামবে
- worker local `main`-এ merge করবে না
- একজন আলাদা integration agent একবারে একটি task merge করবে
- dependency integrate হওয়ার আগে dependent task শুরু করবেন না
- remote push/deploy আলাদা explicit instruction ছাড়া হবে না

## 2. চারটি role

### Owner / Dispatcher

আপনি task assign, dependency check এবং integration order নিয়ন্ত্রণ করবেন।

### Worker Agent

একটি task review/fix/test/commit করবে এবং `READY FOR INTEGRATION` বলে থামবে।

### Integration Agent

Worker branch review করে serialভাবে local `main`-এ merge করবে, post-merge test চালাবে এবং shared status/tracker update করবে।

### Wave Verification Agent

Wave-এর সব task integrate হওয়ার পরে integrated workflow ও wave gate যাচাই করবে।

একই agent session-কে পরে অন্য role দিতে পারেন, কিন্তু একই সময়ে দুই role দেবেন না।

---

## 3. Copy-paste command

### Worker-কে

```text
W0-01 করো
```

Root `agents.md` অনুযায়ী এর অর্থ worker mode। Agent branch/worktree তৈরি করবে, review/fix/test/commit করবে এবং main-এ merge না করে থামবে।

আরও explicitভাবে বলতে চাইলে:

```text
W0-01 worker mode-এ করো। একটি isolated branch/worktree ব্যবহার করবে। Review, fix, tests, evidence এবং commits complete করে READY FOR INTEGRATION হলে থামবে। Main merge, push বা deploy করবে না।
```

### Integration Agent-কে

```text
W0-01 integrate করো
```

### Wave Verification Agent-কে

```text
W0 verify করো
```

### Status জানতে

```text
Live branches/worktrees, TASK_STATUS এবং run reports দেখে এখন কোন task worker-ready, integration-ready বা blocked বলো।
```

---

## 4. একটি batch কীভাবে চালাবেন

1. Parallel-safe taskগুলো আলাদা worker agent-কে দিন।
2. প্রত্যেক worker-এর `READY FOR INTEGRATION` report অপেক্ষা করুন।
3. Integration Agent-কে একবারে একটি task integrate করতে বলুন।
4. প্রতিটি integration সফল হওয়ার পরে পরের dependent worker শুরু করুন।
5. Wave-এর সব task integrate হলে wave verification চালান।

Workerরা parallel হতে পারে। Integration সবসময় serial হবে।

---

# Wave 0 — Release Foundation

## Batch W0-A — parallel

একসঙ্গে দুই agent:

```text
Agent A: W0-01 করো
Agent B: W0-03 করো
```

- W0-01: authentication, tenant, session, MFA
- W0-03: hospital setup, master data, branch/settings

এরা সাধারণত আলাদা domain। Shared central files প্রয়োজন হলে ownership report-এ লিখতে হবে।

## W0-A integration — serial

```text
Integration Agent: W0-01 integrate করো
```

সফল হলে:

```text
Integration Agent: W0-03 integrate করো
```

## Batch W0-B — W0-01 ও W0-03 integration-এর পরে parallel

```text
Agent C: W0-02 করো
Agent D: W0-04 করো
Agent E: W0-05 করো
```

- W0-02 এখন W0-01 auth/session foundation-এর ওপর কাজ করতে পারবে
- W0-04 এখন W0-03 clean-bootstrap evidence ব্যবহার করতে পারবে
- W0-05 এখন W0-03 representative dataset ব্যবহার করে restore drill করতে পারবে

## W0-B integration — serial

Recommended order:

```text
W0-02 integrate করো
W0-04 integrate করো
W0-05 integrate করো
```

## W0 final

```text
W0 verify করো
```

W0 pass না করলে normal production-readiness waves final pass হিসেবে এগোবে না।

---

# Wave 1 — First Patient and Revenue Journey

Wave 0 integrated pass হওয়ার পরে শুরু করুন।

## Serial foundation

```text
Agent A: W1-01 করো
```

READY হলে:

```text
W1-01 integrate করো
```

তারপর:

```text
Agent B: W1-02 করো
```

READY হলে:

```text
W1-02 integrate করো
```

## Batch W1-A — parallel

W1-02 integrate হওয়ার পরে:

```text
Agent C: W1-03 করো
Agent D: W1-05 করো
```

- W1-03: doctor/clinical workflow
- W1-05: billing/payment/refund

Integration serial:

```text
W1-03 integrate করো
W1-05 integrate করো
```

## Batch W1-B — parallel

```text
Agent E: W1-04 করো
Agent F: W1-06 করো
```

- W1-04 depends on W1-03
- W1-06 depends on W1-05

Integration serial:

```text
W1-04 integrate করো
W1-06 integrate করো
```

Final:

```text
W1 verify করো
```

---

# Wave 2 — Diagnostics, Medicine, Stock and Books

W1 patient, billing এবং cash foundation integrate হওয়ার পরে সবচেয়ে নিরাপদ।

## Batch W2-A — parallel

```text
Agent A: W2-01 করো
Agent B: W2-04 করো
Agent C: W2-05 করো
```

- W2-01: Laboratory/LIS
- W2-04: Pharmacy
- W2-05: Inventory/procurement

Integration serial:

```text
W2-01 integrate করো
W2-04 integrate করো
W2-05 integrate করো
```

## Batch W2-B — parallel

W2-01 এবং W2-05 integrate হওয়ার পরে:

```text
Agent D: W2-02 করো
Agent E: W2-03 করো
```

- W2-02 analyzer depends on W2-01
- W2-03 reagent QA should use stable lab/inventory behavior

Integration serial:

```text
W2-02 integrate করো
W2-03 integrate করো
```

## W2 accounting — serial last

```text
Agent F: W2-06 করো
```

এটি billing, cash, pharmacy, inventory এবং applicable source postings reconcile করবে। READY হলে:

```text
W2-06 integrate করো
```

Final:

```text
W2 verify করো
```

---

# Wave 3 — Inpatient and Advanced Care

W1 clinical/billing এবং applicable W2 stock/diagnostic foundation integrate হওয়ার পরে শুরু করুন।

## Batch W3-A — parallel

```text
Agent A: W3-01 করো
Agent B: W3-03 করো
Agent C: W3-04 করো
```

Integration serial:

```text
W3-01 integrate করো
W3-03 integrate করো
W3-04 integrate করো
```

## W3 nursing — after IPD

```text
Agent D: W3-02 করো
```

W3-02 depends on W3-01 admission/bed/ward foundation। READY হলে:

```text
W3-02 integrate করো
```

Final:

```text
W3 verify করো
```

---

# Wave 4 — Workforce, Portal, Insurance and Support

Hospital scope আগে লিখিতভাবে ঠিক করুন। Included নয় এমন module `N/A FOR THIS HOSPITAL` হিসেবে controlledভাবে disable/document করতে হবে। Wave 0 অবশ্যই integrated PASS হতে হবে, এবং নিচের task-specific foundation local `main`-এ integrated না থাকলে সেই W4 worker শুরু করবেন না:

- W4-01 payroll posting scope হলে W2-06 accounting
- W4-02-এর জন্য W1-05 billing এবং W2-06 accounting
- W4-03-এর জন্য applicable W1/W3 clinical records
- W4-04-এর জন্য W1-01 patient identity, W0-01 auth এবং consent foundation
- W4-05-এর জন্য provider configuration/scope decision
- W4-06/W4-07-এর জন্য accountable hospital-scope decision

Dependency satisfied taskগুলোর মধ্যে একসঙ্গে সর্বোচ্চ চার worker রাখুন।

## Batch W4-A — parallel

```text
Agent A: W4-01 করো
Agent B: W4-02 করো
Agent C: W4-03 করো
Agent D: W4-04 করো
```

প্রয়োজনীয় foundation:

- W4-01 payroll posting হলে accounting stable
- W4-02 billing/accounting stable
- W4-03 clinical records stable
- W4-04 patient identity, consent এবং portal auth stable

Integration serial:

```text
W4-01 integrate করো
W4-02 integrate করো
W4-03 integrate করো
W4-04 integrate করো
```

## Batch W4-B — parallel

```text
Agent E: W4-05 করো
Agent F: W4-06 করো
Agent G: W4-07 করো
```

Integration serial:

```text
W4-05 integrate করো
W4-06 integrate করো
W4-07 integrate করো
```

Final:

```text
W4 verify করো
```

---

# Wave 5 — Analytics, Interoperability and AI

Source modules stable এবং hospital scope clear হওয়ার পরে শুরু করুন।

## Batch W5-A — parallel with strict file ownership

```text
Agent A: W5-01 করো
Agent B: W5-02 করো
Agent C: W5-03 করো
```

- W5-01 source data ও ledger reconciliation প্রয়োজন
- W5-02 auth, consent, export boundary প্রয়োজন
- W5-03 core safety, governance, human review এবং audit প্রয়োজন

Shared export/auth files touch করলে agents আগে branch report-এ ownership conflict লিখবে।

Integration serial:

```text
W5-01 integrate করো
W5-02 integrate করো
W5-03 integrate করো
```

Final:

```text
W5 verify করো
```

---

# Final Gates — strictly serial

Included hospital-scope tasks এবং required wave verification pass হওয়ার পরে:

```text
Agent A: FINAL-01 করো
```

READY হলে:

```text
FINAL-01 integrate করো
```

তারপর:

```text
Agent B: FINAL-02 করো
```

READY হলে:

```text
FINAL-02 integrate করো
```

তারপর:

```text
FINAL verify করো
```

`FUTURE-01` core HMS production evidence stable হওয়ার পরে আলাদা future gate:

```text
FUTURE-01 করো
FUTURE-01 integrate করো
```

---

## 5. কোন কাজ parallel দেবেন না

নিচের pairগুলো prerequisite integration ছাড়া parallel দেবেন না:

- W0-01 এবং W0-02 shared auth/permission implementation
- W0-03 final evidence ছাড়া W0-04/W0-05 final execution
- W1-01-এর আগে W1-02
- W1-02-এর আগে W1-03/W1-05
- W1-03-এর আগে W1-04
- W1-05-এর আগে W1-06
- W2-01-এর আগে W2-02
- W2 source modules-এর আগে W2-06
- W3-01-এর আগে W3-02
- Source modules stable হওয়ার আগে W5-01 final reconciliation
- FINAL-01-এর আগে FINAL-02

---

## 6. High-conflict files

একই সময়ে দুই worker নিচের file/domain edit করবে না:

- `src/index.ts`
- central auth/session middleware
- permission catalogs
- shared schema/migration registry
- `package.json` এবং lockfile
- deployment configuration
- `TASK_STATUS.md`
- `docs/HMS_PRODUCTION_READINESS_TRACKER.md`
- `CURRENT_NEXT_TASK.md`

Shared status/tracker files শুধু integration agent update করবে।

---

## 7. Recommended concurrency

- Wave 0: সর্বোচ্চ 3 worker; প্রথম batch-এ 2 worker
- Wave 1: সর্বোচ্চ 2 worker
- Wave 2: সর্বোচ্চ 3 worker
- Wave 3: সর্বোচ্চ 3 worker
- Wave 4: সর্বোচ্চ 4 worker
- Wave 5: সর্বোচ্চ 3 worker
- Integration: সবসময় 1 agent
- Final gates: সবসময় serial

কম agent থাকলে একই sequence serialভাবে চালান। বেশি agent থাকলেও dependency ভাঙবেন না।

---

## 8. Worker report দেখে কী যাচাই করবেন

Integration command দেওয়ার আগে নিশ্চিত করুন worker বলেছে:

- `READY FOR INTEGRATION`
- exact branch এবং worktree
- final commit SHA
- tests এবং exact results
- run report path
- Critical/High finding নেই
- `Not merged to local main`
- `Nothing pushed or deployed`

এগুলোর কোনোটি না থাকলে worker-কে বলুন:

```text
তোমার task handoff protocol অনুযায়ী complete করো এবং READY FOR INTEGRATION report দাও। Main merge করবে না।
```

---

## 9. Owner-এর দৈনিক checklist

1. কোন task integrated এবং কোন task শুধু branch-ready দেখুন।
2. Dependency satisfied taskগুলো worker-কে assign করুন।
3. Duplicate task assignment এড়ান।
4. Worker report সংগ্রহ করুন।
5. Integration একবারে একটি করুন।
6. Integration failure হলে নতুন dependent worker শুরু করবেন না।
7. Wave শেষে wave verification চালান।
8. Push/deploy সিদ্ধান্ত আলাদা রাখুন।
