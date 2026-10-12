-- ============================================================================
-- Rockfield National Bank - schema for the banking application.
--
-- Apply after 0001_init.sql and 0002_email.sql. Every table is written to by
-- the server with the service-role key, which bypasses row level security, so
-- RLS is enabled and left with no permissive policy: nothing reaches these
-- tables from a browser holding only the anon key. Authorisation is decided in
-- the application, where the session lives.
--
-- Money is integer cents throughout. Timestamps are ISO-8601 in UTC.
-- ============================================================================

-- ------------------------------------------------------------------ users --
create table if not exists public.bank_users (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  customer_number text unique,
  role text not null default 'customer',              -- customer | admin
  status text not null default 'active',              -- active | pending | suspended | closed
  email text not null unique,
  email_verified boolean not null default false,
  password_hash text not null,
  must_change_password boolean not null default false,
  password_changed_at timestamptz,

  first_name text,
  middle_name text,
  last_name text,
  preferred_name text,
  date_of_birth text,
  ssn_encrypted text,                                 -- AES-256-GCM, never plaintext
  ssn_last4 text,
  tax_id_type text default 'SSN',
  citizenship text,
  id_type text,
  id_number text,                                     -- encrypted
  id_state text,
  id_expires text,

  phone text,
  mobile text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  mailing_same_as_home boolean default true,

  employment_status text,
  employer text,
  occupation text,
  annual_income bigint default 0,
  source_of_funds text,

  photo_url text,
  photo_document_id uuid,

  kyc_status text default 'pending',                  -- pending | review | verified | rejected
  kyc_notes text,
  kyc_reviewed_at timestamptz,
  risk_rating text default 'standard',
  tier text default 'Standard',
  relationship_manager text,

  two_factor_enabled boolean default true,
  two_factor_method text default 'email',
  transfer_pin_hash text,
  security_question text,
  security_answer_hash text,

  alert_prefs jsonb,
  alert_threshold bigint default 50000,
  low_balance_threshold bigint default 10000,
  paperless boolean default true,
  language text default 'en-US',
  timezone text default 'America/New_York',

  failed_logins integer default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  last_login_ip text,
  login_count integer default 0,
  opened_by uuid,
  notes text
);
create index if not exists bank_users_email_idx on public.bank_users (email);
create index if not exists bank_users_status_idx on public.bank_users (status);

-- --------------------------------------------------------------- accounts --
create table if not exists public.bank_accounts (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  type text not null,                                 -- checking | savings | money_market | cd | credit | loan | mortgage | ira
  product_id text,
  name text,
  nickname text,
  account_number text not null unique,
  routing_number text not null,
  swift text,
  currency text not null default 'USD',
  status text not null default 'active',              -- active | frozen | restricted | dormant | closed
  balance bigint not null default 0,
  opening_balance bigint not null default 0,
  hold_amount bigint not null default 0,
  available_balance bigint not null default 0,
  credit_limit bigint default 0,
  overdraft_limit bigint default 0,
  overdraft_protection boolean default true,
  interest_rate numeric default 0,
  apy numeric default 0,
  apr numeric default 0,
  minimum_balance bigint default 0,
  monthly_fee bigint default 0,
  term_months integer default 0,
  maturity_date text,
  statement_day integer default 1,
  opened_at timestamptz,
  closed_at timestamptz,
  last_activity_at timestamptz,
  is_primary boolean default false,
  notes text
);
create index if not exists bank_accounts_user_idx on public.bank_accounts (user_id);

-- ----------------------------------------------------------- transactions --
create table if not exists public.bank_transactions (
  id uuid primary key,
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  date timestamptz not null,                          -- value date, which is what a statement orders by
  user_id uuid not null references public.bank_users (id) on delete cascade,
  account_id uuid not null references public.bank_accounts (id) on delete cascade,
  direction text not null,                            -- credit | debit
  amount bigint not null check (amount > 0),
  currency text not null default 'USD',
  description text not null,
  merchant text,
  category text,
  method text,                                        -- ach | wire_domestic | card | check | ...
  status text not null default 'posted',              -- posted | pending | hold | failed | reversed | scheduled
  balance_after bigint,
  reference text,
  trace_number text,
  check_number text,
  memo text,
  location text,
  counterparty jsonb,
  transfer_id uuid,
  reversed_by uuid,
  created_by text,                                    -- customer | admin | system
  created_by_id uuid,
  admin_note text,
  meta jsonb
);
create index if not exists bank_transactions_account_idx on public.bank_transactions (account_id, date desc);
create index if not exists bank_transactions_user_idx on public.bank_transactions (user_id, date desc);
create index if not exists bank_transactions_status_idx on public.bank_transactions (status);

