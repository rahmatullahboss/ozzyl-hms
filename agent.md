# Project Notes — ozzyl-hms
> 40755 notes | Updated: 4/23/2026

## Safety Rules

- **NEVER** run `git clean -fd` or `git reset --hard` without checking `git log` and verifying commits exist.
- **NEVER** delete untracked files or folders blindly. Always backup or stash before bulk edits.
- **ALWAYS commit working-tree edits promptly after they pass typecheck/tests.** A linter or external process can revert uncommitted edits in this project, so leaving them uncommitted risks silently losing work. Commit, then ask the user about any follow-up (e.g. merging to main).

## Quick Reference
- 18049 warnings → see `.agent-mem/gotchas.md`
- 2983 conventions → see `.agent-mem/patterns.md`
- Codebase map → see `.agent-mem/project-brief.md`
- Active work → see `.agent-mem/active-context.md`

## Read .agent-mem/gotchas.md before ANY changes

For full memory: `.agent-mem/`
For observation details: `.agent-mem/observations/`

## Available Tools (Use ON-DEMAND only — context in .agent-mem replaces startup calls)
- `sys_core_02(title, content, category)` — Save + auto-detect conflicts
- `sys_core_03(items[])` — Save multiple in 1 call
- `sys_core_01(q)` — Search memory when debugging
- `sys_core_05(query)` — Full-text search for details
- `sys_core_16()` — Check compiler errors after edits
- `sys_core_20(path, start, end)` — Read file sections
- `sys_core_28(pattern, dir)` — Find symbols without loading full files

> Do NOT call sys_core_14() or sys_core_08() at startup — read the .agent-mem files above instead.

---
*Auto-generated*

# Project Memory — ozzyl-hms
> 6831 notes | Score threshold: >40

## Safety — Never Run Destructive Commands

> Dangerous commands are actively monitored.
> Critical/high risk commands trigger error notifications in real-time.

- **NEVER** run `rm -rf`, `del /s`, `rmdir`, `format`, or any command that deletes files/directories without EXPLICIT user approval.
- **NEVER** run `DROP TABLE`, `DELETE FROM`, `TRUNCATE`, or any destructive database operation.
- **NEVER** run `git push --force`, `git reset --hard`, or any command that rewrites history.
- **NEVER** run `npm publish`, `docker rm`, `terraform destroy`, or any irreversible deployment/infrastructure command.
- **NEVER** pipe remote scripts to shell (`curl | bash`, `wget | sh`).
- **ALWAYS** ask the user before running commands that modify system state, install packages, or make network requests.
- When in doubt, **show the command first** and wait for approval.

**Stack:** Dart/JavaScript/TypeScript · Angular + Express + Flutter + Provider + React + Tailwind · DB: Firebase, Hive, MySQL

## 📝 NOTE: 1 uncommitted file(s) in working tree.\n\n## Project Standards

- what-changed in fileHashes.lock — confirmed 12x
- what-changed in checksums.lock — confirmed 12x
- what-changed in buildOutputCleanup.lock — confirmed 12x
- what-changed in buildLogic.lock — confirmed 3x
- convention in shared-context.json
- Strengthened types Loading
- convention in App.tsx
- what-changed in buildOutputCleanup.lock — confirmed 4x

## Known Fixes

- ❌ - - Fixed null crash in PatientId — avoids unnecessary re-renders in React → ✅ sys_02 in agent-rules.md
- ❌ - - Fixed null crash in ClipboardList — prevents null/undefined runtime crashes → ✅ sys_02 in agent-rules.md
- ❌ + - sys_02 in error.log → ✅ sys_02 in agent-rules.md
- ❌ - - sys_02 in error.log → ✅ sys_02 in agent-rules.md
- ❌ - - Fixed null crash in Stethoscope — prevents null/undefined runtime crashes → ✅ sys_02 in agent-rules.md

## Recent Decisions

- decision in buildLogic.lock
- decision in buildLogic.lock

