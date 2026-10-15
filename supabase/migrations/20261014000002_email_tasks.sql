-- Mails that wait for an answer become tasks on their own, and close themselves once the person
-- replied. The Gmail thread id is what links a task to the conversation it came from.

alter table public.email_insights
  add column thread_id text,
  add column replied_at timestamptz;

create index email_insights_user_thread on public.email_insights (user_id, thread_id) where thread_id is not null;
