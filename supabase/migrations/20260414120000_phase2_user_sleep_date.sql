-- Phase 2: user_id + sleep_date, composite uniqueness, promote_draft_if_complete on (user_id, sleep_date).
-- Run once per Supabase project (SQL editor or psql). Matches RESTORE_CLOUD_USER_ID / user_settings seed.
-- After this migration, deploy the updated sleep-utils.js (on_conflict + filters + row mapping).

-- -----------------------------------------------------------------------------
-- 1) Helper: parse legacy M/D, M/D/YYYY, or ISO YYYY-MM-DD (immutable; not granted to anon).
-- -----------------------------------------------------------------------------
create or replace function public.restore_parse_sleep_date_md(p_raw text, p_fallback_year integer default 2026)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  s text := trim(p_raw);
  parts text[];
  y int;
  mo int;
  da int;
begin
  if s is null or s = '' then
    raise exception 'empty sleep date key';
  end if;
  if s ~ '^\d{4}-\d{2}-\d{2}$' then
    return s::date;
  end if;
  parts := string_to_array(s, '/');
  if parts is null or array_length(parts, 1) < 2 then
    raise exception 'invalid sleep date key: %', p_raw;
  end if;
  mo := trim(parts[1])::int;
  da := trim(parts[2])::int;
  if array_length(parts, 1) >= 3 and trim(parts[3]) <> '' then
    y := trim(parts[3])::int;
  else
    y := p_fallback_year;
  end if;
  return make_date(y, mo, da);
end;
$$;

revoke all on function public.restore_parse_sleep_date_md(text, integer) from public;

-- -----------------------------------------------------------------------------
-- 2) Add columns
-- -----------------------------------------------------------------------------
alter table public.sleep_days
  add column if not exists user_id uuid not null default '00000000-0000-0000-0000-000000000001';

alter table public.sleep_days
  add column if not exists sleep_date date;

alter table public.sleep_day_drafts
  add column if not exists user_id uuid not null default '00000000-0000-0000-0000-000000000001';

alter table public.sleep_day_drafts
  add column if not exists sleep_date date;

-- -----------------------------------------------------------------------------
-- 3) Backfill sleep_date from date_md
-- -----------------------------------------------------------------------------
update public.sleep_days
set sleep_date = public.restore_parse_sleep_date_md(date_md, 2026)
where sleep_date is null;

update public.sleep_day_drafts
set sleep_date = public.restore_parse_sleep_date_md(date_md, 2026)
where sleep_date is null;

-- -----------------------------------------------------------------------------
-- 4) Normalize date_md to ISO text (optional but recommended; aligns with client)
-- -----------------------------------------------------------------------------
update public.sleep_days
set date_md = to_char(sleep_date, 'YYYY-MM-DD')
where sleep_date is not null;

update public.sleep_day_drafts
set date_md = to_char(sleep_date, 'YYYY-MM-DD')
where sleep_date is not null;

-- -----------------------------------------------------------------------------
-- 5) Fail fast if duplicates would break UNIQUE(user_id, sleep_date)
-- -----------------------------------------------------------------------------
do $$
declare
  dup_days int;
  dup_drafts int;
begin
  select count(*) into dup_days from (
    select user_id, sleep_date from public.sleep_days group by 1, 2 having count(*) > 1
  ) x;
  select count(*) into dup_drafts from (
    select user_id, sleep_date from public.sleep_day_drafts group by 1, 2 having count(*) > 1
  ) y;
  if dup_days > 0 then
    raise exception 'sleep_days has duplicate (user_id, sleep_date); merge rows manually then re-run';
  end if;
  if dup_drafts > 0 then
    raise exception 'sleep_day_drafts has duplicate (user_id, sleep_date); merge rows manually then re-run';
  end if;
end;
$$;

alter table public.sleep_days alter column sleep_date set not null;
alter table public.sleep_day_drafts alter column sleep_date set not null;

-- -----------------------------------------------------------------------------
-- 6) Drop legacy uniqueness on date_md; add composite uniqueness
-- -----------------------------------------------------------------------------
alter table public.sleep_days drop constraint if exists sleep_days_date_md_key;
alter table public.sleep_day_drafts drop constraint if exists sleep_day_drafts_date_md_key;

alter table public.sleep_days
  add constraint sleep_days_user_id_sleep_date_key unique (user_id, sleep_date);

alter table public.sleep_day_drafts
  add constraint sleep_day_drafts_user_id_sleep_date_key unique (user_id, sleep_date);

