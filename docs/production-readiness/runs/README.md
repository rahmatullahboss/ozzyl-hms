# Task Run Reports

Each manually assigned production-readiness worker task creates or updates one durable report:

```text
<TASK-ID>.md
```

Examples:

```text
W0-01.md
W2-04.md
FINAL-01.md
```

Copy `../TASK_RUN_REPORT_TEMPLATE.md` when starting a new task. The worker branch owns its report and stops at handoff. The separately instructed integration agent records the local-main merge commit and updates `../TASK_STATUS.md`. Wave verification reports use `<WAVE>-INTEGRATION.md`, for example `W0-INTEGRATION.md`.

Do not store real patient data, passwords, tokens, secrets, raw production dumps, or sensitive provider payloads in these reports.
