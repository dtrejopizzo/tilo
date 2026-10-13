-- Habits get a weekly schedule (days = 0 Monday … 6 Sunday), like supplements and routines.
-- The Today checklist and reminders only show a habit on its days; a weekly habit's goal is
-- the number of days chosen. per_week is kept in sync by the clients.

alter table public.habits
  add column days smallint[] not null default '{0,1,2,3,4,5,6}'; -- 0 = Monday … 6 = Sunday

-- ============ RPC: everything for one day (Today screen, VSCode sidebar, MCP get_today) ============

create or replace function public.get_day(p_date date, p_user uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := private.resolve_user(p_user);
  dow smallint := (extract(isodow from p_date)::smallint - 1); -- 0 = Monday
  week_start date := p_date - (extract(isodow from p_date)::integer - 1);
begin
  return jsonb_build_object(
    'date', p_date,
    'profile', (select to_jsonb(p) from public.profiles p where p.id = uid),
    'goals', (select to_jsonb(g) - 'user_id' from public.goals g where g.user_id = uid),
    'settings', (select s.data from public.settings s where s.user_id = uid),
    'projects', coalesce((
      select jsonb_agg(to_jsonb(p) - 'user_id' order by p.position) from public.projects p where p.user_id = uid and not p.archived
    ), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(to_jsonb(t) - 'user_id' order by t.due_date nulls last, t.position, t.created_at)
      from public.tasks t
      where t.user_id = uid and (t.status = 'todo' or t.completed_on = p_date)
    ), '[]'::jsonb),
    'habits', coalesce((
      select jsonb_agg(
        to_jsonb(h) - 'user_id' || jsonb_build_object(
          'done', exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.date = p_date),
          'auto', exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.date = p_date and l.source = 'auto'),
          'week_count', (select count(*) from public.habit_logs l where l.habit_id = h.id and l.date between week_start and week_start + 6)
        ) order by h.position, h.created_at)
      from public.habits h
      where h.user_id = uid and not h.archived
        and (dow = any (h.days) or exists (select 1 from public.habit_logs l where l.habit_id = h.id and l.date = p_date))
    ), '[]'::jsonb),
    'supplements', coalesce((
      select jsonb_agg(
        to_jsonb(s) - 'user_id' || jsonb_build_object(
          'taken', exists (select 1 from public.supplement_logs l where l.supplement_id = s.id and l.date = p_date)
        ) order by s.position, s.created_at)
      from public.supplements s where s.user_id = uid and not s.archived and dow = any (s.days)
    ), '[]'::jsonb),
    'meals', coalesce((
      select jsonb_agg(to_jsonb(m) - 'user_id' order by m.eaten_at nulls last, m.created_at)
      from public.meals m where m.user_id = uid and m.date = p_date
    ), '[]'::jsonb),
    'water', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'ml', w.ml, 'logged_at', w.logged_at) order by w.logged_at)
      from public.water_logs w where w.user_id = uid and w.date = p_date
    ), '[]'::jsonb),
    'caffeine', coalesce((
      select jsonb_agg(to_jsonb(c) - 'user_id' order by c.logged_at)
      from public.caffeine_logs c where c.user_id = uid and c.date = p_date
    ), '[]'::jsonb),
    'weight', (
      select to_jsonb(w) - 'user_id' from public.weight_logs w
      where w.user_id = uid and w.date <= p_date order by w.date desc, w.created_at desc limit 1
    ),
    'weights_recent', coalesce((
      select jsonb_agg(jsonb_build_object('date', w.date, 'kg', w.kg, 'body_fat_pct', w.body_fat_pct) order by w.date)
      from public.weight_logs w where w.user_id = uid and w.date between p_date - 28 and p_date
    ), '[]'::jsonb),
    'routine', (
      select to_jsonb(r) - 'user_id' || jsonb_build_object('items', coalesce((
        select jsonb_agg(
          to_jsonb(i) - 'user_id' || jsonb_build_object(
            'exercise', jsonb_build_object('id', e.id, 'name', coalesce(e.name_es, e.name), 'primary_muscle', e.primary_muscle, 'kind', e.kind),
            'last', (
              select jsonb_agg(jsonb_build_object('weight_kg', st.weight_kg, 'reps', st.reps, 'rpe', st.rpe) order by st.set_no)
              from public.workout_sets st
              where st.workout_id = (
                select st2.workout_id from public.workout_sets st2
                join public.workouts w2 on w2.id = st2.workout_id
                where st2.user_id = uid and st2.exercise_id = i.exercise_id and w2.date < p_date and not st2.is_warmup
                order by w2.date desc limit 1
              ) and st.exercise_id = i.exercise_id and not st.is_warmup
            )
          ) order by i.position)
        from public.routine_items i join public.exercises e on e.id = i.exercise_id
        where i.routine_id = r.id
      ), '[]'::jsonb))
      from public.routines r
      where r.user_id = uid and not r.archived and dow = any (r.weekdays)
      order by r.position limit 1
    ),
    'workouts', coalesce((
      select jsonb_agg(to_jsonb(w) - 'user_id' || jsonb_build_object('sets', coalesce((
        select jsonb_agg(to_jsonb(st) - 'user_id' || jsonb_build_object('exercise_name', coalesce(e.name_es, e.name)) order by st.position, st.set_no)
        from public.workout_sets st join public.exercises e on e.id = st.exercise_id
        where st.workout_id = w.id
      ), '[]'::jsonb)) order by w.started_at)
      from public.workouts w where w.user_id = uid and w.date = p_date
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(to_jsonb(a) - 'user_id' - 'raw' order by a.start_at)
      from public.activities a where a.user_id = uid and a.date = p_date and a.merged_into is null
    ), '[]'::jsonb),
    'metrics', coalesce((
      select jsonb_agg(to_jsonb(d) - 'user_id') from public.daily_metrics d where d.user_id = uid and d.date = p_date
    ), '[]'::jsonb),
    'energy', (select to_jsonb(e) - 'user_id' from public.energy_days e where e.user_id = uid and e.date = p_date),
    'summary', (select to_jsonb(s) - 'user_id' from public.daily_summary s where s.user_id = uid and s.date = p_date),
    'email', jsonb_build_object(
      'snapshots', coalesce((
        select jsonb_agg(to_jsonb(s) - 'user_id' order by s.date)
        from public.email_snapshots s where s.user_id = uid and s.date between p_date - 6 and p_date
      ), '[]'::jsonb),
      'insights', coalesce((
        select jsonb_agg(to_jsonb(i) - 'user_id' order by i.received_at desc)
        from (
          select * from public.email_insights
          where user_id = uid and not dismissed and task_id is null
          order by received_at desc limit 10
        ) i
      ), '[]'::jsonb)
    ),
    'checkins', coalesce((
      select jsonb_agg(to_jsonb(c) - 'user_id' order by c.at) from public.checkins c where c.user_id = uid and c.date = p_date
    ), '[]'::jsonb),
    'focus_min', (
      select coalesce(sum(extract(epoch from (coalesce(f.ended_at, now()) - f.started_at))), 0)::integer / 60
      from public.focus_sessions f where f.user_id = uid and f.date = p_date and f.kind <> 'break'
    )
  );
