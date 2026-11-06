import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Form, FormFooter, FormSection } from '.';

it('announces the validation summary', () => {
  render(<Form><FormSection title="Bill">x</FormSection><FormFooter summary="1 field needs attention">y</FormFooter></Form>);
  expect(screen.getByRole('heading', { name: 'Bill' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('1 field needs attention');
});
