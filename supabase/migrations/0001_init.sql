-- Merkel Constructions backend schema.
--
-- Safe to run more than once: every statement is guarded, so re-running the
-- file after an edit updates what changed rather than erroring half way.
--
-- Five areas: the contact inbox (enquiries), job applications, a two-table
-- live chat, the admin list, and the studio's own contact details. Everything is behind row level security. The only writes the
-- browser makes directly are a visitor creating their own chat session and
-- posting into it. Contact submissions never touch the database from the
-- browser: they go through POST /api/contact, which holds the service role key
-- and also sends the notification email.

-- ---------------------------------------------------------------------------
-- Admins
-- ---------------------------------------------------------------------------

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

-- SECURITY DEFINER so the check itself is not subject to RLS on `admins`,
-- which would otherwise recurse when used inside the policies below.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

drop policy if exists "admins read own row" on public.admins;
create policy "admins read own row"
  on public.admins for select
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Shared triage status
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'item_status') then
    create type public.item_status as enum ('new', 'in_progress', 'closed');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Contact enquiries
-- ---------------------------------------------------------------------------

create table if not exists public.enquiries (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null,
  email      text not null,
  company    text,
  service    text,
  message    text not null,
  ip         text,
  status     public.item_status not null default 'new',
  notes      text
);

-- Upgrade path from the earlier flat schema, which called the timestamp
-- `received_at` and had no triage columns.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'enquiries'
      and column_name = 'received_at'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'enquiries'
      and column_name = 'created_at'
  ) then
    alter table public.enquiries rename column received_at to created_at;
  end if;
end
$$;

alter table public.enquiries add column if not exists status public.item_status not null default 'new';
alter table public.enquiries add column if not exists notes text;
alter table public.enquiries add column if not exists ip text;

create index if not exists enquiries_created_at_idx
  on public.enquiries (created_at desc);

alter table public.enquiries enable row level security;

-- No anon policy at all: inserts arrive via the API's service role, which
-- bypasses RLS. Only signed-in admins can read or triage.
drop policy if exists "admins read enquiries" on public.enquiries;
create policy "admins read enquiries"
  on public.enquiries for select to authenticated using (public.is_admin());

drop policy if exists "admins update enquiries" on public.enquiries;
create policy "admins update enquiries"
  on public.enquiries for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Site settings
-- ---------------------------------------------------------------------------

-- The studio's contact details, so they can be changed from the dashboard and
-- take effect on the next page load rather than the next deploy. One row.
create table if not exists public.site_settings (
  id         text primary key default 'default',
  updated_at timestamptz not null default now(),
  address    text,
  email      text,
  phone      text,
  hours      text
);

insert into public.site_settings (id) values ('default')
    on conflict (id) do nothing;

alter table public.site_settings enable row level security;

-- Read goes through GET /api/site using the service role, which is why there
-- is no anon policy here even though the values are public. Only admins write.
drop policy if exists "admins read site settings" on public.site_settings;
create policy "admins read site settings"
  on public.site_settings for select to authenticated using (public.is_admin());

drop policy if exists "admins update site settings" on public.site_settings;
create policy "admins update site settings"
  on public.site_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Job applications
-- ---------------------------------------------------------------------------

create table if not exists public.applications (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name       text not null,
  email      text not null,
  phone      text,
  role_id    text,
  role_title text,
  portfolio  text,
  experience text,
  message    text not null,
  ip         text,
  status     public.item_status not null default 'new',
  notes      text
);

create index if not exists applications_created_at_idx
  on public.applications (created_at desc);

alter table public.applications enable row level security;

-- Same rule as enquiries: no anon policy at all. Applications arrive through
-- POST /api/applications using the service role, and only admins can read them.
drop policy if exists "admins read applications" on public.applications;
create policy "admins read applications"
  on public.applications for select to authenticated using (public.is_admin());

drop policy if exists "admins update applications" on public.applications;
create policy "admins update applications"
  on public.applications for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Live chat
-- ---------------------------------------------------------------------------

-- `visitor_id` is the anonymous auth uid the widget signs in with, so a
-- visitor can read their own thread and nobody else's without us inventing a
-- token scheme of our own. Requires anonymous sign-ins to be enabled under
-- Authentication, Providers, Anonymous.
create table if not exists public.chat_sessions (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  visitor_id      uuid not null default auth.uid(),
  visitor_name    text,
  visitor_email   text,
  last_message_at timestamptz not null default now(),
  status          public.item_status not null default 'new'
);

-- Set once a member of the studio answers, so the canned responder steps
-- aside and the visitor is not talked over. It cannot be read off `status`:
-- the trigger below returns a thread to 'new' every time the visitor speaks.
alter table public.chat_sessions
  add column if not exists handled_by_agent boolean not null default false;

create index if not exists chat_sessions_last_message_idx
  on public.chat_sessions (last_message_at desc);

create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  sender     text not null check (sender in ('visitor', 'agent')),
  body       text not null check (length(body) between 1 and 4000)
);

create index if not exists chat_messages_session_idx
  on public.chat_messages (session_id, created_at);

alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "visitor creates own session" on public.chat_sessions;
create policy "visitor creates own session"
  on public.chat_sessions for insert to authenticated
  with check (visitor_id = auth.uid());

drop policy if exists "visitor or admin reads session" on public.chat_sessions;
create policy "visitor or admin reads session"
  on public.chat_sessions for select to authenticated
  using (visitor_id = auth.uid() or public.is_admin());

drop policy if exists "visitor names own session" on public.chat_sessions;
create policy "visitor names own session"
  on public.chat_sessions for update to authenticated
  using (visitor_id = auth.uid()) with check (visitor_id = auth.uid());

drop policy if exists "admin triages session" on public.chat_sessions;
create policy "admin triages session"
  on public.chat_sessions for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "visitor posts to own session" on public.chat_messages;
create policy "visitor posts to own session"
  on public.chat_messages for insert to authenticated
  with check (
    sender = 'visitor'
    and exists (
      select 1 from public.chat_sessions s
      where s.id = session_id and s.visitor_id = auth.uid()
    )
  );

drop policy if exists "admin posts as agent" on public.chat_messages;
create policy "admin posts as agent"
  on public.chat_messages for insert to authenticated
  with check (sender = 'agent' and public.is_admin());

drop policy if exists "visitor or admin reads messages" on public.chat_messages;
create policy "visitor or admin reads messages"
  on public.chat_messages for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.chat_sessions s
      where s.id = session_id and s.visitor_id = auth.uid()
    )
  );

-- Keep the inbox ordered by activity without the client having to maintain it.
create or replace function public.touch_chat_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_sessions
     set last_message_at = new.created_at,
         -- A visitor speaking puts the conversation back on the waiting pile,
         -- including one already answered or closed, so a follow-up cannot go
         -- unnoticed. An agent reply leaves the status alone; the dashboard
         -- sets it to in_progress itself.
         status = case when new.sender = 'visitor' then 'new' else status end
   where id = new.session_id;
  return new;
end;
$$;

drop trigger if exists chat_messages_touch_session on public.chat_messages;
create trigger chat_messages_touch_session
  after insert on public.chat_messages
  for each row execute function public.touch_chat_session();

-- Realtime: both sides of the conversation stream over these two tables.
-- Realtime honours the policies above, so a visitor only ever receives rows
-- from their own session.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chat_sessions'
  ) then
    alter publication supabase_realtime add table public.chat_sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'enquiries'
  ) then
    alter publication supabase_realtime add table public.enquiries;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'applications'
  ) then
    alter publication supabase_realtime add table public.applications;
  end if;
end
$$;
