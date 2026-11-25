import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SessionProvider } from '../../../app/session';
import { ToastProvider } from '../../../ui/Toast';
import { ProjectTimelineScreen } from './timeline';
import { ProjectsScreen } from '../projects';

// Mock mode (the default build): both timelines draw the sample studio, and a save stays in the page.
function open(path: string) {
  render(
    <SessionProvider><ToastProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/firm/projects" element={<ProjectsScreen />} />
          <Route path="/firm/projects/:id/timeline" element={<ProjectTimelineScreen />} />
        </Routes>
      </MemoryRouter>
    </ToastProvider></SessionProvider>,
  );
}

describe('timelines in mock mode', () => {
  it('draws the sample project and saves a keyboard move locally', async () => {
    const user = userEvent.setup();
    open('/firm/projects/PRJ-01/timeline');
    const table = await screen.findByRole('table', { name: /phases and tasks on a timeline/ });
    expect(within(table).getAllByText('Working drawings').length).toBeGreaterThan(0);
    within(table).getByRole('button', { name: /^Working drawings, phase.*Select to move/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('Moved: 1 day later. Not saved yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('list', { name: 'Moved items' })).toHaveTextContent('Working drawings: 8 Sep to 19 Dec 2026');
  });

  it('draws the studio timeline from the sample projects', async () => {
    open('/firm/projects?view=timeline');
    const table = await screen.findByRole('table', { name: 'All projects on a timeline' });
    expect(within(table).getAllByRole('link').length).toBeGreaterThan(0);
  });
});
