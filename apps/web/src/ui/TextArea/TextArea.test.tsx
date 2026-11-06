import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextArea } from '.';

it('renders a labelled textarea', () => {
  render(<TextArea label="Note" />);
  expect(screen.getByLabelText('Note').tagName).toBe('TEXTAREA');
});
