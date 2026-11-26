import { audit } from '../../audit/audit';
import { authorize } from '../../auth/authorize';
import { list } from '../../http/responses';
import { ApiError } from '../../http/errors';
import { isProduction } from '../../config/env';
import { adapterFor } from './adapters/accounting';
import type { Api } from '../../http/api';

export function integrationRoutes({ get, put }: Api) {
  get('/integrations', async ({ tx, actor }) => {
    authorize(actor, 'integrations.manage');
    const firm = (await tx.query('select accounting_adapter from firm')).rows[0];
    const a = adapterFor(firm.accounting_adapter);
    const last = (await tx.query(`select updated_at from integration_job where status = 'Succeeded' order by updated_at desc limit 1`)).rows[0];
    const err = (await tx.query(`select last_error, updated_at from integration_job where status in ('Failed','Uncertain') order by updated_at desc limit 1`)).rows[0];
    return { accounting: { adapter: a.key, label: a.label, mode: a.key === 'mock' ? 'MOCK' : a.key === 'csv' ? 'CSV' : 'NONE', last_success: last?.updated_at ?? null, last_error: err?.last_error ?? null } };
  });
  put('/integrations/accounting', async ({ tx, actor, firmId, body }) => {
    authorize(actor, 'integrations.manage');
    const key = body.adapter as string;
    // The mock invents invoice numbers: it exists for the demo studio and tests, never for a real one.
    const allowed = isProduction() ? ['none', 'csv'] : ['none', 'csv', 'mock'];
    if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION', `Choose one of: ${allowed.join(', ')}.`, [{ field: 'adapter', code: 'invalid' }]);
    await tx.query('update firm set accounting_adapter = $1', [key]);
    const audit_event_id = await audit(tx, actor, firmId, { recordType: 'firm', recordId: firmId, action: 'set_accounting_adapter', next: { adapter: key } });
    return { adapter: key, audit_event_id };
  });
  get('/integrations/jobs', async ({ tx, actor, req }) => {
    authorize(actor, 'integrations.manage');
    return list(req, (await tx.query('select id, adapter, record_type, record_id, status, attempts, last_error, external_id, updated_at from integration_job order by updated_at desc limit 200')).rows);
  });
}
