import type { Meta, StoryObj } from '@storybook/react-vite';
import { PeriodNav } from '.';

const meta: Meta<typeof PeriodNav> = { title: 'Planning/PeriodNav', component: PeriodNav };
export default meta;
export const Default: StoryObj = { render: () => <PeriodNav range="02 Nov to 08 Nov 2026" onPrev={() => {}} onNext={() => {}} onToday={() => {}} /> };
