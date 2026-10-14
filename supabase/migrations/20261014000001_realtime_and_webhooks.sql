-- Near-real-time device data:
--  * connections.health_user_id maps Google Health webhook notifications (healthUserId) to a user
--  * connection_secrets keeps the down-scoped Google Health access token, so each sync doesn't
--    mint a new one
--  * the device tables join the Realtime publication, so the web app refreshes the moment a
--    webhook or a sync writes new data (RLS still applies: each user only sees their rows)

alter table public.connections add column health_user_id text;
create index connections_health_user on public.connections (health_user_id) where health_user_id is not null;

alter table public.connection_secrets
  add column scoped_access_token text,
  add column scoped_expires_at timestamptz;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.daily_metrics, public.activities, public.weight_logs, public.connections;
  end if;
end $$;