-- -----------------------------------------------------------------------------
-- 7) RPC: same signature (p_date_md text, p_patch jsonb); keys drafts/finals by (user_id, sleep_date)
-- -----------------------------------------------------------------------------
create or replace function public.promote_draft_if_complete(
  p_date_md text,
  p_patch jsonb
)
returns table (promoted boolean, result_date_md text) as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_user_id uuid := '00000000-0000-0000-0000-000000000001';
  v_sleep_date date;
  v_date_md text;
  v_draft public.sleep_day_drafts%rowtype;
  v_complete boolean := false;
begin
  v_sleep_date := public.restore_parse_sleep_date_md(trim(p_date_md), 2026);
  v_date_md := to_char(v_sleep_date, 'YYYY-MM-DD');

  insert into public.sleep_day_drafts (date_md, user_id, sleep_date)
  values (v_date_md, v_user_id, v_sleep_date)
  on conflict on constraint sleep_day_drafts_user_id_sleep_date_key do nothing;

  update public.sleep_day_drafts as d
  set
    bed = case
      when v_patch ? 'bed' then nullif(trim(v_patch->>'bed'), '')
      else bed
    end,
    sleep_start = case
      when v_patch ? 'sleep_start' then nullif(trim(v_patch->>'sleep_start'), '')
      else sleep_start
    end,
    sleep_end = case
      when v_patch ? 'sleep_end' then nullif(trim(v_patch->>'sleep_end'), '')
      else sleep_end
    end,
    bathroom = case
      when v_patch ? 'bathroom' then coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_patch->'bathroom') as value),
        '{}'::text[]
      )
      else bathroom
    end,
    alarm = case
      when v_patch ? 'alarm' then coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_patch->'alarm') as value),
        '{}'::text[]
      )
      else alarm
    end,
    nap_start = case
      when v_patch ? 'nap_start' then nullif(trim(v_patch->>'nap_start'), '')
      else nap_start
    end,
    nap_end = case
      when v_patch ? 'nap_end' then nullif(trim(v_patch->>'nap_end'), '')
      else nap_end
    end,
    waso = case
      when v_patch ? 'waso' then greatest(0, coalesce((v_patch->>'waso')::integer, 0))
      else waso
    end,
    labels = case
      when v_patch ? 'labels' then coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_patch->'labels') as value),
        '{}'::text[]
      )
      else labels
    end,
    date_md = v_date_md
  where d.user_id = v_user_id and d.sleep_date = v_sleep_date
  returning * into v_draft;

  v_complete :=
    coalesce(nullif(trim(v_draft.bed), ''), '') <> '' and
    coalesce(nullif(trim(v_draft.sleep_start), ''), '') <> '' and
    coalesce(nullif(trim(v_draft.sleep_end), ''), '') <> '';

  if (v_patch ? 'nap_start' or v_patch ? 'nap_end') and exists (
    select 1 from public.sleep_days s
    where s.user_id = v_user_id and s.sleep_date = v_sleep_date
  ) then
    update public.sleep_days s
    set
      nap_start = v_draft.nap_start,
      nap_end = v_draft.nap_end
    where s.user_id = v_user_id and s.sleep_date = v_sleep_date;
  end if;

  if v_complete then
    insert into public.sleep_days (
      date_md,
      user_id,
      sleep_date,
      bed,
      sleep_start,
      sleep_end,
      bathroom,
      alarm,
      nap_start,
      nap_end,
      waso,
      labels
    )
    values (
      v_draft.date_md,
      v_user_id,
      v_sleep_date,
      v_draft.bed,
      v_draft.sleep_start,
      v_draft.sleep_end,
      coalesce(v_draft.bathroom, '{}'::text[]),
      coalesce(v_draft.alarm, '{}'::text[]),
      v_draft.nap_start,
      v_draft.nap_end,
      coalesce(v_draft.waso, 0),
      coalesce(v_draft.labels, '{}'::text[])
    )
    on conflict on constraint sleep_days_user_id_sleep_date_key do update set
      date_md = excluded.date_md,
      bed = excluded.bed,
      sleep_start = excluded.sleep_start,
      sleep_end = excluded.sleep_end,
      bathroom = excluded.bathroom,
      alarm = excluded.alarm,
      nap_start = excluded.nap_start,
      nap_end = excluded.nap_end,
      waso = excluded.waso,
      labels = excluded.labels;

    delete from public.sleep_day_drafts d
    where d.user_id = v_user_id and d.sleep_date = v_sleep_date;
  end if;

  return query
    select v_complete as promoted, v_date_md as result_date_md;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.promote_draft_if_complete(text, jsonb) to anon, authenticated;
