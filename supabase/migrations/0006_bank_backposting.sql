-- 0006_bank_backposting.sql
--
-- Staff booking and correcting trades after the fact: a walk-in customer's
-- instruction, or one taken by phone while the network was down, recorded at
-- the price and time it was actually agreed - and undone cleanly if it was
-- booked wrong.
--
-- Run after 0005_bank_invest.sql. Guarded, so running it twice is safe.

alter table public.bank_trades add column if not exists status text default 'completed';   -- completed | reversed
alter table public.bank_trades add column if not exists reversed_at timestamptz;
alter table public.bank_trades add column if not exists booked_by uuid;                      -- the member of staff, when not the customer
alter table public.bank_trades add column if not exists note text;                           -- why it was booked, moved or reversed

create index if not exists bank_trades_transaction_idx on public.bank_trades (transaction_id);
