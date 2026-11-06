import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import { FilterBar } from '.';

const Url = () => { const [p] = useSearchParams(); return <code>{p.toString()}</code>; };

it('writes to URL params and clears them', async () => {
  render(
    <MemoryRouter>
      <FilterBar filters={[{ type: 'select', key: 'pm', label: 'PM', options: [{ value: 'P02', label: 'Vikram Nair' }] }]} />
      <Url />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'PM' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Vikram Nair' }));
  expect(screen.getByRole('status')).toHaveTextContent('1 active');
  expect(document.querySelector('code')).toHaveTextContent('pm=P02');
  await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  expect(document.querySelector('code')).toBeEmptyDOMElement();
});
