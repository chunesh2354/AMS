import { expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from '.';

it('renders eight rows plus a header for a table', () => {
  const { container } = render(<Skeleton kind="table" />);
  expect(container.querySelectorAll('.skeleton-table__row')).toHaveLength(9);
});
