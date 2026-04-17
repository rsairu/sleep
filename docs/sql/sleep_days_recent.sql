-- Quick browse: newest nights first (Supabase SQL editor).
-- Filters the MVP restore user so results match the app; `user_id` is not selected.

select
  sleep_date,
  bed,
  sleep_start,
  sleep_end,
  bathroom,
  alarm,
  nap_start,
  nap_end,
  waso,
  labels,
  id,
  created_at,
  updated_at
from public.sleep_days
where user_id = '00000000-0000-0000-0000-000000000001'
order by sleep_date desc
limit 100;

-- Drafts (same shape; optional second run)

select
  sleep_date,
  bed,
  sleep_start,
  sleep_end,
  bathroom,
  alarm,
  nap_start,
  nap_end,
  waso,
  labels,
  id,
  created_at,
  updated_at
from public.sleep_day_drafts
where user_id = '00000000-0000-0000-0000-000000000001'
order by sleep_date desc
limit 100;
