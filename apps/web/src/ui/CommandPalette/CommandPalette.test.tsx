import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette, fuzzyScore, useCommandShortcut } from '.';

const onSelect = vi.fn();
const actions = [
  { id: 'a', label: 'Log time', group: 'Actions', onSelect: () => {} },
  { id: 'b', label: 'Approvals', group: 'Navigate', onSelect },
];

describe('fuzzyScore', () => {
  it('matches subsequences and rejects others', () => {
    expect(fuzzyScore('apr', 'Approvals')).toBeGreaterThan(0);
    expect(fuzzyScore('zzz', 'Approvals')).toBe(0);
  });
  it('prefers word starts', () => {
    expect(fuzzyScore('lt', 'Log time')).toBeGreaterThan(fuzzyScore('lt', 'Salt'));
  });
});

describe('CommandPalette', () => {
  it('is keyboard driven', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} actions={actions} />);
    expect(screen.getByRole('combobox')).toHaveFocus();
    await userEvent.keyboard('apr{Enter}');
    expect(onSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
  it('moves with arrow keys', async () => {
    render(<CommandPalette open onClose={() => {}} actions={actions} />);
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Approvals' })).toHaveAttribute('aria-selected', 'true');
  });
  it('closes on Escape and shows empty and loading states', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<CommandPalette open onClose={onClose} actions={actions} />);
    await userEvent.keyboard('qqq');
    expect(screen.getByRole('status')).toHaveTextContent('No matches');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    rerender(<CommandPalette open onClose={onClose} actions={[]} loading />);
    expect(screen.getAllByLabelText('Loading').length).toBeGreaterThan(0);
  });
});

it('Ctrl K fires the shortcut', () => {
  const onOpen = vi.fn();
  const C = () => { useCommandShortcut(onOpen); return null; };
  render(<C />);
  fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
  expect(onOpen).toHaveBeenCalled();
});
