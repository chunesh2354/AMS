import type { Meta, StoryObj } from '@storybook/react-vite';
import { TaskRow } from '.';
import { Button } from '../Button';

const meta: Meta<typeof TaskRow> = { title: 'Data display/TaskRow', component: TaskRow };
export default meta;
export const States: StoryObj = {
  render: () => (
    <ul className="solid-panel" style={{ margin: 0, padding: 0, listStyle: 'none', maxWidth: 720 }}>
      <TaskRow title="Concept option B — courtyard" where="PRJ-01 · Concept design" due="2026-11-06" priority="High" status="In progress" reviewer="Vikram Nair" actions={<><Button size="dense">Block</Button><Button size="dense">Submit for review</Button></>} />
      <TaskRow title="Stair section at grid C" where="PRJ-01 · Working drawings" due="2026-11-06" priority="High" status="Blocked" reviewer="Vikram Nair" />
      <TaskRow title="Area statement" where="PRJ-02 · Schematic design" due="2026-11-08" priority="Low" status="Ready" reviewer="Meera Iyer" actions={<Button size="dense">Start</Button>} />
    </ul>
  ),
};
