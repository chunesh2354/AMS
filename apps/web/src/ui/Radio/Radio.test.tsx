import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Radio } from '.';

it('selects within a named group', async () => {
  render(<><Radio name="a" label="One" defaultChecked /><Radio name="a" label="Two" /></>);
  await userEvent.click(screen.getByLabelText('Two'));
  expect(screen.getByLabelText('One')).not.toBeChecked();
});
