-- Tilo schema: every user-owned table carries user_id and is protected by RLS.
-- Dates (date columns) are the user's local calendar day, sent by the clients.

-- ============ PROFILE & PREFERENCES ============

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  name text,
  avatar_url text,
  birth_date date,
  sex text check (sex in ('male', 'female')),
  height_cm numeric(5, 1) check (height_cm between 80 and 260),
  body_fat_pct numeric(4, 1) check (body_fat_pct between 2 and 70),
  activity_level numeric(4, 3) not null default 1.375,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  onboarding_done boolean not null default false,
  plan text not null default 'trial' check (plan in ('free', 'trial', 'pro')),
  trial_ends_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.goals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  kcal integer not null default 2200 check (kcal between 800 and 8000),
  protein_g integer not null default 140,
  carbs_g integer not null default 230,
  fat_g integer not null default 70,
  fiber_g integer not null default 30,
  water_ml integer not null default 2500,
  steps integer not null default 10000,
  sleep_min integer not null default 450,
  weight_target_kg numeric(5, 1),
  weight_target_date date,
  caffeine_max_mg integer not null default 400,
  caffeine_cutoff time not null default '15:00',
  weekly_sets_target integer not null default 10, -- per muscle group
  updated_at timestamptz not null default now()
);

-- Account-level preferences that don't deserve columns (task defaults, source priority, reminders…)
create table public.settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ============ TASKS & HABITS ============

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  color text not null default '#2f9e5f',
  position integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 300),
  notes text,
  project_id uuid references public.projects (id) on delete set null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'todo' check (status in ('todo', 'done')),
  due_date date,
  completed_on date,
  source text not null default 'manual' check (source in ('manual', 'code', 'email', 'mcp', 'import')),
  source_ref jsonb, -- {file, line, branch} for code TODOs, {message_id, account} for email
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'done') = (completed_on is not null))
);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  frequency text not null default 'daily' check (frequency in ('daily', 'weekly')),
  per_week smallint not null default 7 check (per_week between 1 and 7),
  reminder_time time,
  auto_rule jsonb, -- e.g. {"activity_types": ["run"], "min_minutes": 20} to complete from activities
  position integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.habit_logs (
  habit_id uuid not null references public.habits (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  source text not null default 'manual' check (source in ('manual', 'auto', 'mcp')),
  created_at timestamptz not null default now(),
  primary key (habit_id, date)
);

-- ============ NUTRITION, WATER, BODY ============

create table public.meals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  eaten_at time,
  meal_type text check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  description text not null check (length(description) between 1 and 500),
  kcal numeric(7, 1) not null default 0 check (kcal >= 0),
  protein_g numeric(6, 1) not null default 0 check (protein_g >= 0),
  carbs_g numeric(6, 1) not null default 0 check (carbs_g >= 0),
  fat_g numeric(6, 1) not null default 0 check (fat_g >= 0),
  fiber_g numeric(6, 1) not null default 0 check (fiber_g >= 0),
  alcohol_g numeric(6, 1) not null default 0 check (alcohol_g >= 0),
  caffeine_mg numeric(6, 1) not null default 0 check (caffeine_mg >= 0),
  items jsonb, -- [{name, grams, kcal, protein_g, carbs_g, fat_g}]
  micros jsonb, -- {"sodium_mg": 820, "vitamin_c_mg": 30, …}
  source text not null default 'manual' check (source in ('manual', 'ai', 'mcp', 'import')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.water_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  ml integer not null check (ml between 1 and 5000),
  logged_at timestamptz not null default now()
);

create table public.weight_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  kg numeric(5, 2) not null check (kg between 20 and 400),
  body_fat_pct numeric(4, 1) check (body_fat_pct between 2 and 70),
  source text not null default 'manual',
  created_at timestamptz not null default now()
);

create table public.caffeine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  logged_at timestamptz not null default now(),
  mg integer not null check (mg between 1 and 1000),
  label text
);

-- ============ SUPPLEMENTS ============

