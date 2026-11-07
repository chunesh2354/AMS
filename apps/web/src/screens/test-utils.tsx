import { render } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from '../router';
import { SessionProvider } from '../app/session';
import { ToastProvider } from '../ui/Toast';

/** Mounts the real router and shell at a path, as a given viewer. */
export function openApp(path: string, viewer = 'P01') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <SessionProvider initialViewer={viewer}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </SessionProvider>,
  );
  return router;
}
