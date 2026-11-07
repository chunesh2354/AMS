import type { BillingDraft, ImportRow, Integration, Invoice, NteException, Opportunity, Proposal, ReadyItem, Report } from '../api/types';

export const OPPORTUNITIES: Opportunity[] = [
  { id: 'OPP-01', stage: 'New', name: 'Sunrise Clinic Fitout', client: 'Sunrise Healthcare', fee: 900000, ownerId: 'P03', next: '2026-11-12' },
  { id: 'OPP-02', stage: 'Qualified', name: 'Palm Grove Villas', client: 'Palm Grove Estates', fee: 1800000, ownerId: 'P01', next: '2026-11-10' },
  { id: 'OPP-03', stage: 'Proposal', name: 'Riverside School Block', client: 'Riverside Education Trust', fee: 3200000, ownerId: 'P01', next: '2026-11-02', overdue: true, proposalId: 'PROP-02' },
  { id: 'OPP-04', stage: 'Won', name: 'Harbour Studio Offices', client: 'Harbour Realty', fee: 700000, ownerId: 'P01', next: '2026-11-09', proposalId: 'PROP-01' },
  { id: 'OPP-05', stage: 'Lost', name: 'Metro Library Annex', client: 'City Library Trust', fee: 1200000, ownerId: 'P03', next: null },
  { id: 'OPP-06', stage: 'On hold', name: 'Hillside Retreat', client: 'Hillside Hospitality', fee: 1500000, ownerId: 'P02', next: '2027-01-15' },
];

export const PROPOSALS: Proposal[] = [
  {
    id: 'PROP-01', name: 'Harbour Studio Offices', client: 'Harbour Realty', version: 'v3', state: 'Accepted', locked: true,
    scope: 'Interior architecture for two office floors, including layouts, joinery, services coordination and site supervision.',
    exclusions: 'Excludes structural design, statutory approvals and furniture procurement.',
    phases: [
      { name: 'Concept design', start: '2026-11-16', end: '2026-12-11', hours: 120 },
      { name: 'Working drawings', start: '2026-12-14', end: '2027-02-05', hours: 180 },
      { name: 'Site supervision', start: '2027-02-08', end: '2027-05-28', hours: 60 },
    ],
    fees: [{ name: 'Design services', method: 'Fixed', amount: 600000 }, { name: 'Site visits', method: 'Hourly NTE', amount: 100000 }],
    milestones: [
      { name: 'On acceptance', due: '2026-11-16', amount: 150000 },
      { name: 'Concept sign-off', due: '2026-12-11', amount: 200000 },
      { name: 'Working drawings issued', due: '2027-02-05', amount: 250000 },
    ],
    terms: 'Invoices are due in 30 days. Changes to scope are estimated and authorized before work starts.',
    versions: [
      { from: '2026-10-02', to: '2026-10-15', label: 'v1', detail: 'Superseded' },
      { from: '2026-10-16', to: '2026-10-27', label: 'v2', detail: 'Superseded' },
      { from: '2026-10-28', to: null, label: 'v3', detail: 'Accepted' },
    ],
    evidence: { name: 'Signed letter of award', by: 'Harbour Realty', date: '2026-11-03' },
  },
  {
    id: 'PROP-02', name: 'Riverside School Block', client: 'Riverside Education Trust', version: 'v2', state: 'Internal review', locked: false,
    scope: 'New three-storey classroom block with a shared hall, from concept to site supervision.',
    exclusions: 'Excludes landscape design and furniture procurement.',
    phases: [
      { name: 'Concept design', start: '2027-01-04', end: '2027-02-26', hours: 240 },
      { name: 'Working drawings', start: '2027-03-01', end: '2027-07-30', hours: 620 },
    ],
    fees: [{ name: 'Design services', method: 'Percent of cost', amount: 3200000 }],
    milestones: [{ name: 'On acceptance', due: '2027-01-04', amount: 640000 }],
    terms: 'Invoices are due in 30 days.',
    versions: [
      { from: '2026-10-05', to: '2026-10-25', label: 'v1', detail: 'Superseded' },
      { from: '2026-10-26', to: null, label: 'v2', detail: 'Internal review' },
    ],
    evidence: null,
  },
];

