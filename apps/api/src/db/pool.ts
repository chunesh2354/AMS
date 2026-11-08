import pg from 'pg';

pg.types.setTypeParser(1082, (v) => v); // Keep dates as YYYY-MM-DD strings; never let a timezone shift a service date.

export type Tx = pg.PoolClient;

export const createPool = (connectionString: string) => new pg.Pool({ connectionString, max: 10 });

/** Runs one unit of work with the firm set for row-level security. */
export async function withFirm<T>(pool: pg.Pool, firmId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query('begin');
    await tx.query(`select set_config('app.firm_id', $1, true)`, [firmId]);
    const out = await fn(tx);
    await tx.query('commit');
    return out;
  } catch (e) {
    await tx.query('rollback').catch(() => {});
    throw e;
  } finally {
    tx.release();
  }
}
