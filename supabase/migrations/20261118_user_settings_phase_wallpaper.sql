-- 2026-11-18 — user_settings.phase_wallpaper (Settings → Look and feel → Phase colors).
--
-- Boolean, default false = Top banner; true = Wallpaper (full page): the remaining-wake phase colors
-- (stars while asleep, dawn before wake) fill the whole page background. Mirrors localStorage `sleep-app-phase-wallpaper`
-- (docs/user-data-cloud.md → Column mapping).
--
-- The client selects and upserts this column by name, so apply BEFORE deploying the matching
-- sleep-utils.js: without the column, user_settings reads fail (PostgREST 400) and preferences
-- stop hydrating from the cloud.
--
-- Order: DEV first, smoke-test, then PROD the same day. The 09:17 JST prod→dev sync restores dev
-- from prod's pg_dump, so a dev-only column disappears the next morning until PROD has it
-- (docs/supabase-dev-sync.md).
--
-- Idempotent: safe to re-run. Existing rows get false (off). RLS policies and grants on
-- user_settings are table-level and need no change.

begin;

alter table public.user_settings
  add column if not exists phase_wallpaper boolean not null default false;

comment on column public.user_settings.phase_wallpaper is
  'When true, the remaining-wake phase colors (stars while asleep, dawn before wake) fill the whole page background.';

commit;
