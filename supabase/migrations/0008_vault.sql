-- 0008_vault.sql
--
-- The vault: Bitcoin comes in and goes out through requests a member of staff
-- confirms.
--
--   cash_in   the customer paid cash to the OTC partner; on confirmation it is
--             booked as Bitcoin at the price on the day it was paid
--   btc_in    the customer sent Bitcoin to the vault address; on confirmation
--             the units are credited at their value on the day they arrived
--   btc_out   the customer asked to send matured Bitcoin to an address of
--             theirs; on approval the units leave the vault
--
-- Run after 0007_invest_term.sql. Guarded, so running it twice is safe.

create table if not exists public.bank_vault_requests (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  user_id uuid not null references public.bank_users (id) on delete cascade,
  kind text not null,                                 -- cash_in | btc_in | btc_out
  status text not null default 'pending',             -- pending_verification | pending | completed | rejected | cancelled
  amount bigint,                                      -- cents: paid in (cash_in), or valued (btc_in, btc_out)
  units numeric(30, 8),                               -- Bitcoin: received (btc_in) or to send (btc_out)
  address text,                                       -- btc_out: where it goes; btc_in: the vault address shown
  txid text,                                          -- the Bitcoin transaction, once known
  occurred_at timestamptz,                            -- when the customer says they paid or sent it
  term_months integer,                                -- incoming only: the term the customer chose
  reference text,
  note text,                                          -- the customer's
  decided_at timestamptz,
  decided_by uuid,
  decision_note text,                                 -- staff's, shown to the customer on a rejection
  trade_id uuid,                                      -- the trade that booked it
  otp_verified boolean default false
);
create index if not exists bank_vault_requests_user_idx on public.bank_vault_requests (user_id, created_at desc);
create index if not exists bank_vault_requests_status_idx on public.bank_vault_requests (status, created_at);

-- Server-only, like every bank table: RLS on with no policy.
alter table public.bank_vault_requests enable row level security;