-- --------------------------------------------------------------- transfers --
create table if not exists public.bank_transfers (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  type text not null,                                 -- internal | ach | wire_domestic | wire_international | instant | bill_pay
  method text,
  from_account_id uuid references public.bank_accounts (id) on delete set null,
  to_account_id uuid references public.bank_accounts (id) on delete set null,
  beneficiary_id uuid,
  payee_id uuid,
  amount bigint not null,
  fee bigint not null default 0,
  total bigint not null,
  currency text default 'USD',
  memo text,
  purpose text,
  status text not null,                               -- draft | pending_verification | pending_review | scheduled | processing | completed | rejected | cancelled | failed
  scheduled_for timestamptz,
  recurrence text default 'none',
  recurrence_end timestamptz,
  parent_transfer_id uuid,
  confirmation text,
  trace_number text,
  imad text,
  omad text,
  requires_otp boolean default false,
  otp_verified boolean default false,
  pin_verified boolean default false,
  reason_code text,
  reason_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  completed_at timestamptz,
  debit_transaction_id uuid,
  credit_transaction_id uuid,
  ip text,
  snapshot jsonb                                      -- the recipient as they were when it was sent
);
create index if not exists bank_transfers_user_idx on public.bank_transfers (user_id, created_at desc);
create index if not exists bank_transfers_status_idx on public.bank_transfers (status);

-- ----------------------------------------------------------- beneficiaries --
create table if not exists public.bank_beneficiaries (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  nickname text,
  name text not null,
  bank_name text,
  account_number text not null,
  routing_number text,
  swift text,
  account_type text,
  type text not null,                                 -- domestic_ach | domestic_wire | international_wire
  country text,
  address text,
  bank_address text,
  relationship text,
  memo text,
  status text default 'pending',                      -- pending | verified | blocked
  verified_at timestamptz,
  last_used_at timestamptz
);
create index if not exists bank_beneficiaries_user_idx on public.bank_beneficiaries (user_id);

-- -------------------------------------------------------------------- cards --
create table if not exists public.bank_cards (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  account_id uuid not null references public.bank_accounts (id) on delete cascade,
  brand text,
  kind text,                                          -- debit | credit
  number_encrypted text,                              -- the PAN never leaves the server in the clear
  last4 text,
  bin text,
  name_on_card text,
  exp_month integer,
  exp_year integer,
  cvv_encrypted text,
  status text default 'active',                       -- active | frozen | lost | stolen | expired | cancelled
  design text,
  daily_purchase_limit bigint default 750000,
  daily_atm_limit bigint default 100000,
  contactless boolean default true,
  international_allowed boolean default false,
  online_allowed boolean default true,
  pin_set boolean default true,
  activated_at timestamptz,
  replaced_card_id uuid,
  notes text
);
create index if not exists bank_cards_user_idx on public.bank_cards (user_id);

-- ------------------------------------------------------------------- payees --
create table if not exists public.bank_payees (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  name text not null,
  category text,
  account_number text,
  amount bigint default 0,
  due_day integer,
  autopay boolean default false,
  phone text,
  address text,
  status text default 'active',
  last_paid_at timestamptz
);
create index if not exists bank_payees_user_idx on public.bank_payees (user_id);

-- ----------------------------------------------------------------- deposits --
create table if not exists public.bank_deposits (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  account_id uuid not null references public.bank_accounts (id) on delete cascade,
  amount bigint not null,
  check_number text,
  front_document_id uuid,
  back_document_id uuid,
  transaction_id uuid,
  status text default 'review',                       -- review | accepted | rejected
  hold_until timestamptz,
  available_now bigint default 0,
  reason_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  reference text
);

