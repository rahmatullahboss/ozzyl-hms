# HMS Owner Task Commands

এই environment-এ sub-agent নেই। আপনি আলাদা আলাদা agent session খুলে worker task assign করবেন এবং পরে আলাদা integration command দেবেন।

## 1. Worker command

```text
W0-01 করো
```

এর অর্থ:

- একটি task ID
- একটি isolated branch/worktree
- review, fix, tests, evidence, commits
- শেষে `READY FOR INTEGRATION`
- local `main` merge নয়
- push/deploy নয়

আরও explicit command:

```text
W0-01 worker mode-এ করো। Review, fix, tests, evidence ও commits complete করে READY FOR INTEGRATION হলে থামবে। Main merge, push বা deploy করবে না।
```

## 2. Integration command

Worker ready হওয়ার পরে একজন integration agent-কে বলুন:

```text
W0-01 integrate করো
```

Integration agent:

- worker branch ও run report review করবে
- dependency check করবে
- shared merge lock নেবে
- current local `main`-এর সঙ্গে reconcile করবে
- tests rerun করবে
- serialভাবে merge করবে
- post-merge verification চালাবে
- `TASK_STATUS.md`, tracker ও run report update করবে
- cleanup করবে

একই সময়ে শুধু একজন integration agent চালাবেন।

## 3. Wave verification command

Wave-এর required taskগুলো integrate হওয়ার পরে:

```text
W0 verify করো
```

Wave verifier unfinished task implement করবে না; integrated wave evidence যাচাই করবে।

---

## 4. Wave 0 exact sequence

### Parallel Batch 1

```text
Agent A: W0-01 করো
Agent B: W0-03 করো
```

### Serial integration

```text
W0-01 integrate করো
W0-03 integrate করো
```

### Parallel Batch 2

```text
Agent C: W0-02 করো
Agent D: W0-04 করো
Agent E: W0-05 করো
```

### Serial integration

```text
W0-02 integrate করো
W0-04 integrate করো
W0-05 integrate করো
```

### Wave gate

```text
W0 verify করো
```

---

## 5. Wave 1 exact sequence

```text
W1-01 করো
W1-01 integrate করো

W1-02 করো
W1-02 integrate করো
```

তারপর parallel:

```text
Agent A: W1-03 করো
Agent B: W1-05 করো
```

Serial integration:

```text
W1-03 integrate করো
W1-05 integrate করো
```

তারপর parallel:

```text
Agent C: W1-04 করো
Agent D: W1-06 করো
```

Serial integration:

```text
W1-04 integrate করো
W1-06 integrate করো
W1 verify করো
```

---

## 6. Wave 2 exact sequence

Parallel:

```text
Agent A: W2-01 করো
Agent B: W2-04 করো
Agent C: W2-05 করো
```

Serial integration:

```text
W2-01 integrate করো
W2-04 integrate করো
W2-05 integrate করো
```

তারপর parallel:

```text
Agent D: W2-02 করো
Agent E: W2-03 করো
```

Serial integration এবং accounting:

```text
W2-02 integrate করো
W2-03 integrate করো
W2-06 করো
W2-06 integrate করো
W2 verify করো
```

---

## 7. Wave 3 exact sequence

Parallel:

```text
Agent A: W3-01 করো
Agent B: W3-03 করো
Agent C: W3-04 করো
```

Serial integration:

```text
W3-01 integrate করো
W3-03 integrate করো
W3-04 integrate করো
```

তারপর:

```text
W3-02 করো
W3-02 integrate করো
W3 verify করো
```

---

## 8. Wave 4 exact sequence

Hospital scope এবং task-specific foundation আগে যাচাই করুন। শুধু dependency-satisfied task parallel দিন; একসঙ্গে সর্বোচ্চ চার worker।

Parallel Batch 1:

```text
Agent A: W4-01 করো
Agent B: W4-02 করো
Agent C: W4-03 করো
Agent D: W4-04 করো
```

Serial integration:

```text
W4-01 integrate করো
W4-02 integrate করো
W4-03 integrate করো
W4-04 integrate করো
```

তারপর Parallel Batch 2:

```text
Agent E: W4-05 করো
Agent F: W4-06 করো
Agent G: W4-07 করো
```

Serial integration এবং wave gate:

```text
W4-05 integrate করো
W4-06 integrate করো
W4-07 integrate করো
W4 verify করো
```

---

## 9. Wave 5 exact sequence

Source modules stable হওয়ার পরে parallel:

```text
Agent A: W5-01 করো
Agent B: W5-02 করো
Agent C: W5-03 করো
```

Serial integration:

```text
W5-01 integrate করো
W5-02 integrate করো
W5-03 integrate করো
W5 verify করো
```

---

## 10. Final gates

Strictly serial:

```text
FINAL-01 করো
FINAL-01 integrate করো
FINAL-02 করো
FINAL-02 integrate করো
FINAL verify করো
```

Core HMS stable হলে:

```text
FUTURE-01 করো
FUTURE-01 integrate করো
```

---

## 11. Status command

```text
Live branches/worktrees, TASK_STATUS এবং run reports দেখে এখন কোন task worker-ready, READY FOR INTEGRATION, blocked বা complete বলো।
```

Specific task:

```text
W0-01 status বলো
```

## 12. Worker handoff incomplete হলে

```text
তোমার task handoff protocol অনুযায়ী complete করো। Exact branch, commit SHA, tests, run report এবং READY FOR INTEGRATION status দাও। Main merge করবে না।
```

## 13. Full guide

সব dependency, safe parallel batch, conflict rule এবং concurrency limit:

[MANUAL_MULTI_AGENT_RUNBOOK.md](./MANUAL_MULTI_AGENT_RUNBOOK.md)
