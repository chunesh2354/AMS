import { useEffect } from 'react';
import type { Preview } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import '../src/ui/index.css';

const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Colour theme',
      toolbar: { title: 'Theme', icon: 'contrast', items: [{ value: 'light', title: 'Light' }, { value: 'dark', title: 'Dark' }], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'light' },
  parameters: {
    layout: 'padded',
    backgrounds: { disable: true },
    a11y: { test: 'error' },
    controls: { expanded: false },
  },
  decorators: [
    (Story, ctx) => {
      const theme = ctx.globals.theme as string;
      useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
      return <MemoryRouter><Story /></MemoryRouter>;
    },
  ],
};
export default preview;
