-- Real studios no longer start on the mock accounting adapter (security audit, Nov 2026).
-- The mock wrote permanent INV-MOCK-* invoices and marked time Billed while nothing reached a real ledger.
-- 'none' means no accounting system is connected: submitting a billing draft to accounting is refused with a clear message.
-- The demo seed sets 'mock' explicitly for its sample studio; production can never choose it (the API refuses it there).
alter table firm drop constraint if exists firm_accounting_adapter_check;
alter table firm add constraint firm_accounting_adapter_check check (accounting_adapter in ('none', 'mock', 'csv'));
alter table firm alter column accounting_adapter set default 'none';
update firm set accounting_adapter = 'none' where accounting_adapter = 'mock';
