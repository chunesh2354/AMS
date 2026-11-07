import type { Meta, StoryObj } from '@storybook/react-vite';
import { CalendarDays, Clock, Ellipsis, House, SquareCheckBig } from 'lucide-react';
import { BottomTabBar } from '.';

const meta: Meta<typeof BottomTabBar> = { title: 'Shell/BottomTabBar', component: BottomTabBar, parameters: { layout: 'fullscreen', route: '/me/time' } };
export default meta;
const i = { size: 20, strokeWidth: 1.5, 'aria-hidden': true };
export const Team: StoryObj = {
  render: () => (
    <div style={{ maxWidth: 390 }}>
      <BottomTabBar always label="Team" items={[
        { label: 'Home', to: '/me/home', icon: <House {...i} /> },
        { label: 'Work', to: '/me/work', icon: <SquareCheckBig {...i} /> },
        { label: 'Time', to: '/me/time', icon: <Clock {...i} /> },
        { label: 'Schedule', to: '/me/schedule', icon: <CalendarDays {...i} /> },
        { label: 'More', icon: <Ellipsis {...i} />, menu: [{ label: 'Expenses' }, { label: 'Leave' }, { label: 'Profile' }] },
      ]} />
    </div>
  ),
};
