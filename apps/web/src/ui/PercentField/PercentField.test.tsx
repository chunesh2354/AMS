import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PercentField } from '.';

it('shows the percent suffix', () => {
  render(<PercentField label="Markup" defaultValue="10" />);
  expect(screen.getByText('%')).toBeInTheDocument();
});
