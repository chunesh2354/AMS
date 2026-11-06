import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PermissionDenied } from '.';

it('names the capability and who to ask', () => {
  render(<PermissionDenied capability="view billing" />);
  expect(screen.getByText(/view billing/)).toBeInTheDocument();
  expect(screen.getByText('Ask Asha Rao (Principal)')).toBeInTheDocument();
});
