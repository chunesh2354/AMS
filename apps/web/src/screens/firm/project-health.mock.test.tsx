import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProjectHealthView } from './project-health';

// Mock mode (the default build): sample rows in the API's shape, and no request to the server.
const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe('Project health view (mock)', () => {
  it('shows the sample projects without calling the API', async () => {
    render(<MemoryRouter><ProjectHealthView /></MemoryRouter>);
    expect(await screen.findByRole('table', { name: 'Project health' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PRJ-01 Lakeview Residence' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PRJ-03 Heritage Cafe Refit' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