end $$;

-- ============ RPC: a date range for Stats ============


create or replace function public.get_range(p_from date, p_to date, p_user uuid default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := private.resolve_user(p_user);
begin
  if p_to < p_from or p_to - p_from > 400 then
    raise exception 'invalid range' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'goals', (select to_jsonb(g) - 'user_id' from public.goals g where g.user_id = uid),
    'settings', (select s.data - 'ai' from public.settings s where s.user_id = uid),
    'summaries', coalesce((
      select jsonb_agg(to_jsonb(s) - 'user_id' order by s.date)
      from public.daily_summary s where s.user_id = uid and s.date between p_from and p_to
    ), '[]'::jsonb),
    'habits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'name', h.name, 'frequency', h.frequency, 'per_week', h.per_week, 'days', to_jsonb(h.days),
        'dates', coalesce((
          select jsonb_agg(l.date order by l.date) from public.habit_logs l
          where l.habit_id = h.id and l.date between p_from and p_to
        ), '[]'::jsonb)
      ) order by h.position)
      from public.habits h where h.user_id = uid and not h.archived
    ), '[]'::jsonb),
    'weights', coalesce((
      select jsonb_agg(jsonb_build_object('date', w.date, 'kg', w.kg, 'body_fat_pct', w.body_fat_pct) order by w.date)
      from public.weight_logs w where w.user_id = uid and w.date between p_from and p_to
    ), '[]'::jsonb),
    'energy', coalesce((
      select jsonb_agg(to_jsonb(e) - 'user_id' - 'details' order by e.date)
      from public.energy_days e where e.user_id = uid and e.date between p_from and p_to
    ), '[]'::jsonb),
    'metrics', coalesce((
      select jsonb_agg(to_jsonb(d) - 'user_id' order by d.date)
      from public.daily_metrics d where d.user_id = uid and d.date between p_from and p_to
    ), '[]'::jsonb),
    'activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', a.date, 'type', a.type, 'name', a.name, 'source', a.source, 'duration_s', a.duration_s,
        'distance_m', a.distance_m, 'kcal', a.kcal, 'avg_hr', a.avg_hr
      ) order by a.start_at)
      from public.activities a where a.user_id = uid and a.date between p_from and p_to and a.merged_into is null
    ), '[]'::jsonb),
    'muscle_sets', coalesce((
      select jsonb_agg(jsonb_build_object('date', x.date, 'muscle', x.muscle, 'sets', x.sets, 'volume_kg', x.volume) order by x.date)
      from (
        select w.date, e.primary_muscle as muscle, count(*) as sets, coalesce(sum(st.weight_kg * st.reps), 0) as volume
        from public.workout_sets st
        join public.workouts w on w.id = st.workout_id
        join public.exercises e on e.id = st.exercise_id
        where st.user_id = uid and w.date between p_from and p_to and not st.is_warmup and st.completed_at is not null
        group by w.date, e.primary_muscle
      ) x
    ), '[]'::jsonb),
    'best_lifts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'exercise_id', b.exercise_id, 'name', b.name, 'date', b.date, 'weight_kg', b.weight_kg, 'reps', b.reps, 'e1rm', b.e1rm
      ) order by b.e1rm desc)
      from (
        select distinct on (st.exercise_id)
          st.exercise_id, coalesce(e.name_es, e.name) as name, w.date, st.weight_kg, st.reps,
          round(st.weight_kg * (1 + st.reps / 30.0), 1) as e1rm
        from public.workout_sets st
        join public.workouts w on w.id = st.workout_id
        join public.exercises e on e.id = st.exercise_id
        where st.user_id = uid and w.date between p_from and p_to and not st.is_warmup
          and st.weight_kg > 0 and st.reps between 1 and 12
        order by st.exercise_id, st.weight_kg * (1 + st.reps / 30.0) desc
      ) b
    ), '[]'::jsonb),
    'email', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', s.date, 'inbox_total', s.inbox_total, 'unread', s.unread, 'received', s.received, 'sent', s.sent,
        'personal', s.personal, 'newsletters', s.newsletters, 'promotions', s.promotions
      ) order by s.date)
      from (
        select date, sum(inbox_total) as inbox_total, sum(unread) as unread, sum(received) as received, sum(sent) as sent,
               sum(personal) as personal, sum(newsletters) as newsletters, sum(promotions) as promotions
        from public.email_snapshots where user_id = uid and date between p_from and p_to group by date
      ) s
    ), '[]'::jsonb),
    'focus', coalesce((
      select jsonb_agg(jsonb_build_object('date', f.date, 'minutes', f.minutes) order by f.date)
      from (
        select date, (sum(extract(epoch from (coalesce(ended_at, started_at) - started_at))) / 60)::integer as minutes
        from public.focus_sessions where user_id = uid and date between p_from and p_to and kind <> 'break' group by date
      ) f
    ), '[]'::jsonb),
    'checkins', coalesce((
      select jsonb_agg(jsonb_build_object('date', c.date, 'energy', c.energy, 'mood', c.mood) order by c.at)
      from public.checkins c where c.user_id = uid and c.date between p_from and p_to
    ), '[]'::jsonb)
  );
end $$;

grant execute on function public.get_day(date, uuid), public.get_range(date, date, uuid) to authenticated, service_role;
revoke execute on function public.get_day(date, uuid), public.get_range(date, date, uuid) from anon;
