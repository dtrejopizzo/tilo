-- Irregular heart rhythm notifications (possible atrial fibrillation) from Apple Health, per day
alter table public.daily_metrics add column irregular_rhythm_events smallint check (irregular_rhythm_events >= 0);
