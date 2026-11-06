import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IncompleteIndicator } from '.';

it('announces what is missing', () => {
  render(<IncompleteIndicator missing={['cost rate', 'hours']}>72%</IncompleteIndicator>);
  expect(screen.getByRole('group', { name: 'Incomplete data. Missing: cost rate, hours' })).toHaveTextContent('72%');
});
