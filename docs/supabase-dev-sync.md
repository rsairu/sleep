# Supabase prod → dev sync

**Workflow:** `.github/workflows/sync-supabase-dev-from-prod-v2.yml` (GitHub Actions)
**Schedule:** daily at **09:17 JST** (`cron: "17 00 * * *"`, UTC), plus manual runs from the Actions tab (`workflow_dispatch`). Runs never overlap (`concurrency: supabase-prod-to-dev-sync`).

## What it does

1. **Dump prod** — `pg_dump --schema=public --no-owner --no-acl --format=custom` against `SUPABASE_PROD_DATABASE_URL` (Postgres 17 client in Docker, to match the server's major version).
2. **Restore into dev** — `pg_restore --clean --if-exists --no-owner --no-acl` into `SUPABASE_DEV_DATABASE_URL`. The `public` schema entry itself is filtered out of the restore list, because dev shares `public` with another app (`lookup_*` objects) and `DROP SCHEMA public` would fail.
3. **Re-apply grants** — `--no-acl` drops privileges, so the job re-grants `usage` on `public`, `select/insert/update/delete` on all tables, sequence usage, and `execute` on `promote_draft_if_complete` to `anon` and `authenticated`.

Both secrets must be each project's **direct** connection string (port 5432), not the transaction pooler (6543), which tends to break `pg_dump` / `pg_restore`.

## What that means day to day

- **Dev data is prod data each morning.** Every object in prod's dump is dropped and recreated in dev, so rows written to dev (testing, QA) are replaced at 09:17 JST.
- **Dev schema follows prod's.** A Restore table is recreated from prod's definition, so a column, constraint, or policy added **only to dev** disappears at the next sync.
- **Dev-only objects that prod does not have survive.** Anything in dev `public` that is not in prod's dump (the other app's `lookup_*` tables) is left alone.
- **RLS comes along.** `--no-acl` skips grants but still carries RLS state and policies, so dev inherits them from prod (`docs/user-data-cloud.md` → Supabase grants and RLS).

## Applying a migration (`supabase/migrations/`)

1. Apply to **dev**, smoke-test the app against dev.
2. Apply to **prod the same day** — before the next 09:17 JST run. Otherwise the sync rebuilds dev from prod's older schema and the change vanishes from dev.
3. Deploy client code that depends on the change only once **prod** has it (the client selects `user_settings` columns by name; a missing column fails the whole read).

If you need dev to differ from prod for longer (e.g. a risky change under test), disable the workflow or skip the scheduled run for that period and re-enable it afterward.

## Running it by hand

GitHub → **Actions** → *Sync Supabase dev from prod* → **Run workflow**, or the **📥** button in the dev banner's cloud row (needs a local token; see `docs/dev-banner.md` → *Prod → dev sync button*). When it finishes, press **🔄** to load the fresh dev data. Useful right after a prod migration to pull the new schema into dev immediately, or to reset dev after messy testing.
