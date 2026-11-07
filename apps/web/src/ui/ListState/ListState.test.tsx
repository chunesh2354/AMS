import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListStateBlock } from '.';

it.each([
  ['loading', 'Loading'], ['empty', 'Nothing to show yet.'], ['error', 'Items could not be loaded.'], ['denied', /permission/],
] as const)('renders %s', (state, text) => {
  render(<ListStateBlock state={state} label="Items" />);
  expect(state === 'loading' ? screen.getByLabelText(text as string) : screen.getByText(text)).toBeInTheDocument();
});