create table public.supplements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  dose numeric(8, 2) not null,
  unit text not null check (unit in ('mg', 'mcg', 'iu', 'g', 'ml', 'caps', 'scoop')),
  slot text not null default 'any'
    check (slot in ('wake', 'breakfast', 'lunch', 'dinner', 'with_meal', 'pre_workout', 'post_workout', 'bed', 'any')),
  days smallint[] not null default '{0,1,2,3,4,5,6}', -- 0 = Monday … 6 = Sunday
  with_food boolean not null default false,
  stock_doses integer check (stock_doses >= 0),
  nutrients jsonb, -- per dose: {"vitamin_d_iu": 2000} or {"protein_g": 24, "kcal": 120}
  position integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.supplement_logs (
  supplement_id uuid not null references public.supplements (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  taken_at timestamptz not null default now(),
  primary key (supplement_id, date)
);

-- ============ TRAINING ============

-- Global exercises have user_id null; users can add their own
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  slug text not null,
  name text not null,
  name_es text,
  primary_muscle text not null,
  secondary_muscles text[] not null default '{}',
  equipment text not null default 'other',
  kind text not null default 'strength' check (kind in ('strength', 'cardio', 'mobility')),
  met numeric(4, 1) not null default 5.0,
  created_at timestamptz not null default now()
);
create unique index exercises_slug_global on public.exercises (slug) where user_id is null;
create unique index exercises_slug_user on public.exercises (user_id, slug) where user_id is not null;

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 60),
  weekdays smallint[] not null default '{}', -- 0 = Monday … 6 = Sunday
  notes text,
  position integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.routine_items (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references public.routines (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  position integer not null default 0,
  sets smallint not null default 3 check (sets between 1 and 20),
  reps_min smallint check (reps_min between 1 and 100),
  reps_max smallint check (reps_max between 1 and 100),
  rpe numeric(3, 1) check (rpe between 1 and 10),
  rest_sec integer not null default 120 check (rest_sec between 0 and 900),
  superset_group smallint,
  notes text
);

-- External activities from devices/services (Strava, Apple Health, Google Health, Health Connect)
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('strava', 'apple', 'google_health', 'health_connect', 'garmin', 'manual')),
  external_id text not null,
  type text not null, -- normalised: run, ride, swim, walk, hike, strength, tennis, yoga, other
  name text,
  date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  duration_s integer not null check (duration_s >= 0),
  moving_s integer,
  distance_m numeric(9, 1),
  kcal numeric(7, 1),
  avg_hr smallint,
  max_hr smallint,
  steps integer,
  elevation_m numeric(7, 1),
  device text,
  merged_into uuid references public.activities (id) on delete set null, -- duplicate of another source
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  routine_id uuid references public.routines (id) on delete set null,
  name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  notes text,
  activity_id uuid references public.activities (id) on delete set null, -- watch recording of the same session
  created_at timestamptz not null default now()
);

create table public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_id uuid not null references public.workouts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id),
  position integer not null default 0,
  set_no smallint not null default 1,
  weight_kg numeric(6, 2) check (weight_kg >= 0),
  reps smallint check (reps between 0 and 500),
  duration_s integer,
  distance_m numeric(8, 1),
  rpe numeric(3, 1) check (rpe between 1 and 10),
  is_warmup boolean not null default false,
  completed_at timestamptz default now()
);

-- ============ DEVICE METRICS & ENERGY ============

-- One row per day and source; the app picks the best source per metric
create table public.daily_metrics (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  source text not null check (source in ('apple', 'google_health', 'health_connect', 'strava', 'garmin', 'manual')),
  device text,
  steps integer check (steps >= 0),
  distance_m numeric(9, 1),
  active_kcal numeric(7, 1),
  resting_kcal numeric(7, 1),
  resting_hr smallint,
  hrv_ms numeric(5, 1),
  sleep_min integer,
  flights integer,
  updated_at timestamptz not null default now(),
  primary key (user_id, date, source)
);

-- Cache of the energy engine (packages/core/src/energy.ts), recomputed by the server
create table public.energy_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  bmr integer not null,
  neat integer not null,
  exercise integer not null,
  tef integer not null,
  total integer not null,
  intake integer not null,
  calibration numeric(5, 3) not null default 1,
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  details jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- Per-day rollup maintained by triggers so stats read one row per day
create table public.daily_summary (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  water_ml integer not null default 0,
  kcal_in numeric(7, 1) not null default 0,
  protein_g numeric(6, 1) not null default 0,
  carbs_g numeric(6, 1) not null default 0,
  fat_g numeric(6, 1) not null default 0,
  fiber_g numeric(6, 1) not null default 0,
  caffeine_mg numeric(6, 1) not null default 0,
  meals_count integer not null default 0,
  tasks_done integer not null default 0,
  habits_done integer not null default 0,
  supplements_done integer not null default 0,
  workouts integer not null default 0,
  sets_done integer not null default 0,
  volume_kg numeric(10, 1) not null default 0,
  sport_min integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);

-- ============ EMAIL INSIGHTS ============

create table public.email_snapshots (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  account_email text not null,
  inbox_total integer not null,
  unread integer not null,
  received integer not null default 0,
  sent integer not null default 0,
  personal integer not null default 0,
  newsletters integer not null default 0,
  promotions integer not null default 0,
  top_senders jsonb, -- [{sender, count, unopened, unsubscribe}]
  created_at timestamptz not null default now(),
  primary key (user_id, date, account_email)
);

create table public.email_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_email text not null,
  message_id text not null,
  received_at timestamptz,
  from_name text,
  subject text,
  category text not null check (category in ('reply', 'deadline', 'fyi')),
  due_date date,
  task_id uuid references public.tasks (id) on delete set null,
  dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, message_id)
);

-- ============ PRODUCTIVITY ============

