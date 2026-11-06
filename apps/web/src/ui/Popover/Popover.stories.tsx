import type { Meta, StoryObj } from '@storybook/react-vite';
import { Popover } from '.';
import { Button } from '../Button';

const meta: Meta<typeof Popover> = { title: 'Feedback/Popover', component: Popover };
export default meta;
export const Open: StoryObj = {
  render: () => (
    <div style={{ height: 180 }}>
      <Popover defaultOpen label="Project details" trigger={(p) => <Button {...p}>PRJ-01</Button>}>
        <div style={{ padding: 16, width: 280 }}>
          <p className="t-h3">Lakeview Residence</p>
          <p className="ink-2">Fixed fee, 6 phases. Project architect Vikram Nair.</p>
        </div>
      </Popover>
    </div>
  ),
};
