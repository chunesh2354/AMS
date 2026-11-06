import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileDrop } from '.';

it('passes chosen files on', async () => {
  const onFiles = vi.fn();
  render(<FileDrop label="Receipt" onFiles={onFiles} />);
  const file = new File(['x'], 'taxi.jpg', { type: 'image/jpeg' });
  await userEvent.upload(screen.getByLabelText(/Receipt/), file);
  expect(onFiles.mock.calls[0][0][0].name).toBe('taxi.jpg');
});
