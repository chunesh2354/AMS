import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const ME = {
  person: { id: 'uuid-1', ref_code: 'P02', name: 'Vikram Nair', work_email: 'p02@meridian.demo', job_title: 'Project architect', manager_id: null },
  firm: { id: 'f', trading_name: 'Studio Meridian', legal_name: 'x', currency: 'INR', timezone: 'Asia/Kolkata', accounting_adapter: 'mock' },
  permission_sets: ['pm'],
  capabilities: { 'time.approve': 'scoped', 'rates.cost.view': 'view' },
  led_projects: ['prj-uuid'],
  member_projects: ['prj-uuid'],
};

describe('session in live mode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('shows a skeleton, then builds the viewer from GET /me and answers can() from the server', async () => {
    vi.stubEnv('VITE_LIVE', '1');
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(ME), { status: 200 })));
    const { SessionProvider, useSession, useCan, canUseFirm } = await import('./session');

    function Probe() {
      const { viewer } = useSession();
      const can = useCan();
      return (
        <p>
          {[viewer.id, viewer.name, viewer.title, viewer.roles.join(), viewer.personId, String(canUseFirm(viewer)),
            String(can('time.approve')), String(can('time.approve', { firmWide: true })), String(can('billing.submit'))].join('|')}
        </p>
      );
    }
    render(<SessionProvider><Probe /></SessionProvider>);
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(await screen.findByText('P02|Vikram Nair|Project architect|pm|uuid-1|true|true|false|false')).toBeInTheDocument();
  });

  it('shows the error with a retry when /me fails for a reason other than sign-in', async () => {
    vi.stubEnv('VITE_LIVE', '1');
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"code":"INTERNAL","message":"Something went wrong on our side."}}', { status: 500 })));
    const { SessionProvider } = await import('./session');
    render(<SessionProvider><p>app</p></SessionProvider>);
    expect(await screen.findByText('Something went wrong on our side.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('app')).not.toBeInTheDocument();
  });
});