export const READY_ITEMS: ReadyItem[] = [
  { id: 'r1', project: 'PRJ-01', projectName: 'Lakeview Residence', component: 'Fixed fee', basis: 'Working drawings claim', amount: 80000, status: 'Eligible' },
  { id: 'r2', project: 'PRJ-02', projectName: 'Orchard Commercial Block', component: '6% of construction cost', basis: 'Schematic design milestone', amount: 402000, status: 'Eligible' },
  { id: 'r3', project: 'PRJ-02', projectName: 'Orchard Commercial Block', component: 'Hourly NTE', basis: 'Approved time, Karan Bhat', amount: 4000, status: 'Eligible' },
];

export const DRAFTS: BillingDraft[] = [
  {
    id: 'DRAFT-0012', project: 'PRJ-02', projectName: 'Orchard Commercial Block', client: 'Orchard Developers', preparedBy: 'P10', amount: 406000, status: 'Approved',
    lines: [
      { id: 'dl1', name: '6% fee, Schematic design milestone', source: 'Fee component', qty: 1, amount: 402000 },
      { id: 'dl2', name: 'Hourly NTE, eligible hours', source: '3 time entries', qty: 2, amount: 4000, detail: 'Karan Bhat, 2.00 h at ₹2,000, 26 to 28 Oct' },
    ],
    basis: [
      { label: 'Construction cost', value: '₹8,00,00,000' }, { label: 'Fee rate', value: '6%' }, { label: 'Stage share', value: '8.4%' }, { label: 'Milestone', value: '₹4,02,000' },
      { label: 'NTE limit', value: '₹1,00,000' }, { label: 'NTE eligible', value: '₹4,000' }, { label: 'NTE excess', value: '₹2,000', danger: true },
    ],
    note: 'Excess stays out of the draft until a change is authorized.',
  },
  {
    id: 'DRAFT-0013', project: 'PRJ-01', projectName: 'Lakeview Residence', client: 'Lakeview Trust', preparedBy: 'P10', amount: 80000, status: 'Pending (approval)',
    lines: [{ id: 'dl3', name: 'Fixed-fee claim, Working drawings', source: 'Fee component', qty: 1, amount: 80000 }],
    basis: [{ label: 'Fixed fee', value: '₹24,00,000' }, { label: 'Working drawings fee', value: '₹7,20,000' }, { label: 'Claim', value: '₹80,000' }],
  },
  {
    id: 'DRAFT-0014', project: 'PRJ-01', projectName: 'Lakeview Residence', client: 'Lakeview Trust', preparedBy: 'P10', amount: 275000, status: 'Pending (approval)',
    lines: [{ id: 'dl4', name: 'Structural consultant recharge', source: '1 bill', qty: 1, amount: 275000, detail: 'Bill of 12 Oct 2026, ₹2,50,000 plus 10% markup' }],
    basis: [{ label: 'Bill', value: '₹2,50,000' }, { label: 'Markup', value: '10%' }, { label: 'Recharge', value: '₹2,75,000' }],
  },
];

export const NTE: NteException[] = [{ id: 'n1', project: 'PRJ-02', projectName: 'Orchard Commercial Block', title: 'Hourly NTE limit reached', limit: 100000, billed: 96000, requested: 6000, eligible: 4000, excess: 2000, status: 'Excess' }];

export const WIP = [
  { project: 'PRJ-01', name: 'Lakeview Residence', entitled: 1152000, invoiced: 800000 },
  { project: 'PRJ-02', name: 'Orchard Commercial Block', entitled: 1462000, invoiced: 1056000 },
  { project: 'PRJ-03', name: 'Heritage Cafe Refit', entitled: 120000, invoiced: 120000 },
];

export const ACCOUNTING = { adapter: 'Mock accounting adapter', mode: 'MOCK' as const, status: 'Enabled' as const, lastSuccess: '06 Nov 2026 14:30', sent: '1 invoice' };

