# HMS Connector Routing Rules

This file defines the canonical connector routing for this HMS project. Agents must follow these rules and must not guess or probe unrelated connectors for normal project work.

## Canonical connectors

| Target environment / service | Required connector |
| --- | --- |
| Mac development environment | **SMS connector** |
| HMS server environment | **PKR Server connector** |
| GitHub repository operations | **GitHub connector** |

## Mandatory routing rules

1. For work on the Mac/local HMS repository, use the **SMS connector**.
2. For work on the HMS server, use the **PKR Server connector**.
3. For GitHub repository, branch, commit, PR, and remote file operations, use the **GitHub connector**.
4. Do **not** search for, guess, or switch to other Mac/server connectors unless the user explicitly changes this rule.
5. If a canonical connector appears unavailable, verify the named connector itself before concluding that Mac/server access is unavailable.
6. Do not infer that the project has no connector access merely because an unrelated connector fails.

## Source of truth

User-confirmed project routing rule, recorded on 2026-08-12.