-- ---------------------------------------------------------------- documents --
create table if not exists public.bank_documents (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  kind text not null,                                 -- avatar | id_front | id_back | ssn_card | proof_address | check_front | ...
  filename text,
  mime text,
  size integer,
  data text,                                          -- data: URL; swap for object storage at volume
  status text default 'received',
  uploaded_by text,
  uploaded_by_id uuid,
  note text,
  reviewed_at timestamptz
);
create index if not exists bank_documents_user_idx on public.bank_documents (user_id);

-- ----------------------------------------------------------------- activity --
create table if not exists public.bank_activity (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  actor_id uuid,
  actor_email text,
  actor_role text,
  action text not null,
  category text,                                      -- security | money | account | admin
  detail text,
  severity text default 'info',
  channel text default 'web',
  ip text,
  user_agent text,
  device text,
  meta jsonb
);
create index if not exists bank_activity_user_idx on public.bank_activity (user_id, created_at desc);
create index if not exists bank_activity_created_idx on public.bank_activity (created_at desc);

-- ------------------------------------------------------------------- alerts --
create table if not exists public.bank_alerts (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  type text,
  channel text default 'email',
  subject text,
  preview text,
  body_text text,
  body_html text,
  severity text default 'info',
  status text default 'queued',                       -- queued | sent | failed | not_configured
  provider_id text,
  error text,
  sent_at timestamptz,
  read_at timestamptz,
  meta jsonb
);
create index if not exists bank_alerts_user_idx on public.bank_alerts (user_id, created_at desc);

-- ----------------------------------------------------------------- messages --
create table if not exists public.bank_messages (
  id uuid primary key,
  created_at timestamptz not null default now(),
  thread_id uuid not null,
  user_id uuid not null references public.bank_users (id) on delete cascade,
  from_side text not null,                            -- customer | bank
  author_name text,
  subject text,
  body text,
  read_at timestamptz,
  attachments jsonb
);
create index if not exists bank_messages_thread_idx on public.bank_messages (thread_id, created_at);

-- ----------------------------------------------------------------- disputes --
create table if not exists public.bank_disputes (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  transaction_id uuid,
  account_id uuid,
  amount bigint,
  reason text,
  detail text,
  status text default 'open',                         -- open | provisional_credit | resolved_credit | resolved_declined
  reference text,
  provisional_credit boolean default false,
  resolution text,
  resolved_at timestamptz,
  handled_by uuid
);

-- ----------------------------------------------------------------- sessions --
create table if not exists public.bank_sessions (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  token_hash text not null unique,                    -- SHA-256 of the cookie value, never the value
  csrf text,
  expires_at timestamptz,
  last_seen_at timestamptz,
  ip text,
  user_agent text,
  device text,
  device_kind text,
  remember boolean default false,
  revoked_at timestamptz
);
create index if not exists bank_sessions_user_idx on public.bank_sessions (user_id);
create index if not exists bank_sessions_token_idx on public.bank_sessions (token_hash);

-- --------------------------------------------------------------------- otps --
create table if not exists public.bank_otps (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  purpose text not null,                              -- login | reset | transfer:<id>
  code_hash text not null,
  expires_at timestamptz,
  attempts integer default 0,
  used_at timestamptz,
  meta jsonb
);
create index if not exists bank_otps_user_idx on public.bank_otps (user_id, purpose);

-- ----------------------------------------------------------------- settings --
create table if not exists public.bank_settings (
  id text primary key,
  values jsonb not null,
  updated_at timestamptz
);

-- --------------------------------------------------------------------- RLS --
-- Every table below is server-only. RLS on with no policy means the anon key
-- reads and writes nothing; the service-role key the server holds bypasses it.
do $$
declare t text;
begin
  foreach t in array array[
    'bank_users', 'bank_accounts', 'bank_transactions', 'bank_transfers',
    'bank_beneficiaries', 'bank_cards', 'bank_payees', 'bank_deposits',
    'bank_documents', 'bank_activity', 'bank_alerts', 'bank_messages',
    'bank_disputes', 'bank_sessions', 'bank_otps', 'bank_settings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
