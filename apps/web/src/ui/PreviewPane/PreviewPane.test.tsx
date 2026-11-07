import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreviewPane } from '.';

it('shows the record, evidence and history', () => {
  render(<PreviewPane eyebrow="Time" title="Arjun Das" fields={[{ label: 'Hours', value: '40.00 h' }]} evidence={['Timesheet']} history={[{ text: 'Submitted', time: '5 d ago' }]} />);
  expect(screen.getByRole('heading', { name: 'Arjun Das' })).toBeInTheDocument();
  expect(screen.getByText('40.00 h')).toBeInTheDocument();
  expect(screen.getByText('Timesheet')).toBeInTheDocument();
  expect(screen.getByText('Submitted')).toBeInTheDocument();
});
it('prompts when empty', () => {
  render(<PreviewPane state="empty" />);
  expect(screen.getByText('Select an item to preview it.')).toBeInTheDocument();
});
