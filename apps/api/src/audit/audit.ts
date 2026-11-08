import type { Tx } from '../db/pool';

/** Section 3.2 rule 7. Runs in the caller's transaction, so an action and its audit row commit together. */
export async function audit(tx: Tx, actor: { id: string; firmId: string } | null, firmId: string, e: { recordType: string; recordId?: string | null; action: string; previous?: unknown; next?: unknown; reason?: string; approvalRef?: string; sensitive?: boolean }) {
  const r = await tx.query(
    `insert into audit_event (firm_id, actor_id, created_by, record_type, record_id, action, previous, new, reason, approval_ref, sensitive)
     values ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [firmId, actor?.id ?? null, e.recordType, e.recordId ?? null, e.action, e.previous === undefined ? null : JSON.stringify(e.previous), e.next === undefined ? null : JSON.stringify(e.next), e.reason ?? null, e.approvalRef ?? null, !!e.sensitive],
  );
  return r.rows[0].id as string;
}
