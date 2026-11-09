import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../../ui/Toast';
import type { Viewer } from '../../../app/session';
import { authorizedFloor, feeEditError, ProjectFeesEditor } from './billing-fees';
import { mayEditFees } from './billing';

// Live mode: the Fees editor on a project's Billing tab (PUT /projects/:code/fees).
vi.mock('../../../api/live', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../api/live')>()), isLive: true }));

type Reply = { status: number; body: unknown } | undefined;
let handler: (url: string, init: RequestInit) => Reply;
const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const r = handler(String(input), init) ?? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
  return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
});
const m = (amount: string) => ({ amount, currency: 'INR' });
const phase = (id: string, name: string, fee: string, pct = 0) => ({
  phase_id: id, code: name.slice(0, 2).toUpperCase(), name, component: 'Design services', billing_method: 'fixed_percent', fee: m(fee), fixed: true,
  authorized_percent: pct, authorizations: [],
});
const plan = (phases: unknown[]) => ({ status: 200, body: { project: { id: 'prj', code: 'LV-77', name: 'Harbour' }, can_authorize: true, components: [], phases, milestones: [] } });
const puts = () => fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith('/projects/LV-77/fees') && (i as RequestInit | undefined)?.method === 'PUT');

beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

function show(mayEdit = true, onSaved = vi.fn()) {
  render(<ToastProvider><ProjectFeesEditor code="LV-77" mayEdit={mayEdit} onSaved={onSaved} /></ToastProvider>);
  return onSaved;
}

describe('feeEditError', () => {
  it('needs the contracted fee, every phase fee, nothing below what is authorized, and an exact sum', () => {
    expect(feeEditError(null, [])).toBe('Enter the contracted fee.');
    expect(feeEditError(0, [])).toBe('Enter the contracted fee.');
    expect(feeEditError(100, [{ name: 'Concept design', fee: null, floor: 0 }])).toBe('Enter a fee for Concept design.');
    expect(feeEditError(100, [{ name: 'Concept design', fee: 40, floor: 50 }, { name: 'Tender', fee: 60, floor: 0 }])).toMatch(/Concept design has ₹50 authorized already/);
    expect(feeEditError(100, [{ name: 'Concept design', fee: 40, floor: 0 }, { name: 'Tender', fee: 50, floor: 0 }])).toMatch(/must add up to the fee/);
    expect(feeEditError(100.1, [{ name: 'Concept design', fee: 40.05, floor: 0 }, { name: 'Tender', fee: 60.05, floor: 0 }])).toBeNull();
    expect(authorizedFloor(400000, 50)).toBe(200000);
  });
});

describe('mayEditFees', () => {
  const viewer = (caps: Record<string, string>, led: string[] = []) => ({ capabilities: caps, ledProjects: led } as unknown as Viewer);
  it('follows the server: projects.create or changes.manage firm-wide, or changes.manage on a project the viewer leads', () => {
    expect(mayEditFees(viewer({ 'projects.create': 'firm' }), 'prj')).toBe(true);
    expect(mayEditFees(viewer({ 'changes.manage': 'firm' }), 'prj')).toBe(true);
    expect(mayEditFees(viewer({ 'changes.manage': 'scoped' }, ['prj']), 'prj')).toBe(true);
    expect(mayEditFees(viewer({ 'changes.manage': 'scoped' }, ['other']), 'prj')).toBe(false);
    expect(mayEditFees(viewer({ 'changes.manage': 'view', 'billing.prepare': 'firm' }), 'prj')).toBe(false);
  });
});

describe('Fees editor', () => {
  it('opens ready to edit when a fixed fee has no phase fees, refuses a wrong sum, then saves', async () => {
    handler = (url, init) => {
      if (url.endsWith('/projects/LV-77/fee-authorizations')) return plan([phase('ph-cd', 'Concept design', '0.00'), phase('ph-sd', 'Schematic design', '0.00')]);
      if (url.endsWith('/projects/LV-77/fees') && init.method === 'PUT') return { status: 200, body: { contracted_amount: m('1000000.00'), phases: [], audit_event_id: 'e' } };
      return undefined;
    };
    const onSaved = show();
    const section = await screen.findByRole('group', { name: 'Edit fees' });
    expect(screen.getByText(/has no phase fees yet/)).toBeInTheDocument();
    await userEvent.type(within(section).getByLabelText('Contracted fee'), '1000000');
    await userEvent.type(within(section).getByLabelText('Concept design fee'), '400000');
    await userEvent.type(within(section).getByLabelText('Schematic design fee'), '500000');
    await userEvent.click(within(section).getByRole('button', { name: 'Save fees' }));
    expect(within(section).getByRole('alert')).toHaveTextContent('Phase fees add up to ₹9,00,000. They must add up to the fee of ₹10,00,000.');
    expect(puts()).toHaveLength(0);

    await userEvent.clear(within(section).getByLabelText('Schematic design fee'));
    await userEvent.type(within(section).getByLabelText('Schematic design fee'), '600000');
    await userEvent.click(within(section).getByRole('button', { name: 'Save fees' }));
    expect(await screen.findByText('Fees saved. ₹10,00,000 across 2 phases.')).toBeInTheDocument();
    expect(JSON.parse(String((puts()[0]![1] as RequestInit).body))).toEqual({
      contracted_amount: 1000000, phases: [{ phase_id: 'ph-cd', fee: 400000 }, { phase_id: 'ph-sd', fee: 600000 }],
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows set fees with an Edit fees button and will not go below what is authorized; shows a server refusal', async () => {
    handler = (url, init) => {
      if (url.endsWith('/projects/LV-77/fee-authorizations')) return plan([phase('ph-cd', 'Concept design', '400000.00', 50), phase('ph-sd', 'Schematic design', '600000.00')]);
      if (url.endsWith('/projects/LV-77/fees') && init.method === 'PUT') return { status: 422, body: { error: { code: 'RULE_VIOLATION', message: 'Schematic design has 1000.00 authorized or billed already.', rule: 'F13' } } };
      return undefined;
    };
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit fees' }));
    const section = screen.getByRole('group', { name: 'Edit fees' });
    expect(within(section).getByLabelText('Contracted fee')).toHaveValue('10,00,000');
    expect(within(section).getByText('At least ₹2,00,000, already authorized')).toBeInTheDocument();
    const cd = within(section).getByLabelText('Concept design fee');
    await userEvent.clear(cd);
    await userEvent.type(cd, '150000');
    const sd = within(section).getByLabelText('Schematic design fee');
    await userEvent.clear(sd);
    await userEvent.type(sd, '850000');
    await userEvent.click(within(section).getByRole('button', { name: 'Save fees' }));
    expect(within(section).getByRole('alert')).toHaveTextContent('Concept design has ₹2,00,000 authorized already');
    expect(puts()).toHaveLength(0);

    await userEvent.clear(cd);
    await userEvent.type(cd, '200000');
    await userEvent.clear(sd);
    await userEvent.type(sd, '800000');
    await userEvent.click(within(section).getByRole('button', { name: 'Save fees' }));
    expect(await screen.findByText('Schematic design has 1000.00 authorized or billed already.')).toBeInTheDocument();
    expect(puts()).toHaveLength(1);
  });

  it('is not shown, and loads nothing, for someone who may not change fees', async () => {
    handler = () => plan([phase('ph-cd', 'Concept design', '0.00')]);
    show(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('heading', { name: 'Fees' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
