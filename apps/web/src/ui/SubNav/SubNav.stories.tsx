import type { Meta, StoryObj } from '@storybook/react-vite';
import { SubNav } from '.';

const meta: Meta<typeof SubNav> = { title: 'Shell/SubNav', component: SubNav, parameters: { route: '/firm/settings/integrations' } };
export default meta;
export const Default: StoryObj = {
  render: () => <div style={{ maxWidth: 240 }}><SubNav label="Settings" items={['Profile', 'Permissions', 'Integrations'].map((l) => ({ label: l, to: `/firm/settings/${l.toLowerCase()}` }))} /></div>,
};
