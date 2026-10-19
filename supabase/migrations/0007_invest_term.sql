-- 0007_invest_term.sql
--
-- Bitcoin-only investing: every purchase carries a term - how long the
-- customer plans to hold it - and the date it matures, which the dashboard
-- counts down to. A maturity date is a plan, not a lock.
--
-- Run after 0006_bank_backposting.sql. Guarded, so running it twice is safe.
-- Until it has run, purchases are still accepted and use the default term
-- from Settings; they just cannot store a term of their own.

alter table public.bank_trades add column if not exists term_months integer;          -- buys only
alter table public.bank_trades add column if not exists matures_at timestamptz;       -- created_at plus term_months

create index if not exists bank_trades_user_symbol_idx on public.bank_trades (user_id, symbol, created_at);