create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  date date not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  planned_min smallint,
  kind text not null default 'focus' check (kind in ('focus', 'coding', 'break')),
  source text not null default 'web' check (source in ('web', 'vscode', 'mcp')),
  created_at timestamptz not null default now()
);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  at timestamptz not null default now(),
  energy smallint check (energy between 1 and 5),
  mood smallint check (mood between 1 and 5),
  note text
);

-- ============ CONNECTIONS, TOKENS, BILLING (server-only secrets) ============

create table public.connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('strava', 'google', 'google_health')),
  external_id text not null, -- athlete id / google sub
  account_email text,
  display_name text,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'error', 'revoked')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  primary key (user_id, provider, external_id)
);

-- OAuth tokens, encrypted by the app (AES-GCM, TOKEN_ENCRYPTION_KEY). No RLS policy: service role only.
create table public.connection_secrets (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null,
  external_id text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider, external_id),
  foreign key (user_id, provider, external_id)
    references public.connections (user_id, provider, external_id) on delete cascade
);

-- Personal API tokens and MCP OAuth access tokens. Only a SHA-256 hash is stored, as the id.
create table public.api_tokens (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  preview text not null,
  kind text not null default 'personal' check (kind in ('personal', 'mcp_oauth', 'ingest')),
  client_id text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz
);

-- MCP OAuth (dynamic client registration + authorization codes). Service role only.
create table public.oauth_clients (
  client_id text primary key,
  client_name text,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

create table public.oauth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients (client_id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  scope text,
  expires_at timestamptz not null
);

create table public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  feature text not null,
  requests integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  primary key (user_id, date, feature)
);

create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null check (provider in ('stripe', 'mercadopago', 'lemonsqueezy', 'manual')),
  customer_id text,
  subscription_id text,
  status text not null check (status in ('active', 'trialing', 'past_due', 'canceled')),
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

-- ============ INDEXES ============

create index tasks_user_status_due on public.tasks (user_id, status, due_date);
create index tasks_user_completed on public.tasks (user_id, completed_on) where completed_on is not null;
create index habit_logs_user_date on public.habit_logs (user_id, date);
create index meals_user_date on public.meals (user_id, date);
create index water_user_date on public.water_logs (user_id, date);
create index weight_user_date on public.weight_logs (user_id, date);
create index caffeine_user_date on public.caffeine_logs (user_id, date);
create index supplement_logs_user_date on public.supplement_logs (user_id, date);
create index activities_user_date on public.activities (user_id, date);
create index activities_user_start on public.activities (user_id, start_at);
create index workouts_user_date on public.workouts (user_id, date);
create index workout_sets_workout on public.workout_sets (workout_id, position);
create index workout_sets_user_exercise on public.workout_sets (user_id, exercise_id, completed_at desc);
create index routine_items_routine on public.routine_items (routine_id, position);
create index focus_user_date on public.focus_sessions (user_id, date);
create index checkins_user_date on public.checkins (user_id, date);
create index email_insights_user_open on public.email_insights (user_id, dismissed, received_at desc);
create index api_tokens_user on public.api_tokens (user_id);

-- ============ ROW LEVEL SECURITY ============

-- Tables a user reads and writes directly (web app via supabase-js)
do $$
declare t text;
begin
  foreach t in array array[
    'goals', 'settings', 'projects', 'tasks', 'habits', 'habit_logs', 'meals', 'water_logs',
    'weight_logs', 'caffeine_logs', 'supplements', 'supplement_logs', 'routines', 'routine_items',
    'workouts', 'workout_sets', 'activities', 'daily_metrics', 'focus_sessions', 'checkins', 'email_insights'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;

-- Profiles: keyed by id
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- plan / trial_ends_at are billing fields: only the server may change them. Supabase grants
-- table-wide UPDATE by default, so replace it with a column list.
revoke update on public.profiles from authenticated;
grant update (name, avatar_url, birth_date, sex, height_cm, body_fat_pct, activity_level, timezone, onboarding_done)
  on public.profiles to authenticated;

-- Global exercises are readable by everyone signed in; custom ones only by their owner
alter table public.exercises enable row level security;
create policy "read exercises" on public.exercises for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy "write own exercises" on public.exercises for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own exercises" on public.exercises for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own exercises" on public.exercises for delete to authenticated using (user_id = (select auth.uid()));

-- Read-only for the owner; the server computes or syncs them
do $$
declare t text;
begin
  foreach t in array array['energy_days', 'daily_summary', 'email_snapshots', 'connections', 'ai_usage', 'subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "read own" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Users can see and revoke their API tokens; creating them goes through the server
alter table public.api_tokens enable row level security;
create policy "read own tokens" on public.api_tokens for select to authenticated using (user_id = (select auth.uid()));
create policy "revoke own tokens" on public.api_tokens for delete to authenticated using (user_id = (select auth.uid()));

-- Server-only: RLS on, no policies, no grants
alter table public.connection_secrets enable row level security;
alter table public.oauth_clients enable row level security;
alter table public.oauth_codes enable row level security;
revoke all on public.connection_secrets, public.oauth_clients, public.oauth_codes from anon, authenticated;
