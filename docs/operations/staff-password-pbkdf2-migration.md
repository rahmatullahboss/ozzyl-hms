# Staff password bcrypt to PBKDF2 migration

Use this runbook when Cloudflare Workers is on the Free plan and a legacy bcrypt staff account cannot finish authentication within the Worker CPU ceiling.

## Why this is manual

A bcrypt hash cannot be converted directly into a PBKDF2 hash. The current plaintext password is required once so the migration can:

1. verify the password locally against the existing bcrypt hash;
2. generate a new random-salt PBKDF2 hash with Web Crypto;
3. update D1 only when the user ID, tenant ID, and old bcrypt hash still match.

The script does the CPU-heavy bcrypt verification on the operator machine, not inside the Worker request.

## 1. List remaining legacy accounts

```bash
pnpm auth:migrate-passwords:list
```

Record the `userId` and `tenantId` values for accounts whose current passwords are known. Platform-level users may show `tenantId` as `null`; preserve that value exactly in the input file.

## 2. Create the local-only input file

Create `.local-sensitive/staff-password-migration.json`. This directory is ignored by Git.

```json
[
  {
    "userId": 123,
    "tenantId": 102,
    "password": "[REDACTED_SECRET]"
  }
]
```

Replace the placeholder locally with the account's current password. Do not send this file through chat, email, Git, or issue trackers. Delete it after successful migration.

## 3. Dry-run verification

```bash
pnpm auth:migrate-passwords:check
```

Dry-run mode performs remote lookups and local bcrypt checks but does not write to D1. Every intended account should report `verified and ready`.

## 4. Apply the migration

```bash
HMS_CONFIRM_BCRYPT_TO_PBKDF2=YES pnpm auth:migrate-passwords:apply
```

The update is atomic and includes the previous bcrypt hash in the `WHERE` clause. If someone changes the password concurrently, the script changes zero rows and reports a failure instead of overwriting the newer password.

## 5. Verify completion

```bash
pnpm auth:migrate-passwords:list
```

Successfully migrated accounts no longer appear. Test normal login through `https://hms.ozzyl.com/login`, then securely delete `.local-sensitive/staff-password-migration.json`.

## Accounts with unknown passwords

Do not guess or attempt to crack passwords. Reset those accounts through an administrator-controlled password reset flow so the new password is stored directly as PBKDF2. After the reset, the account does not require bcrypt migration.

## Deployment relationship

The database migration script can update existing accounts before or after the application deployment because the current authentication helper already understands PBKDF2. Deploying the route changes is still required to:

- prevent duplicate password verification in multi-tenant login;
- keep new hospital registrations on PBKDF2;
- retain automatic legacy upgrade for environments with enough Worker CPU.

On the Free plan, deployment alone is not sufficient for existing bcrypt accounts because the first bcrypt verification is terminated before the automatic upgrade can run.
