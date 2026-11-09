-- 2026-11-08 — Enable Row-Level Security on Restore's public tables.
-- Clears Supabase advisor lint `rls_disabled_in_public`.
--
-- Restore is still single-user with no sign-in: the client calls PostgREST with the anon key and
-- scopes every request to RESTORE_CLOUD_USER_ID. These policies mirror that contract — anon and
-- authenticated can only see and write rows for that fixed id.
--
-- This is NOT per-person security. Anyone holding the anon key can still read and edit those rows.
-- Real protection comes with auth: replace the fixed-id predicate with `user_id = auth.uid()`
-- (docs/user-data-cloud.md → Evolution).
--
-- Client access today (src/lib/sleep-utils.js):
--   sleep_days        GET, POST upsert (merge-duplicates)          → select / insert / update
--   sleep_day_drafts  GET, POST upsert, DELETE (nap-only cleanup)  → select / insert / update / delete
--   user_settings     GET, POST upsert (merge-duplicates)          → select / insert / update
--   rpc/promote_draft_if_complete is SECURITY DEFINER → runs as owner, unaffected by RLS.
--
-- No DELETE policy on sleep_days / user_settings: with RLS on, anon deletes match zero rows
-- even though the dev-sync workflow re-grants DELETE on all tables.
--
-- Idempotent: safe to re-run. Run on DEV first, smoke-test, then PROD (same day — the 09:17 JST
-- prod→dev sync would otherwise overwrite dev with prod's pre-RLS tables). After PROD is migrated,
-- pg_dump carries RLS + policies, so the daily sync keeps dev in step.

begin;

alter table public.sleep_days       enable row level security;
alter table public.sleep_day_drafts enable row level security;
alter table public.user_settings    enable row level security;

-- ── sleep_days ──────────────────────────────────────────────────────────────
drop policy if exists restore_mvp_select on public.sleep_days;
create policy restore_mvp_select on public.sleep_days
  for select to anon, authenticated
  using (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists restore_mvp_insert on public.sleep_days;
create policy restore_mvp_insert on public.sleep_days
  for insert to anon, authenticated
  with check (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists restore_mvp_update on public.sleep_days;
create policy restore_mvp_update on public.sleep_days
  for update to anon, authenticated
  using      (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  with check (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- ── sleep_day_drafts ────────────────────────────────────────────────────────
drop policy if exists restore_mvp_select on public.sleep_day_drafts;
create policy restore_mvp_select on public.sleep_day_drafts
  for select to anon, authenticated
  using (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists restore_mvp_insert on public.sleep_day_drafts;
create policy restore_mvp_insert on public.sleep_day_drafts
  for insert to anon, authenticated
  with check (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists restore_mvp_update on public.sleep_day_drafts;
create policy restore_mvp_update on public.sleep_day_drafts
  for update to anon, authenticated
  using      (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  with check (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists restore_mvp_delete on public.sleep_day_drafts;
create policy restore_mvp_delete on public.sleep_day_drafts
  for delete to anon, authenticated
  using (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

-- ── user_settings ───────────────────────────────────────────────────────────
drop policy if exists restore_mvp_select on public.user_settings;
create policy restore_mvp_select on public.user_settings
  for select to anon, authenticated
  using (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists restore_mvp_insert on public.user_settings;
create policy restore_mvp_insert on public.user_settings
  for insert to anon, authenticated
  with check (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

drop policy if exists restore_mvp_update on public.user_settings;
create policy restore_mvp_update on public.user_settings
  for update to anon, authenticated
  using      (user_id = '00000000-0000-0000-0000-000000000001'::uuid)
  with check (user_id = '00000000-0000-0000-0000-000000000001'::uuid);

commit;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Every table in public and whether RLS is on (on DEV this also shows the lookup_* tables,
-- which this migration does not touch):
--
--   select c.relname as table, c.relrowsecurity as rls_on
--   from pg_class c
--   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
--   order by rls_on, c.relname;
--
--   select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by 1, 2;
