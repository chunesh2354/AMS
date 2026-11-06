import { expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Segmented } from '.';

it('moves with arrow keys', async () => {
  const onChange = vi.fn();
  render(<Segmented label="Zoom" options={[{ value: 'w', label: 'Week' }, { value: 'd', label: 'Day' }]} value="w" onChange={onChange} />);
  await userEvent.tab();
  await userEvent.keyboard('{ArrowRight}');
  expect(onChange).toHaveBeenCalledWith('d');
});
