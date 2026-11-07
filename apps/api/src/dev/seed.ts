import { hash } from '@node-rs/argon2';
import pg from 'pg';
import { addDays, weekStart } from '../../../../packages/domain/src/index';

/** Section 15. Sample values only, never defaults. Idempotent by firm name. Refuses to run in production. */
export const DEMO_PASSWORD = 'meridian-demo-2026';
export const DEMO_FIRM = 'Studio Meridian (DEMO)';
export const demoEmail = (ref: string) => `${ref.toLowerCase()}@meridian.demo`;

type Row = Record<string, any>;

export async function seed(ownerConn: string, opts: { today?: string } = {}) {
  if (process.env.NODE_ENV === 'production') throw new Error('The demo seed never runs in production.');
  const db = new pg.Client({ connectionString: ownerConn });
  await db.connect();
  try {
    const exists = await db.query('select id from firm where trading_name = $1', [DEMO_FIRM]);
    if (exists.rowCount) return exists.rows[0].id as string;
    await db.query('begin');
    const today = opts.today ?? new Date().toISOString().slice(0, 10);
    const thisWeek = weekStart(today);
    const lastWeek = addDays(thisWeek, -7);
    const passwordHash = await hash(DEMO_PASSWORD);

    const firmId = (await db.query(`insert into firm (legal_name, trading_name, timezone) values ($1,$1,'Asia/Kolkata') returning id`, [DEMO_FIRM])).rows[0].id;
    const ins = async (table: string, row: Row) => {
      const keys = ['firm_id', ...Object.keys(row)];
      const vals = [firmId, ...Object.values(row)];
      return (await db.query(`insert into ${table} (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`, vals)).rows[0];
    };

    const setIds: Record<string, string> = {};
    for (const key of ['principal', 'operations', 'pm', 'staff', 'finance']) setIds[key] = (await ins('permission_set', { key, name: key })).id;

    const P: Record<string, string> = {};
    const people: [string, string, string, string | null, string[]][] = [
      ['P01', 'Asha Rao', 'Principal', null, ['principal']],
      ['P02', 'Vikram Nair', 'Project architect', 'P01', ['pm']],
      ['P03', 'Meera Iyer', 'Project architect', 'P01', ['pm']],
      ['P04', 'Rohan Shetty', 'Senior architect', 'P02', ['staff']],
      ['P05', 'Divya Menon', 'Architect', 'P02', ['staff']],
      ['P06', 'Karan Bhat', 'Architect', 'P03', ['staff']],
      ['P07', 'Sneha Pillai', 'Designer', 'P03', ['staff']],
      ['P08', 'Arjun Das', 'Architect', 'P02', ['staff']],
      ['P09', 'Nisha Kumar', 'Intern', 'P03', ['staff']],
      ['P10', 'Farah Khan', 'Operations', 'P01', ['operations', 'finance']],
    ];
    for (const [ref, name, title, mgr] of people) {
      P[ref] = (await ins('person', { ref_code: ref, name, job_title: title, work_email: demoEmail(ref), manager_id: mgr ? P[mgr] : null, password_hash: passwordHash })).id;
    }
    for (const [ref, , , , sets] of people) for (const s of sets) await ins('permission_grant', { person_id: P[ref], permission_set_id: setIds[s], granted_by: P.P01, reason: 'Demo seed', sensitive: false });
    await db.query('update firm set fallback_approver_id = $1 where id = $2', [P.P01, firmId]);

    const from = '2026-01-01';
    const rates: [string, number | null, number][] = [['P01', 2400, 6000], ['P02', 1200, 3000], ['P03', 1200, 3000], ['P04', 900, 2200], ['P05', 640, 1600], ['P06', 640, 2000], ['P07', 640, 1600], ['P08', 640, 1600], ['P09', null, 800], ['P10', 800, 1500]];
    for (const [ref, cost, bill] of rates) {
      await ins('rate_schedule', { person_id: P[ref], rate_type: 'bill', amount: bill, effective_from: from, change_reason: 'Demo seed' });
      if (cost != null) await ins('rate_schedule', { person_id: P[ref], rate_type: 'cost', amount: cost, effective_from: from, change_reason: 'Demo seed' });
    }

    const cats: Record<string, string> = {};
    for (const [key, name] of [['admin', 'Studio admin'], ['training', 'Training']]) cats[key] = (await ins('internal_work_category', { key, name })).id;

    const clients: Record<string, string> = {};
    for (const name of ['Lakeview Trust', 'Orchard Developers', 'Heritage Hospitality']) clients[name] = (await ins('client', { name })).id;

    const mkProject = async (code: string, name: string, client: string, pm: string, status: string, contract: string, members: [string, string][], hold?: string) => {
      const p = await ins('project', { code, name, client_id: clients[client], pm_id: P[pm], principal_id: P.P01, status, contract_summary: contract, hold_reason: hold ?? null });
      for (const [ref, role] of members) await ins('project_membership', { project_id: p.id, person_id: P[ref], project_role: role });
      const cv = await ins('contract_version', { project_id: p.id, version_no: 1, effective_from: from });
      const bv = await ins('budget_version', { project_id: p.id, version_no: 1, kind: 'baseline' });
      return { ...p, cv: cv.id, bv: bv.id };
    };
    const mkPhase = async (p: Row, order: number, code: string, name: string, start: string, end: string, owner: string, budget: number, opening: number, etc: number, delivery: number, status: string) => {
      const ph = await ins('phase', { project_id: p.id, code, name, start_date: start, end_date: end, owner_id: P[owner], delivery_progress_pct: delivery, etc_hours: etc, opening_actual_hours: opening, status, sort_order: order });
      await ins('budget_line', { budget_version_id: p.bv, phase_id: ph.id, hours: budget });
      return ph;
    };
    const mkFee = (p: Row, key: string, name: string, method: string, extra: Row = {}) => ins('fee_component', { contract_version_id: p.cv, project_id: p.id, key, name, billing_method: method, ...extra });

    // PRJ-01: fixed fee ₹24,00,000 across six phases. Concept design fee ₹4,00,000 is the worked example.
    const prj1 = await mkProject('PRJ-01', 'Lakeview Residence', 'Lakeview Trust', 'P02', 'Active', 'Fixed fee ₹24,00,000', [['P02', 'pm'], ['P04', 'contributor'], ['P05', 'contributor'], ['P08', 'contributor'], ['P01', 'reviewer'], ['P10', 'viewer']]);
    const fee1 = await mkFee(prj1, 'fixed', 'Fixed fee', 'fixed_percent', { contracted_amount: 2400000 });
    const ph1: Record<string, Row> = {};
    const rows1: [string, string, string, string, string, number, number, number, number, string, number][] = [
      ['CD', 'Concept design', '2026-02-02', '2026-11-27', 'P04', 140, 118, 22, 60, 'In progress', 400000],
      ['SD', 'Schematic design', '2026-04-13', '2026-06-26', 'P02', 220, 216, 0, 100, 'Complete', 360000],
      ['DD', 'Design development', '2026-06-29', '2026-09-04', 'P02', 340, 316, 0, 100, 'Complete', 520000],
      ['WD', 'Working drawings', '2026-09-07', '2026-12-18', 'P02', 200, 170, 60, 62, 'In progress', 720000],
      ['TN', 'Tender', '2026-12-21', '2027-02-05', 'P08', 100, 0, 100, 0, 'Not started', 180000],
      ['SS', 'Site supervision', '2027-02-08', '2027-11-26', 'P02', 100, 0, 100, 0, 'Not started', 220000],
    ];
    const alloc1: Record<string, string> = {};
    for (const [i, r] of rows1.entries()) {
      ph1[r[0]] = await mkPhase(prj1, i, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9]);
      alloc1[r[0]] = (await ins('phase_fee_allocation', { phase_id: ph1[r[0]].id, fee_component_id: fee1.id, amount: r[10] })).id;
    }

    // PRJ-02: 6% of ₹8,00,00,000, plus an additional-service NTE of ₹1,00,000 on its own phase.
    const prj2 = await mkProject('PRJ-02', 'Orchard Commercial Block', 'Orchard Developers', 'P03', 'Active', '6% of ₹8,00,00,000 + hourly NTE ₹1,00,000', [['P03', 'pm'], ['P04', 'contributor'], ['P06', 'contributor'], ['P07', 'contributor'], ['P01', 'reviewer'], ['P10', 'viewer']]);
    const feePct = await mkFee(prj2, 'percent', '6% of construction cost', 'percent_construction', { fee_percent: 6, contracted_amount: 4800000 });
    const feeNte = await mkFee(prj2, 'nte', 'Additional services, hourly NTE', 'hourly_nte', { cap_amount: 100000 });
    await ins('construction_cost_basis', { fee_component_id: feePct.id, version_no: 1, amount: 80000000 });
    const ph2: Record<string, Row> = {};
    const rows2: [string, string, string, string, string, number, number, number, number, string][] = [
      ['CD', 'Concept design', '2026-03-02', '2026-07-31', 'P03', 400, 396, 0, 100, 'Complete'],
      ['SD', 'Schematic design', '2026-08-03', '2026-12-04', 'P03', 500, 224, 276, 45, 'In progress'],
      ['WD', 'Working drawings', '2026-12-07', '2027-06-25', 'P03', 900, 0, 804, 0, 'Not started'],
      ['AS', 'Additional services', '2026-08-03', '2027-06-25', 'P06', 50, 48, 2, 90, 'In progress'],
    ];
    for (const [i, r] of rows2.entries()) {
      ph2[r[0]] = await mkPhase(prj2, i, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9]);
      await ins('phase_fee_allocation', { phase_id: ph2[r[0]].id, fee_component_id: r[0] === 'AS' ? feeNte.id : feePct.id, amount: r[0] === 'AS' ? 100000 : r[0] === 'CD' ? 960000 : r[0] === 'SD' ? 1200000 : 2640000 });
    }
    // The NTE example: ₹96,000 already consumed, leaving ₹4,000.
    await ins('nte_ledger', { fee_component_id: feeNte.id, entry_type: 'consumed', amount: 96000, note: 'Opening balance' });
    await ins('rate_schedule', { person_id: P.P06, project_id: prj2.id, rate_type: 'bill', amount: 1000, effective_from: from, change_reason: 'Agreed additional-service rate' });

    // PRJ-03: on hold.
    const prj3 = await mkProject('PRJ-03', 'Heritage Cafe Refit', 'Heritage Hospitality', 'P02', 'On hold', 'Fixed fee ₹6,00,000', [['P02', 'pm'], ['P10', 'viewer'], ['P01', 'reviewer']], 'Client funding, allocations retained');
    const fee3 = await mkFee(prj3, 'fixed', 'Fixed fee', 'fixed_percent', { contracted_amount: 600000 });
    const c3 = await mkPhase(prj3, 0, 'CD', 'Concept design', '2026-06-01', '2026-08-14', 'P02', 120, 110, 0, 100, 'Complete');
    const d3 = await mkPhase(prj3, 1, 'DD', 'Design development', '2026-08-17', '2027-01-15', 'P02', 280, 10, 270, 4, 'In progress');
    await ins('phase_fee_allocation', { phase_id: c3.id, fee_component_id: fee3.id, amount: 150000 });
    await ins('phase_fee_allocation', { phase_id: d3.id, fee_component_id: fee3.id, amount: 450000 });

    // Timesheets and time.
    const sheets = new Map<string, string>();
    const sheet = async (ref: string, week: string, status: string) => {
      const k = `${ref}-${week}`;
      if (!sheets.has(k)) sheets.set(k, (await ins('timesheet', { person_id: P[ref], period_start: week, period_end: addDays(week, 6), status, submitted_at: status === 'Open' ? null : new Date() })).id);
      return sheets.get(k)!;
    };
    const entry = async (ref: string, week: string, day: number, h: number, where: { phase?: Row; project?: Row; fee?: Row; cat?: string }, state = 'Draft', extra: Row = {}, tsStatus = 'Open') => ins('time_entry', {
      person_id: P[ref], service_date: addDays(week, day), project_id: where.project?.id ?? null, phase_id: where.phase?.id ?? null, internal_category_id: where.cat ?? null,
      fee_component_id: where.fee?.id ?? null, duration_hours: h, timesheet_id: await sheet(ref, week, tsStatus), approval_state: state, billing_state: where.cat ? 'Non-billable' : 'Unbilled', ...extra,
    });

    // Rohan's current week: 38.50 h with 12.50 h on Thursday.
    const wk: [Row | null, Row | null, Row | null, string | null, number[]][] = [
      [ph1.CD, prj1, fee1, null, [4, 4, 3, 6.5, 2]], [ph1.WD, prj1, fee1, null, [2, 2, 3, 4, 0]], [ph2.SD, prj2, feePct, null, [0, 1, 1, 2, 0]], [null, null, null, cats.admin, [1, 1, 0, 0, 0]], [null, null, null, cats.training, [0, 0, 1, 0, 1]],
    ];
    for (const [phase, project, fee, cat, hrs] of wk) for (const [d, h] of hrs.entries()) if (h) await entry('P04', thisWeek, d, h, { phase: phase ?? undefined, project: project ?? undefined, fee: fee ?? undefined, cat: cat ?? undefined });

    const request = async (ref: string, week: string, type: string, project: Row | null, approver: string, entries: Row[], flags: string[] = []) => {
      const ar = await ins('approval_request', { type, record_type: 'timesheet', record_id: await sheet(ref, week, 'Submitted'), project_id: project?.id ?? null, submitter_id: P[ref], approver_id: P[approver], exception_flags: flags });
      for (const e of entries) await db.query('insert into approval_request_entry (approval_request_id, time_entry_id, firm_id) values ($1,$2,$3)', [ar.id, e.id, firmId]);
      return ar;
    };

    // Last week: submitted, waiting on their approvers.
    const submitted = async (ref: string, approver: string, project: Row, phase: Row, fee: Row) => {
      const list: Row[] = [];
      for (let d = 0; d < 5; d++) list.push(await entry(ref, lastWeek, d, 8, { phase, project, fee }, 'Submitted', {}, 'Submitted'));
      await request(ref, lastWeek, 'time', project, approver, list);
    };
    await submitted('P05', 'P02', prj1, ph1.WD, fee1);
    await submitted('P07', 'P03', prj2, ph2.SD, feePct);

    // Arjun's returned line (scenario 6), and one unclassified line to fix.
    for (let d = 0; d < 5; d++) await entry('P08', thisWeek, d, [6, 8, 4, 8, 2][d], { phase: ph1.WD, project: prj1, fee: fee1 });
    for (const [d, h] of [[0, 2], [2, 4], [4, 4]] as const) await entry('P08', thisWeek, d, h, { phase: ph1.CD, project: prj1, fee: fee1 }, 'Returned', { return_reason: 'Returned by Vikram Nair: wrong phase' }, 'Returned');
    await db.query(`update timesheet set status = 'Returned' where person_id = $1 and period_start = $2`, [P.P08, thisWeek]);
    await entry('P08', thisWeek, 4, 2, {}, 'Draft');

    // Karan's six approved hours on the exhausted NTE (scenario 2). Rates were stored at approval.
    const rateOf = async (ref: string, type: string, projectId?: string) => (await db.query(
      `select id from rate_schedule where person_id = $1 and rate_type = $2 and project_id is not distinct from $3`, [P[ref], type, projectId ?? null],
    )).rows[0].id;
    await sheet('P06', lastWeek, 'Approved');
    await entry('P06', lastWeek, 1, 6, { phase: ph2.AS, project: prj2, fee: feeNte }, 'Approved', { bill_rate_schedule_id: await rateOf('P06', 'bill', prj2.id), cost_rate_schedule_id: await rateOf('P06', 'cost') }, 'Approved');

    // Nisha has no cost rate: an approved internal day shows the gap in reports (R22).
    await sheet('P09', lastWeek, 'Approved');
    await entry('P09', lastWeek, 0, 8, { phase: ph2.SD, project: prj2, fee: feePct }, 'Approved', { bill_rate_schedule_id: await rateOf('P09', 'bill') }, 'Approved');

    // Fixed-fee example: 40% billed on INV-DEMO-0007, 60% authorized, so the claim is ₹80,000.
    const auth40 = await ins('fee_authorization', { phase_fee_allocation_id: alloc1.CD, cumulative_percent: 40, authorized_by: P.P01 });
    await ins('fee_authorization', { phase_fee_allocation_id: alloc1.CD, cumulative_percent: 60, authorized_by: P.P01 });

    const finalDraft = await ins('billing_draft', { draft_no: 'DRAFT-0007', client_id: clients['Lakeview Trust'], project_id: prj1.id, cutoff_date: addDays(today, -45), approval_state: 'Approved', accounting_state: 'Finalized', idempotency_key: 'seed-draft-0007', prepared_by: P.P10 });
    const finalLine = await ins('billing_line', { billing_draft_id: finalDraft.id, phase_id: ph1.CD.id, fee_component_id: fee1.id, line_type: 'fixed_progress', label: 'Fixed fee claim, Concept design', calculation_basis: JSON.stringify({ fee: '400000.00', authorized_percent: '40', cumulative_entitlement: '160000.00', prior_net_billing: '0.00' }), previous_net_billing: 0, current_claim: 160000, remaining_entitlement: 240000 });
    await ins('source_allocation', { billing_line_id: finalLine.id, source_type: 'percent_claim', source_id: auth40.id, amount_claimed: 160000 });
    await ins('external_invoice', {
      billing_draft_id: finalDraft.id, project_id: prj1.id, client_id: clients['Lakeview Trust'], external_id: 'SEED-0007', invoice_no: 'INV-DEMO-0007', issue_date: addDays(today, -40), due_date: addDays(today, -40), gross: 160000, tax: 0, net: 160000,
      snapshot: JSON.stringify({ draft_no: 'DRAFT-0007', project: { code: 'PRJ-01', name: 'Lakeview Residence' }, client: 'Lakeview Trust', lines: [{ label: 'Fixed fee claim, Concept design', current_claim: '160000.00' }], totals: { net: '160000.00' } }),
      is_opening: true, follow_up_owner_id: P.P10, follow_up_date: addDays(today, 2),
    });

    // PRJ-02 schedule: one milestone is ready to bill, another sits in the approved draft (scenario 9).
    await ins('billing_milestone', { fee_component_id: feePct.id, phase_id: ph2.SD.id, label: 'Schematic design milestone', amount: 402000, status: 'Authorized' });
    const inDraft = await ins('billing_milestone', { fee_component_id: feePct.id, phase_id: ph2.CD.id, label: 'Concept design milestone', amount: 240000, status: 'Drafted' });

    const vendor = await ins('vendor', { name: 'Structural consultant' });
    const bill = await ins('supplier_bill', { vendor_id: vendor.id, invoice_no: 'SC-2041', bill_date: addDays(today, -25), amount: 250000, markup_percent: 10, approval_state: 'Finance approved', payable_state: 'Pending', recharge_state: 'Reserved', project_id: prj2.id, phase_id: ph2.SD.id, fee_component_id: feePct.id });
    await ins('supplier_bill', { vendor_id: vendor.id, invoice_no: 'SC-2041', bill_date: addDays(today, -9), amount: 250000, markup_percent: 10, approval_state: 'Draft', payable_state: 'Not payable', recharge_state: 'Not eligible', project_id: prj2.id, phase_id: ph2.SD.id, fee_component_id: feePct.id });

    const approved = await ins('billing_draft', { draft_no: 'DRAFT-0012', client_id: clients['Orchard Developers'], project_id: prj2.id, cutoff_date: addDays(today, -3), approval_state: 'Approved', accounting_state: 'Not submitted', idempotency_key: `seed-draft-0012-${firmId}`, prepared_by: P.P10 });
    const l1 = await ins('billing_line', { billing_draft_id: approved.id, phase_id: ph2.CD.id, fee_component_id: feePct.id, line_type: 'percent_schedule', label: 'Concept design milestone', calculation_basis: JSON.stringify({ milestone: 'Concept design milestone', construction_cost_basis: '80000000.00', basis_version: 1, fee_percent: '6.0000', total_fee: '4800000.00' }), current_claim: 240000 });
    await ins('source_allocation', { billing_line_id: l1.id, source_type: 'milestone', source_id: inDraft.id, amount_claimed: 240000 });
    const l2 = await ins('billing_line', { billing_draft_id: approved.id, phase_id: ph2.SD.id, fee_component_id: feePct.id, line_type: 'recharge', label: 'Structural consultant recharge, SC-2041', calculation_basis: JSON.stringify({ bill: '250000.00', markup_percent: '10.00', invoice_no: 'SC-2041' }), current_claim: 275000 });
    await ins('source_allocation', { billing_line_id: l2.id, source_type: 'supplier_bill', source_id: bill.id, amount_claimed: 275000 });

    await db.query('commit');
    return firmId as string;
  } catch (e) {
    await db.query('rollback').catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}
