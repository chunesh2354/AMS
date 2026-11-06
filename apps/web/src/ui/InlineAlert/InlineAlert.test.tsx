import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InlineAlert } from '.';

it('can be dismissed', async () => {
  render(<InlineAlert title="Note" dismissible />);
  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(screen.queryByText('Note')).toBeNull();
});
