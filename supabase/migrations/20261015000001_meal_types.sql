-- Finer meal moments for nutrition analysis: mid-morning and afternoon snacks, merienda, extra snacks.
-- 'snack' stays as the "extra" catch-all, so existing rows keep their meaning.
alter table public.meals drop constraint if exists meals_meal_type_check;
alter table public.meals add constraint meals_meal_type_check
  check (meal_type in ('breakfast', 'morning_snack', 'lunch', 'merienda', 'afternoon_snack', 'dinner', 'snack'));
