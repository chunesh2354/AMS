import { Navigate, Outlet, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { useSession, canUseFirm } from './app/session';
import { ShellLayout } from './layouts/ShellLayout';
import { PermissionDenied } from './ui/PermissionDenied';
import { PageHeader } from './ui/PageHeader';
import { Placeholder } from './screens/Placeholder';
import { ApprovalsScreen } from './screens/firm/approvals';
import { OverviewScreen } from './screens/firm/overview';
import { PeopleScreen } from './screens/firm/people';
import { PersonScreen } from './screens/firm/person';
import { ProjectLayout } from './screens/firm/project-layout';
import { ProjectOverviewScreen } from './screens/firm/project/overview';
import { ProjectsScreen } from './screens/firm/projects';

function FirmGuard() {
  const { viewer } = useSession();
  if (canUseFirm(viewer)) return <Outlet />;
  return (
    <>
      <PageHeader title="Firm" />
      <div className="solid-panel"><PermissionDenied capability="use the Firm interface" /></div>
    </>
  );
}

const page = (path: string, title: string, task: string, crumb?: { label: string; to: string }): RouteObject => ({
  path,
  element: <Placeholder title={title} task={task} crumbs={crumb ? [crumb, { label: title }] : undefined} />,
});
const tab = (path: string, title: string, task: string): RouteObject => ({ path, element: <Placeholder embedded title={title} task={task} /> });

/** Route paths come from section 9 of the brief and must not change. */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/firm/overview" replace /> },
  {
    path: '/firm',
    element: <ShellLayout iface="firm" />,
    children: [{
      element: <FirmGuard />,
      children: [
        { index: true, element: <Navigate to="overview" replace /> },
        { path: 'overview', element: <OverviewScreen /> },
        { path: 'people', element: <PeopleScreen /> },
        { path: 'people/:id', element: <PersonScreen /> },
        page('workload', 'Workload', 'U-13'),
        page('pipeline', 'Pipeline', 'U-15'),
        page('proposals/:id', 'Proposal', 'U-15', { label: 'Pipeline', to: '/firm/pipeline' }),
        { path: 'projects', element: <ProjectsScreen /> },
        {
          path: 'projects/:id',
          element: <ProjectLayout />,
          children: [
            { index: true, element: <ProjectOverviewScreen /> },
            tab('phases', 'Phases', 'U-11'),
            tab('tasks', 'Tasks', 'U-12'),
            tab('staffing', 'Staffing', 'U-13'),
            tab('time', 'Time', 'U-14'),
            tab('costs', 'Costs', 'U-14'),
            tab('billing', 'Billing', 'U-16'),
            tab('changes', 'Changes', 'U-14'),
            tab('files', 'Files', 'U-14'),
            tab('activity', 'Activity', 'U-14'),
          ],
        },
        { path: 'approvals', element: <ApprovalsScreen /> },
        page('billing', 'Billing', 'U-16'),
        page('receivables', 'Receivables', 'U-17'),
        { path: 'reports', element: <Navigate to="utilization" replace /> },
        page('reports/:key', 'Reports', 'U-18'),
        { path: 'settings', element: <Navigate to="profile" replace /> },
        page('settings/*', 'Settings', 'U-18'),
      ],
    }],
  },
  {
    path: '/me',
    element: <ShellLayout iface="team" />,
    children: [
      { index: true, element: <Navigate to="home" replace /> },
      page('home', 'My day', 'U-19'),
      page('work', 'My work', 'U-19'),
      page('schedule', 'My schedule', 'U-13'),
      page('time', 'My time', 'U-19'),
      page('expenses', 'My expenses', 'U-19'),
      page('leave', 'My leave', 'U-19'),
      page('profile', 'My profile', 'U-19'),
    ],
  },
  { path: '*', element: <Navigate to="/firm/overview" replace /> },
];

export const router = createBrowserRouter(routes);
