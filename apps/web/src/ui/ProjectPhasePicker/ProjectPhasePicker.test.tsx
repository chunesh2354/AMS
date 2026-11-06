import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectPhasePicker } from '.';

it('finds a phase by its project name', async () => {
  render(<ProjectPhasePicker label="Where" projects={[{ code: 'PRJ-01', name: 'Lakeview', phases: [{ id: 'x', name: 'Concept' }] }]} value={null} />);
  await userEvent.type(screen.getByRole('combobox'), 'lakeview');
  expect(screen.getByRole('option', { name: 'PRJ-01 · Concept' })).toBeInTheDocument();
});
