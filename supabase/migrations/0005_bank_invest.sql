-- 0005_bank_invest.sql
--
-- Converting a balance into listed assets: what each customer holds, every
-- trade that changed it, and the last price seen for each asset.
--
-- Run after 0003_bank.sql. Guarded, so running it twice is safe.
--
-- Units are numeric(30, 8): a holding is divided to a millionth of a share or a
-- satoshi of Bitcoin, and the server does its arithmetic on exact integers, so
-- these columns must never be float. Cash is bigint cents, as everywhere else.

-- --------------------------------------------------------------- holdings --
create table if not exists public.bank_holdings (
  id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  user_id uuid not null references public.bank_users (id) on delete cascade,
  symbol text not null,                               -- SPY | QQQ | AAPL | ... | BTC | XAU
  units numeric(30, 8) not null default 0,
  cost_basis bigint not null default 0,               -- cents paid for the units still held
  unique (user_id, symbol)
);
create index if not exists bank_holdings_user_idx on public.bank_holdings (user_id);

-- ----------------------------------------------------------------- trades --
create table if not exists public.bank_trades (
  id uuid primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references public.bank_users (id) on delete cascade,
  account_id uuid references public.bank_accounts (id) on delete set null,
  symbol text not null,
  side text not null,                                 -- buy | sell
  units numeric(30, 8) not null,
  price bigint not null,                              -- cents per unit, at the moment of the trade
  amount bigint not null,                             -- cents debited (buy) or credited (sell)
  realized_gain bigint,                               -- sells only: proceeds less the cost of the units sold
  transaction_id uuid,
  reference text,
  quote_source text,                                  -- which price provider answered
  quote_as_of timestamptz
);
create index if not exists bank_trades_user_idx on public.bank_trades (user_id, created_at desc);

-- ---------------------------------------------------------- market quotes --
-- One row per asset, overwritten on every refresh. Lets a cold serverless
-- instance show the last known price, with its age, while it fetches a new one.
create table if not exists public.bank_market_quotes (
  id text primary key,                                -- the symbol
  symbol text not null,
  price numeric(20, 6) not null,
  previous_close numeric(20, 6),
  change numeric(20, 6),
  change_pct numeric(10, 4),
  source text,
  as_of timestamptz,
  fetched_at timestamptz not null default now()
);

-- Server-only, like every bank table: RLS on with no policy.
alter table public.bank_holdings enable row level security;
alter table public.bank_trades enable row level security;
alter table public.bank_market_quotes enable row level security;
