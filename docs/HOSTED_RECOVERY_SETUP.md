# Manual hosted recovery from an iPad

**Prepared, not run.** GitHub repository access, owner-entered secrets and an empty recovery project are still missing. No production data/settings, paid services or background schedules have been changed. Do not mark full recovery complete from this setup document.

## 1. Finish the immediate security setting

Supabase → your existing Life OS project → Authentication → Sign In / Providers → turn **Allow new users to sign up** OFF → Save. Keep the Email sign-in provider ON so your existing account can sign in. Also leave anonymous sign-ins OFF.

The latest direct check found signup still enabled. The application's approved-user guard protects records, but registration should be closed for a private single-user app. We can recheck the public configuration after you save. MFA/password recovery app workflows remain separate engineering work.

## 2. Give the connected GitHub app access to this one repository

The current connector returns 404 for `ff2008IOS-source/Life-os` and reports no installed accounts. In GitHub → Settings → Applications → Installed GitHub Apps, configure the ChatGPT/OpenAI GitHub app and grant access to **Life-os** only. If it is not installed, use the GitHub connection's configure/install flow in ChatGPT. Do not make the repository public or grant access to unrelated repositories.

Once access works, publish the reviewed setup files to the existing private repository. The workflow must be on its default branch before GitHub's **Run workflow** button appears. Existing app files must be preserved. No production deployment or application changes are required for this operator-only workflow.

## 3. Keep GitHub Actions within $0

Use the existing free private repository and standard Ubuntu runner. Check the owner's remaining included Actions minutes/storage and billing settings. Disable paid overage or configure a hard stop at the free allowance; do not buy a plan, enable larger runners, or add paid storage.

Only after verifying that safeguard, add a repository **Actions variable**:

| Variable name                           | Value  |
| --------------------------------------- | ------ |
| `LIFE_OS_RECOVERY_ZERO_SPEND_CONFIRMED` | `true` |

Find this under repository Settings → Secrets and variables → Actions → **Variables**. Without this variable the job is skipped. It also refuses a public repository or a non-default branch. No push/PR/cron/scheduled triggers exist: every run is manual.

GitHub Free currently includes 2,000 minutes/month and 500 MB artifact storage; actual remaining account usage must be checked. Documentation: https://docs.github.com/en/billing/reference/product-usage-included

## 4. Enter backup credentials securely

Open repository Settings → Secrets and variables → Actions → **Secrets → New repository secret**. Do not put these values in GitHub files, issue comments, Work messages or screenshots.

| Secret name                  | Owner enters                                                                                                                                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `LIFE_OS_SOURCE_DB_URL`      | Supabase Connect → **Session pooler**, port 5432, PostgreSQL connection URI for the existing project. You may leave `[YOUR-PASSWORD]` in the copied URI; use the separate password secret below. |
| `LIFE_OS_SOURCE_DB_PASSWORD` | The existing project's **database password**, not the Life OS login password. Enter it literally; this avoids URL-encoding special characters on an iPad.                                        |
| `LIFE_OS_BACKUP_PASSPHRASE`  | A new, unique, password-manager-generated passphrase of at least **32 characters**. Save an independent copy in your password manager. Losing it makes encrypted backups unrecoverable.          |

The approved source reference is `ygyffrxhdvvathrpqyen`. Do not use the transaction pooler on port 6543 or purchase the IPv4 add-on. Direct IPv6 connections are also supported; the shared session pooler is usually easier for a cloud runner.

Inline URL passwords are supported as an alternative, but must be URL-encoded and the separate password secret left unset. Do not supply both forms. Passwords are removed from command arguments and passed to PostgreSQL through container environment variables. CLI scripts are generated without passwords and executed through stdin; raw database errors and SQL records are never printed in workflow logs.

TLS is required with **full certificate verification**. If the provider requires a project-specific root CA, add `LIFE_OS_SOURCE_DB_CA` containing the PEM certificate downloaded from the project's database SSL settings. A CA certificate is public configuration, not a secret key; storing it as an Actions secret is convenient. The workflow stops on certificate errors; never change it to disable verification.

## 5. Run a backup only first

In the repository, open **Actions → Manual Life OS encrypted backup and recovery → Run workflow**. Choose the default branch and mode **backup_only**. Leave recovery project reference empty.

Close Life OS while the backup runs. The workflow compares full aggregate fingerprints before/after dumping and fails if data changes during the backup; it will not silently keep an inconsistent snapshot.

The output is an encrypted archive containing database roles, application schema, data including supported Auth tables and the private approval record, and an encrypted verification manifest. Original SQL files are deleted from the temporary runner directory. Only encrypted output/checksum and a nonsensitive status report are uploaded. The runner uses pinned official actions, a locked Supabase CLI 3.0.0 and a pinned PostgreSQL 17 image. CLI-generated backup SQL is used with explicit TLS settings.

