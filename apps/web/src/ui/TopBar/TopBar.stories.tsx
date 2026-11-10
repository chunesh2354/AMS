import type { Meta, StoryObj } from '@storybook/react-vite';
import { TopBar, type NotificationGroup } from '.';
import { TimerPill } from '../TimerPill';

const meta: Meta<typeof TopBar> = { title: 'Shell/TopBar', component: TopBar, parameters: { layout: 'fullscreen' } };
export default meta;
const notifications: NotificationGroup[] = [
  { label: 'Today', items: [{ id: '1', text: 'INV-DEMO-0007 is 40 days overdue', time: '09:00', unread: true }, { id: '2', text: 'Working drawings is forecast 30 h over budget', time: '14:30', unread: true }] },
  { label: 'Earlier', items: [{ id: '3', text: 'Divya Menon has a 2 h conflict in the week of 16 Nov', time: '05 Nov 2026' }] },
];
const base = { onSearch: () => {}, notifications, userName: 'Asha Rao', menuItems: [{ label: 'My profile' }] };
export const TimerIdle: StoryObj = { render: () => <TopBar {...base} timer={<TimerPill state="idle" />} /> };
export const TimerRunning: StoryObj = { render: () => <TopBar {...base} timer={<TimerPill state="running" elapsedSeconds={6120} context="PRJ-01 · Concept design" />} /> };
export const NotificationsOpen: StoryObj = { render: () => <div style={{ height: 320 }}><TopBar {...base} defaultNotificationsOpen /></div> };
