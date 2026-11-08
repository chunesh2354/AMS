import type { Tx } from '../db/pool';

export async function notify(tx: Tx, firmId: string, personId: string, eventType: string, text: string, record?: { type: string; id: string }) {
  await tx.query(
    `insert into notification (firm_id, person_id, event_type, text, record_type, record_id) values ($1,$2,$3,$4,$5,$6)`,
    [firmId, personId, eventType, text, record?.type ?? null, record?.id ?? null],
  );
}
