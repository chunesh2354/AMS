-- 007: project setup from the wizard, so a new project can be staffed and billed without seed rows.
--
-- A principal authorizes fixed-fee progress per phase (POST /projects/:code/fee-authorizations). The reason they
-- give is kept on the row as well as in the audit trail, so the Billing tab can show it next to the level.
-- Each level is its own row (migration 001), and a level is never authorized twice for the same allocation.

alter table fee_authorization add column note text;

create unique index fee_authorization_level on fee_authorization (phase_fee_allocation_id, cumulative_percent);