Download the artifact to a private folder in your iPad's Files app (or another owner-controlled, private off-site location). Keep its passphrase in a separate password-manager entry. GitHub retains the artifact for **seven days**; that is temporary delivery, not long-term backup retention. Keep multiple dated owner-held copies and create a new backup at least weekly and before major schema/import changes while no automatic off-site process exists. This is a manual backup policy, not guaranteed zero-loss recovery.

## 6. Create an empty, separate Free recovery project

In Supabase's dashboard, use the existing **Free organization** and create a project named `life-os-recovery-test`. Confirm a free-project slot is available and the dashboard shows no paid upgrade or charge. Do not choose Branching, PITR, a paid restore/clone option or any paid add-on. The workflow never creates, deletes, resets or upgrades projects.

Use PostgreSQL 17 and compatible current Auth schemas. Do not apply Life OS migrations or create a login user in this target; the restore will reconstruct them. Disable public and anonymous signups there too. Keep both projects active until validation is complete. Never pause/delete the original to make room for a test.

Add these repository Actions secrets:

| Secret name                    | Owner enters                                                           |
| ------------------------------ | ---------------------------------------------------------------------- |
| `LIFE_OS_RECOVERY_DB_URL`      | Session-pooler PostgreSQL URI for the **new empty recovery project**   |
| `LIFE_OS_RECOVERY_DB_PASSWORD` | The new project's database password                                    |
| `LIFE_OS_RECOVERY_DB_CA`       | Optional new-project PEM root CA if required for full TLS verification |

The target reference is the project identifier in its dashboard URL. It must differ from `ygyffrxhdvvathrpqyen`; a shared pooler hostname alone does not establish separation, so the workflow checks the username/reference as well.

## 7. Rehearse hosted restoration

Run the same workflow with mode **backup_and_restore**, entering the **recovery project's reference**. Keep the live app closed during the source dump.

The workflow:

1. Checks source/target identity, TLS, PostgreSQL/Auth compatibility and that the target has no app tables, users, Vault secrets or Storage objects.
2. Creates/encrypts a fresh backup, deletes its original plaintext, and decrypts it again for the actual rehearsal.
3. Checks archive filenames/types and SQL checksums before restoring.
4. Restores roles, schema and data in a single transaction into the separate project, with default client grants revoked before object creation.
5. Explicitly checks foreign keys after trigger-bypassing COPY, compares complete table fingerprints/RLS/policies/grants, and tests owner/unapproved/anonymous database access.
6. Revokes copied sessions/refresh tokens in the **recovery project only**, preserving the restored user/password hash. Fresh login is required.

A nonempty target is rejected. There is no automatic DROP/TRUNCATE/reset or production restore path. If a restore partially succeeds but verification fails, stop and inspect the separate test project; do not weaken checks or point it at production to retry.

The encrypted **backup_only** path can retain database-encrypted OAuth and Canvas credential rows inside the encrypted backup. Their encryption keys are separate and must be inventoried privately; ciphertext alone does not restore a connection. Storage objects, Vault secrets and enrolled MFA factors still block this procedure.

The **backup_and_restore** path explicitly refuses both OAuth and Canvas credential rows until provider reconnection and isolated-worker handling are rehearsed. Production now has connected providers, so hosted restoration is **not ready** under this procedure. Never bypass this guard or point a test at production. No separate recovery project existed at the 13 November audit. Local export restoration, including review snapshots and approved commitments, is a separate verification step.

## 8. Verify actual login in an isolated app preview

Database checks alone do not prove Auth recovery. After the run passes:

- Recreate the intended Auth provider/redirect/rate-limit settings on the recovery project; database SQL does not export all platform configuration.
- Create an isolated Vercel preview using the current application source, configured with the **recovery** Supabase URL/publishable key, your approved email and the preview's exact app origin.
- Never change the production environment's database, promote the preview, or activate imports/automation.
- Sign in to the preview yourself with the restored account. Verify tasks/reviews reopen, edit a clearly labeled test task, refresh/sign out/in, export, and confirm the original production project remains unchanged.
- Record the actual recovery time and remaining configuration work. Recovery is not marked complete until this browser test passes.

No login password needs to be given to the agent or CI. Supabase/Vercel secret values and encryption keys need a separate owner-held recovery inventory; the SQL dump cannot recreate dashboard connections or future Google authorization automatically.

## Troubleshooting

- **Job skipped:** confirm the repository is private, the selected branch is its default, and the zero-spend confirmation variable is set after reviewing billing.
- **Preflight stop:** verify secret names, project refs, port 5432, database passwords and the 32-character backup passphrase.
- **TLS failure:** obtain the proper CA certificate; do not disable verification.
- **Source changed:** close app tabs and repeat a manual run.
- **Target not empty:** inspect the recovery project. The script deliberately does not erase it.
- **Schema/provider failure:** raw output is suppressed to avoid exposing Auth hashes or data. An owner can debug privately on the disposable target; do not publish logs/dumps.
- **Full recovery incomplete:** expected until actual browser login and external configuration are checked. `verification.json` deliberately reports that limit.

Official procedure: https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
