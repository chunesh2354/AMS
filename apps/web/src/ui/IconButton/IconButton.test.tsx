import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IconButton } from '.';

it('uses the required label as its accessible name', () => {
  render(<IconButton label="Notifications" icon={<i />} />);
  expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
});
