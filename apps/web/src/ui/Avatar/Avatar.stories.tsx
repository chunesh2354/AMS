import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar, AvatarGroup } from '.';

const meta: Meta<typeof Avatar> = { title: 'Data display/Avatar', component: Avatar };
export default meta;
export const Sizes: StoryObj = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Avatar name="Asha Rao" size={20} /><Avatar name="Vikram Nair" size={28} /><Avatar name="Meera Iyer" size={36} /></div>
      <AvatarGroup names={['Asha Rao', 'Vikram Nair', 'Meera Iyer', 'Rohan Shetty', 'Divya Menon']} />
      <AvatarGroup size={20} names={['Karan Bhat', 'Sneha Pillai', 'Arjun Das', 'Nisha Kumar']} />
    </div>
  ),
};
