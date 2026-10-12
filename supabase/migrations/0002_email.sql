-- Email inbox for the admin dashboard.
--
-- Mail addressed to the studio mailbox arrives through Resend Inbound, which
-- holds the MX records and posts an `email.received` webhook to
-- /api/inbound/resend. Replies are sent from the dashboard through Resend and
-- recorded here alongside the inbound side, so a thread reads as one
-- conversation.
--
-- Optional: the site works fine without any of this. Skip it if you are not
-- receiving mail.
--
-- Safe to run more than once. Requires 0001_init.sql (item_status, is_admin).

-- ---------------------------------------------------------------------------
-- Threads
-- ---------------------------------------------------------------------------

create table if not exists public.email_threads (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  last_message_at   timestamptz not null default now(),
  subject           text not null default '(no subject)',
  -- The person on the other end. Threads are per correspondent, not per
  -- mailbox, so a reply lands back on the conversation it belongs to.
  participant_email text not null,
  participant_name  text,
  status            public.item_status not null default 'new'
);

create index if not exists email_threads_activity_idx
  on public.email_threads (last_message_at desc);

-- Used to re-find a thread when a reply carries no In-Reply-To header, which
-- some clients omit. Subject is stored already stripped of Re:/Fwd:.
create index if not exists email_threads_match_idx
  on public.email_threads (lower(participant_email), lower(subject));

-- ---------------------------------------------------------------------------
-- Messages
-- ---------------------------------------------------------------------------

create table if not exists public.email_messages (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  thread_id       uuid not null references public.email_threads (id) on delete cascade,
  direction       text not null check (direction in ('inbound', 'outbound')),
  from_email      text not null,
  from_name       text,
  to_email        text not null,
  subject         text,
  body_text       text,
  body_html       text,
  -- RFC 5322 Message-ID, and the header that points at its parent. Kept so
  -- replies thread correctly in the recipient's mail client, not just ours.
  message_id      text,
  in_reply_to     text,
  has_attachments boolean not null default false
);

create index if not exists email_messages_thread_idx
  on public.email_messages (thread_id, created_at);

-- Inbound mail can be delivered more than once; the Message-ID makes the
-- insert idempotent so a retry does not duplicate the conversation.
create unique index if not exists email_messages_message_id_key
  on public.email_messages (message_id) where message_id is not null;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.email_threads enable row level security;
alter table public.email_messages enable row level security;

-- Staff only, both directions. Everything written here arrives via the server
-- routes using the service role, which bypasses RLS, so there is deliberately
-- no insert policy for the browser at all.
drop policy if exists "admins read email threads" on public.email_threads;
create policy "admins read email threads"
  on public.email_threads for select to authenticated using (public.is_admin());

drop policy if exists "admins update email threads" on public.email_threads;
create policy "admins update email threads"
  on public.email_threads for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admins read email messages" on public.email_messages;
create policy "admins read email messages"
  on public.email_messages for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Keep the inbox ordered, and flag threads the correspondent spoke on last
-- ---------------------------------------------------------------------------

create or replace function public.touch_email_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.email_threads
     set last_message_at = new.created_at,
         -- Inbound mail always returns a thread to the waiting pile, however
         -- it was filed before. Our own replies leave the status alone; the
         -- dashboard sets it to in_progress itself.
         status = case when new.direction = 'inbound' then 'new' else status end
   where id = new.thread_id;
  return new;
end;
$$;

drop trigger if exists email_messages_touch_thread on public.email_messages;
create trigger email_messages_touch_thread
  after insert on public.email_messages
  for each row execute function public.touch_email_thread();

-- Realtime, so a message arriving lands in an open dashboard without a reload.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'email_messages'
  ) then
    alter publication supabase_realtime add table public.email_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'email_threads'
  ) then
    alter publication supabase_realtime add table public.email_threads;
  end if;
end
$$;
