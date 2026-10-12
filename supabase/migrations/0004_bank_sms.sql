-- Text message delivery, recorded beside the email it went out with.
--
-- An alert has always been one row with one status, because there was one
-- channel. Adding Pingram gave it a second, and a second can fail on its own:
-- an SMS provider being down must not mark a delivered email as failed, and
-- the other way round. So the text gets its own status and its own error, and
-- `channel` says which were attempted.
--
-- Safe to run on a database that already has these columns, and safe to run
-- more than once.

alter table public.bank_alerts add column if not exists sms_status text;
alter table public.bank_alerts add column if not exists sms_error text;

comment on column public.bank_alerts.sms_status is
  'sent | failed | not_configured. Null when no text was attempted.';
comment on column public.bank_alerts.sms_error is
  'What the SMS provider said when it refused. Null on success.';