export const INVOICES: Invoice[] = [
  { id: 'INV-DEMO-0007', client: 'Orchard Developers', project: 'PRJ-02', issue: '2026-08-28', due: '2026-09-27', gross: 160000, cash: 0, withholding: 0, credits: 0, dispute: 'None', ownerId: 'P10', followUp: '2026-11-10', overdueDays: 40 },
  { id: 'INV-DEMO-0006', client: 'Heritage Hospitality', project: 'PRJ-03', issue: '2026-07-15', due: '2026-08-14', gross: 120000, cash: 120000, withholding: 0, credits: 0, dispute: 'None', ownerId: 'P10', followUp: null, overdueDays: 0 },
  { id: 'INV-DEMO-0005', client: 'Orchard Developers', project: 'PRJ-02', issue: '2026-07-01', due: '2026-07-31', gross: 896000, cash: 806400, withholding: 89600, credits: 0, dispute: 'None', ownerId: 'P10', followUp: null, overdueDays: 0 },
  { id: 'INV-DEMO-0004', client: 'Lakeview Trust', project: 'PRJ-01', issue: '2026-06-30', due: '2026-07-30', gross: 800000, cash: 800000, withholding: 0, credits: 0, dispute: 'None', ownerId: 'P10', followUp: null, overdueDays: 0 },
];

const P1 = 'PRJ-01 Lakeview Residence'; const P2 = 'PRJ-02 Orchard Commercial Block'; const P3 = 'PRJ-03 Heritage Cafe Refit';
const rr = (label: string, chart: number, value: string, extra: string, missing?: string[]) => ({ key: label, label, chart, value, extra, missing });
export const REPORTS: Report[] = [
  {
    key: 'utilization', label: 'Utilization', chart: 'bar', numerator: 'Approved billable hours in the period', denominator: 'Scheduled hours less holidays and leave', col1: 'Person', col2: 'Utilization', col3: 'Cost', headline: '78%', fenceExtra: true,
    missing: ['Nisha Kumar cost rate'],
    rows: [rr('Rohan Shetty', 86, '86%', '₹98,000'), rr('Divya Menon', 82, '82%', '₹92,000'), rr('Arjun Das', 80, '80%', '₹84,000'), rr('Karan Bhat', 76, '76%', '₹80,000'), rr('Sneha Pillai', 72, '72%', '₹61,000'), rr('Nisha Kumar', 38, '38%', 'Not set', ['Cost rate'])],
  },
  {
    key: 'contribution', label: 'Contribution', chart: 'bar', numerator: 'Fee entitled less staff cost and unrecharged costs', denominator: 'Fee entitled', col1: 'Project', col2: 'Contribution', col3: 'Staff cost', estimate: true, fenceValue: true, fenceExtra: true,
    rows: [rr(P1, 56, '56%', '₹5,12,000'), rr(P2, 61, '61%', '₹5,72,000'), rr(P3, 40, '40%', '₹72,000')],
  },
  {
    key: 'budget-vs-actual', label: 'Budget vs actual', chart: 'bar', numerator: 'Actual hours plus ETC', denominator: 'Revised budget hours', col1: 'Project', col2: 'Forecast (h)', col3: 'Variance (h)',
    rows: [rr(P1, 1102, '1,102', '+2'), rr(P2, 1700, '1,700', '-100'), rr(P3, 400, '400', '0')],
  },
  {
    key: 'fee-entitlement', label: 'Fee entitlement', chart: 'bar', numerator: 'Fee earned by delivery progress', denominator: 'Contracted fee', col1: 'Project', col2: 'Entitled', col3: 'Contracted', fenceValue: true, fenceExtra: true,
    rows: [rr(P1, 1152000, '₹11,52,000', '₹24,00,000'), rr(P2, 1462000, '₹14,62,000', '₹49,00,000'), rr(P3, 120000, '₹1,20,000', '₹6,00,000')],
  },
  {
    key: 'work-in-progress', label: 'Work in progress', chart: 'bar', numerator: 'Fee entitled less fee invoiced', denominator: 'None, this is an amount', col1: 'Project', col2: 'WIP', col3: 'Oldest (d)', fenceValue: true,
    rows: [rr(P1, 352000, '₹3,52,000', '21'), rr(P2, 406000, '₹4,06,000', '12'), rr(P3, 0, '₹0', '0')],
  },
  {
    key: 'receivables-ageing', label: 'Receivables ageing', chart: 'donut', numerator: 'Outstanding invoice amount', denominator: 'None, this is an amount', col1: 'Bucket', col2: 'Outstanding', col3: 'Invoices', fenceValue: true,
    rows: [rr('Current', 0, '₹0', '0'), rr('30 d', 160000, '₹1,60,000', '1'), rr('60 d', 0, '₹0', '0'), rr('90+ d', 0, '₹0', '0')],
  },
  {
    key: 'timesheet-compliance', label: 'Timesheet compliance', chart: 'line', numerator: 'Timesheets submitted on time', denominator: 'Timesheets due', col1: 'Week', col2: 'On time', col3: 'Missing',
    rows: [rr('12 Oct', 100, '100%', '0'), rr('19 Oct', 90, '90%', '1'), rr('26 Oct', 80, '80%', '2'), rr('02 Nov', 70, '70%', '3')],
  },
];

