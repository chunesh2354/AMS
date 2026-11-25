import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkloadHeatmap, type HeatRow } from '.';

const columns = ['7 Dec', '14 Dec', '21 Dec'].map((label) => ({ key: label, label }));
const row = (id: string, name: string): HeatRow => ({
  id, name, total: '60 h', avg: '50%',
  cells: columns.map((c, i) => ({ text: String(10 * (i + 1)), level: 'free' as const, off: 0, aria: `${name}, week of ${c.label}: ${10 * (i + 1)} of 40 hours, free` })),
});

describe('WorkloadHeatmap keyboard', () => {
  it('moves with the arrow keys, Home and End, and keeps one Tab stop on the last cell focused', async () => {
    const onSelect = vi.fn();
    render(
      <>
        <button type="button">Before</button>
        <WorkloadHeatmap label="Booked hours" columns={columns} rows={[row('a', 'Tara Joshi'), row('b', 'Dev Sharma')]} onSelect={onSelect} />
        <button type="button">After</button>
      </>,
    );
    const cell = (name: string, week: string) => screen.getByRole('button', { name: new RegExp(`^${name}, week of ${week}:`) });
    // One Tab stop in the whole table.
    expect(screen.getAllByRole('button').filter((b) => b.tabIndex === 0).map((b) => b.textContent)).toEqual(['Before', '10', 'After']);

    await userEvent.click(screen.getByRole('button', { name: 'Before' }));
    await userEvent.tab();
    expect(cell('Tara Joshi', '7 Dec')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(cell('Tara Joshi', '14 Dec')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(cell('Dev Sharma', '14 Dec')).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(cell('Dev Sharma', '21 Dec')).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(cell('Dev Sharma', '21 Dec')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(cell('Dev Sharma', '7 Dec')).toHaveFocus();

    // Tab leaves the table; Shift+Tab comes back to the same cell, not the first one.
    await userEvent.keyboard('{ArrowRight}');
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(cell('Dev Sharma', '14 Dec')).toHaveFocus();

    // Enter opens the week's detail.
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('b', 1);
  });
});