## Learned Patterns

- Always: sys_01 in agent.md — confirmed 16x (seen 2x)
- Always: sys_01 in agent.md — confirmed 15x (seen 5x)
- Always: sys_01 in agent.md — confirmed 17x (seen 9x)
- Agent generates new migration for every change (squash related changes)
- Agent installs packages without checking if already installed

### 📚 Core Framework Rules: [callstackincubator/react-native-best-practices]
# React Native Best Practices

## Overview

Performance optimization guide for React Native applications, covering JavaScript/React, Native (iOS/Android), and bundling optimizations. Based on Callstack's "Ultimate Guide to React Native Optimization".

## Skill Format

Each reference file follows a hybrid format for fast lookup and deep understanding:

- **Quick Pattern**: Incorrect/Correct code snippets for immediate pattern matching
- **Quick Command**: Shell commands for process/measurement skills
- **Quick Config**: Configuration snippets for setup-focused skills
- **Quick Reference**: Summary tables for conceptual skills
- **Deep Dive**: Full context with When to Use, Prerequisites, Step-by-Step, Common Pitfalls

**Impact ratings**: CRITICAL (fix immediately), HIGH (significant improvement), MEDIUM (worthwhile optimization)

## When to Apply

Reference these guidelines when:
- Debugging slow/janky UI or animations
- Investigating memory leaks (JS or native)
- Optimizing app startup time (TTI)
- Reducing bundle or app size
- Writing native modules (Turbo Modules)
- Profiling React Native performance
- Reviewing React Native code for performance

## Security Notes

- Treat shell ...
(truncated)


### 📚 Core Framework Rules: [better-auth/providers]
# Authentication Providers Reference

Provide a quick reference for Better Auth authentication providers:

1. If a provider name is provided (e.g., "google", "github", "email"), show detailed configuration for that provider
2. Otherwise, show an overview of all available providers organized by category:
   - OAuth providers (Google, GitHub, Discord, etc.)
   - Email/Password authentication
   - Magic link authentication
   - Passwordless authentication
   - Social providers
3. For each provider, display:
   - Configuration requirements (client ID, secret, etc.)
   - Setup instructions
   - Code example for integration
4. Use clear visual indicators for different provider types
5. Mention any special requirements or considerations
6. Provide link to full documentation: https://better-auth.com/docs

If the user is currently working on authentication code, offer to generate integration code for the selected provider.


### 📚 Core Framework Rules: [callstackincubator/upgrading-react-native]
# Upgrading React Native

## Overview

Covers the full React Native upgrade workflow: template diffs via Upgrade Helper, dependency updates, Expo SDK steps, and common pitfalls.

## Typical Upgrade Sequence

1. **Route**: Choose the right upgrade path via [upgrading-react-native.md][upgrading-react-native]
2. **Diff**: Fetch the canonical template diff using Upgrade Helper via [upgrade-helper-core.md][upgrade-helper-core]
3. **Dependencies**: Assess and update third-party packages via [upgrading-dependencies.md][upgrading-dependencies]
4. **React**: Align React version if upgraded via [react.md][react]
5. **Expo** (if applicable): Apply Expo SDK layer via [expo-sdk-upgrade.md][expo-sdk-upgrade]
6. **Verify**: Run post-upgrade checks via [upgrade-verification.md][upgrade-verification]



## When to Apply

Reference these guidelines when:
- Moving a React Native app to a newer version
- Reconciling native config changes from Upgrade Helper
- Validating release notes for breaking changes

## Quick Reference

| File | Description |
|------|-------------|
| [upgrading-react-native.md][upgrading-react-native] | Router: choose the right upgrade path |
| [upgrade-helper-core.md][upgrade-he...
(truncated)


## Available Tools (ON-DEMAND only)
- `sys_core_01(q)` — Deep search when stuck
- `sys_core_05(query)` — Full-text lookup
> Context above IS your context. Do NOT call sys_core_14() at startup.