export const SETTINGS_LISTS: Record<string, { name: string; detail: string }[]> = {
  permissions: [{ name: 'Principal', detail: 'Everything, including rates and contribution' }, { name: 'Project manager', detail: 'Own projects, no rates' }, { name: 'Finance', detail: 'Billing, receivables and rates' }, { name: 'Operations', detail: 'People, calendars and imports' }, { name: 'Staff', detail: 'Own work only' }],
  calendars: [{ name: 'Bengaluru 2026', detail: '12 public holidays' }, { name: 'Bengaluru 2027', detail: '12 public holidays' }],
  'work-categories': [{ name: 'Project work', detail: 'Billable by default' }, { name: 'Studio admin', detail: 'Internal' }, { name: 'Training', detail: 'Internal' }],
  templates: [{ name: 'Residential, 6 phases', detail: 'Fixed fee' }, { name: 'Commercial, 5 phases', detail: 'Percent of cost' }, { name: 'Refit, 4 phases', detail: 'Fixed fee' }],
  'approval-policies': [{ name: 'Timesheets', detail: 'Project manager, exceptions over 12 h' }, { name: 'Expenses', detail: 'Manager, then finance' }, { name: 'Billing drafts', detail: 'Principal' }],
};

export const INTEGRATIONS: Integration[] = [
  { name: 'Accounting', mode: 'MOCK', body: 'Drafts submit to a mock adapter. Nothing reaches a real ledger.', action: 'Configure' },
  { name: 'Payroll', mode: 'Not configured', body: 'Connect payroll to reimburse approved expenses.', action: 'Set up' },
  { name: 'Calendar', mode: 'CSV', body: 'Holidays come from an uploaded file each year.', action: 'Upload file' },
  { name: 'Email', mode: 'Live', body: 'Sends invitations and approval reminders.', action: 'Manage' },
];

export const IMPORT_PREVIEW: ImportRow[] = [
  { row: 1, person: 'Sneha Pillai', title: 'Designer', manager: 'Meera Iyer', hours: '32' },
  { row: 2, person: 'Nisha Kumar', title: 'Intern', manager: 'Meera Iyar', hours: '40', errors: ['manager'] },
  { row: 3, person: 'Karan Bhat', title: 'Architect', manager: 'Meera Iyer', hours: 'forty', errors: ['hours'] },
];

/** Fee components with their own entitlement. Each project's components add up to the project's entitlement. */
export const FEE_COMPONENTS: Record<string, { name: string; method: string; entitlement: { contracted: number; entitled: number; drafted: number; invoiced: number; collected: number } }[]> = {
  'PRJ-01': [{ name: 'Fixed fee', method: 'Fixed', entitlement: { contracted: 2400000, entitled: 1152000, drafted: 880000, invoiced: 800000, collected: 800000 } }],
  'PRJ-02': [
    { name: '6% of construction cost', method: 'Percent of cost', entitlement: { contracted: 4800000, entitled: 1362000, drafted: 1362000, invoiced: 960000, collected: 800000 } },
    { name: 'Hourly NTE', method: 'Hourly NTE', entitlement: { contracted: 100000, entitled: 100000, drafted: 100000, invoiced: 96000, collected: 96000 } },
  ],
  'PRJ-03': [{ name: 'Fixed fee', method: 'Fixed', entitlement: { contracted: 600000, entitled: 120000, drafted: 120000, invoiced: 120000, collected: 120000 } }],
};
