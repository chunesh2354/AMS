import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toggle } from '.';

it('is a switch that toggles', async () => {
  render(<Toggle label="Billable" />);
  const s = screen.getByRole('switch', { name: 'Billable' });
  await userEvent.click(s);
  expect(s).toBeChecked();
});
