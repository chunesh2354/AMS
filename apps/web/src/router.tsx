import { Navigate, Outlet, createBrowserRouter, type RouteObject } from 'react-router-dom';
import { useSession, canUseFirm } from './app/session';
import { ShellLayout } from './layouts/ShellLayout';
import { PermissionDenied } from './ui/PermissionDenied';
import { PageHeader } from './ui/PageHeader';
import { ApprovalsScreen } from './screens/firm/approvals';
import { OverviewScreen } from './screens/firm/overview';
import { PeopleScreen } from './screens/firm/people';
import { PersonScreen } from './screens/firm/person';
import { ProjectLayout } from './screens/firm/project-layout';
import { ProjectOverviewScreen } from './screens/firm/project/overview';
import { ProjectPhasesScreen } from './screens/firm/project/phases';
import { ProjectStaffingScreen } from './screens/firm/project/staffing';
import { ProjectTasksScreen } from './screens/firm/project/tasks';
import { ProjectActivityScreen } from './screens/firm/project/activity';
import { ProjectChangesScreen } from './screens/firm/project/changes';
import { ProjectCostsScreen } from './screens/firm/project/costs';
import { ProjectFilesScreen } from './screens/firm/project/files';
import { ProjectTimeScreen } from './screens/firm/project/time';
import { PipelineScreen } from './screens/firm/pipeline';
import { ProposalScreen } from './screens/firm/proposal';
import { BillingScreen } from './screens/firm/billing';
import { ProjectBillingScreen } from './screens/firm/project/billing';
import { ReceivablesScreen } from './screens/firm/receivables';
import { ReportsScreen } from './screens/firm/reports';
import { SettingsScreen } from './screens/firm/settings';
import { WorkloadScreen } from './screens/firm/workload';
import { MyDayScreen } from './screens/me/home';
import { MyExpensesScreen } from './screens/me/expenses';
import { MyLeaveScreen } from './screens/me/leave';
import { MyProfileScreen } from './screens/me/profile';
import { MyScheduleScreen } from './screens/me/schedule';
import { MyTimeScreen } from './screens/me/time';
import { MyWorkScreen } from './screens/me/work';
import { ProjectsScreen } from './screens/firm/projects';
import { LoginScreen } from './screens/auth/login';
import { AcceptInviteScreen } from './screens/auth/accept-invite';
import { PlatformLoginScreen } from './screens/platform/login';
import { PlatformCompaniesScreen } from './screens/platform/companies';

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

/** Route paths come from section 9 of the brief and must not change. */
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to="/firm/overview" replace /> },
  { path: '/login', element: <LoginScreen /> },
  { path: '/accept-invite/:token', element: <AcceptInviteScreen /> },
  { path: '/platform/login', element: <PlatformLoginScreen /> },
  { path: '/platform', element: <PlatformCompaniesScreen /> },
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
        { path: 'workload', element: <WorkloadScreen /> },
        { path: 'pipeline', element: <PipelineScreen /> },
        { path: 'proposals/:id', element: <ProposalScreen /> },
        { path: 'projects', element: <ProjectsScreen /> },
        {
          path: 'projects/:id',
          element: <ProjectLayout />,
          children: [
            { index: true, element: <ProjectOverviewScreen /> },
            { path: 'phases', element: <ProjectPhasesScreen /> },
            { path: 'tasks', element: <ProjectTasksScreen /> },
            { path: 'staffing', element: <ProjectStaffingScreen /> },
            { path: 'time', element: <ProjectTimeScreen /> },
            { path: 'costs', element: <ProjectCostsScreen /> },
            { path: 'billing', element: <ProjectBillingScreen /> },
            { path: 'changes', element: <ProjectChangesScreen /> },
            { path: 'files', element: <ProjectFilesScreen /> },
            { path: 'activity', element: <ProjectActivityScreen /> },
          ],
        },
        { path: 'approvals', element: <ApprovalsScreen /> },
        { path: 'billing', element: <BillingScreen /> },
        { path: 'receivables', element: <ReceivablesScreen /> },
        { path: 'reports', element: <Navigate to="utilization" replace /> },
        { path: 'reports/:key', element: <ReportsScreen /> },
        { path: 'settings', element: <Navigate to="profile" replace /> },
        { path: 'settings/*', element: <SettingsScreen /> },
      ],
    }],
  },
  {
    path: '/me',
    element: <ShellLayout iface="team" />,
    children: [
      { index: true, element: <Navigate to="home" replace /> },
      { path: 'home', element: <MyDayScreen /> },
      { path: 'work', element: <MyWorkScreen /> },
      { path: 'schedule', element: <MyScheduleScreen /> },
      { path: 'time', element: <MyTimeScreen /> },
      { path: 'expenses', element: <MyExpensesScreen /> },
      { path: 'leave', element: <MyLeaveScreen /> },
      { path: 'profile', element: <MyProfileScreen /> },
    ],
  },
  { path: '*', element: <Navigate to="/firm/overview" replace /> },
];

export const router = createBrowserRouter(routes);
