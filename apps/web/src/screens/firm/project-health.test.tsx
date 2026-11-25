import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { mockProjectHealth, type HealthRow } from '../../api/live/health';
import { ProjectHealthView } from './project-health';

// Live mode, as a VITE_LIVE=1 build: the Health view reads GET /projects/health.
vi.mock('../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/live')>()), isLive: true }));

const sample = mockProjectHealth().rows;
const restricted = (r: HealthRow): HealthRow => ({ ...r, fee: { restricted: true }, margin: { restricted: true }, margin_target: { restricted: true } });
let reply: { status: number; body: unknown };
const fetchMock = vi.fn(async () => new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } }));
const ok = (rows: HealthRow[]) => ({
  status: 200,
  body: {
    data: rows, page: 1, page_size: 200, total: rows.length, complete: true, missing_count: 0, today: '2026-11-25', timezone: 'Asia/Kolkata', as_of: null,
    rule: ['RULE ONE from the API.', 'Schedule: a slip of more than 7 days is At risk; 1 to 7 days is Watch.'],
    thresholds: { hours_watch_pct: 90, hours_at_risk_above_pct: 100, slip_watch_days: 1, slip_at_risk_above_days: 7 },
    margin_definition: 'Margin to date = (fee authorized - labour cost) / fee authorized.',
  },
});

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

const open = () => render(<MemoryRouter><ProjectHealthView /></MemoryRouter>);
const rowNames = () => screen.getAllByRole('rowheader').map((h) => within(h).getByRole('link').textContent);

describe('Project health view (live)', () => {
  it('shows counts, rows with the API status and why line, sorted by risk', async () => {
    reply = ok(sample);
    open();
    const table = await screen.findByRole('table', { name: 'Project health' });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/v1/projects/health?page_size=200');
    const counts = screen.getByLabelText('Projects by health');
    expect(within(counts).getByText('1')).toBeInTheDocument();
    expect(within(counts).getByText('2')).toBeInTheDocument();
    expect(rowNames()[0]).toBe('PRJ-01 Lakeview Residence');
    const first = within(table).getAllByRole('row')[1];
    expect(within(first).getByText('At risk')).toBeInTheDocument();
    expect(within(first).getByText(/1 overdue task blocks other work: "GA plans issued"/)).toBeInTheDocument();
    expect(within(first).getByRole('img', { name: /1,268 of 1,800 hours used, forecast 1,830, 30 over budget/ })).toBeInTheDocument();
    expect(within(first).getByRole('img', { name: 'Fee authorized ₹42.0 L, billed ₹27.3 L, collected ₹21.0 L' })).toBeInTheDocument();
    expect(within(first).getByText('23%')).toBeInTheDocument();
    expect(within(first).getByText('target 25%')).toBeInTheDocument();
    expect(within(first).getByText('5 days')).toBeInTheDocument();
    expect(within(first).getByText('2 overdue')).toBeInTheDocument();
    expect(within(first).getByRole('link', { name: 'PRJ-01 Lakeview Residence' })).toHaveAttribute('href', '/firm/projects/PRJ-01');
  });

  it('sorts by name and by slip from the keyboard-reachable Sort by control', async () => {
    const user = userEvent.setup();
    reply = ok(sample);
    open();
    await screen.findByRole('table', { name: 'Project health' });
    await user.click(screen.getByRole('radio', { name: 'Name' }));
    expect(rowNames()).toEqual(['PRJ-03 Heritage Cafe Refit', 'PRJ-01 Lakeview Residence', 'PRJ-02 Orchard Commercial Block']);
    await user.click(screen.getByRole('radio', { name: 'Slip' }));
    expect(rowNames()[0]).toBe('PRJ-01 Lakeview Residence');
  });

  it('locks fee and margin for a viewer without them, and says health still counts margin', async () => {
    reply = ok(sample.map(restricted));
    open();
    await screen.findByRole('table', { name: 'Project health' });
    expect(screen.getAllByText('Restricted')).toHaveLength(6);
    expect(screen.queryByText('23%')).toBeNull();
    expect(screen.getByText(/Health still takes it into account/)).toBeInTheDocument();
  });

  it('explains health from the API rule and thresholds, not a copy in the client', async () => {
    const user = userEvent.setup();
    reply = ok(sample);
    open();
    const toggle = await screen.findByRole('button', { name: 'How health is worked out' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('RULE ONE from the API.')).toBeNull();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('RULE ONE from the API.')).toBeInTheDocument();
    expect(screen.getByText('90% of budget')).toBeInTheDocument();
    expect(screen.getByText(/Margin to date =/)).toBeInTheDocument();
  });

  it('shows the denied state for staff (403) and copes with a project that has no budget', async () => {
    reply = { status: 403, body: { error: { code: 'FORBIDDEN_CAPABILITY', message: 'No' } } };
    const { unmount } = open();
    expect(await screen.findByText(/view project health/)).toBeInTheDocument();
    unmount();
    reply = ok([{ ...sample[1], hours: { budget: '0.00', actual: '12.00', etc: '0.00', forecast: '12.00', forecast_pct: null } }]);
    open();
    expect(await screen.findByText('12 h, no budget')).toBeInTheDocument();
  });
});
