-- Copy nap_start / nap_end from sleep_day_drafts into existing sleep_days when a nap patch is applied.
-- Without this, nap-only saves update the draft only; fetchSleepData reads sleep_days and misses the nap.

create or replace function public.promote_draft_if_complete(
  p_date_md text,
  p_patch jsonb
)
returns table (promoted boolean, result_date_md text) as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_draft public.sleep_day_drafts%rowtype;
  v_complete boolean := false;
begin
  insert into public.sleep_day_drafts (date_md)
  values (p_date_md)
  on conflict on constraint sleep_day_drafts_date_md_key do nothing;

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
    end
  where d.date_md = p_date_md
  returning * into v_draft;

  v_complete :=
    coalesce(nullif(trim(v_draft.bed), ''), '') <> '' and
    coalesce(nullif(trim(v_draft.sleep_start), ''), '') <> '' and
    coalesce(nullif(trim(v_draft.sleep_end), ''), '') <> '';

  if (v_patch ? 'nap_start' or v_patch ? 'nap_end') and exists (
    select 1 from public.sleep_days s where s.date_md = p_date_md
  ) then
    update public.sleep_days s
    set
      nap_start = v_draft.nap_start,
      nap_end = v_draft.nap_end
    where s.date_md = p_date_md;
  end if;

  if v_complete then
    insert into public.sleep_days (
      date_md,
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
    on conflict on constraint sleep_days_date_md_key do update set
      bed = excluded.bed,
      sleep_start = excluded.sleep_start,
      sleep_end = excluded.sleep_end,
      bathroom = excluded.bathroom,
      alarm = excluded.alarm,
      nap_start = excluded.nap_start,
      nap_end = excluded.nap_end,
      waso = excluded.waso,
      labels = excluded.labels;

    delete from public.sleep_day_drafts where sleep_day_drafts.date_md = p_date_md;
  end if;

  return query
    select v_complete as promoted, p_date_md as result_date_md;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.promote_draft_if_complete(text, jsonb) to anon, authenticated;
