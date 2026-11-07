/** Every route in section 9, once. Shared by the axe, alignment and empty-state suites. */
export const FIRM_LISTS = [
  '/firm/overview', '/firm/people', '/firm/approvals', '/firm/workload', '/firm/pipeline', '/firm/projects',
  '/firm/projects/PRJ-01', '/firm/projects/PRJ-01/phases', '/firm/projects/PRJ-01/tasks', '/firm/projects/PRJ-01/staffing', '/firm/projects/PRJ-01/time',
  '/firm/projects/PRJ-01/costs', '/firm/projects/PRJ-02/billing', '/firm/projects/PRJ-01/changes', '/firm/projects/PRJ-01/files', '/firm/projects/PRJ-01/activity',
  '/firm/billing', '/firm/billing?tab=drafts', '/firm/billing?tab=exceptions', '/firm/billing?tab=wip', '/firm/billing?tab=accounting', '/firm/receivables',
  '/firm/reports/utilization', '/firm/settings/permissions', '/firm/settings/integrations', '/firm/proposals/PROP-01',
];
export const TEAM_LISTS = ['/me/home?as=P04', '/me/work?as=P04', '/me/schedule?as=P04', '/me/time?as=P04', '/me/expenses?as=P04', '/me/leave?as=P04', '/me/profile?as=P04'];
export const READY = [
  ...FIRM_LISTS,
  '/firm/overview?as=P02', '/firm/people/P05?tab=overview', '/firm/people/P05?tab=access', '/firm/people/P05?tab=projects', '/firm/people/P05?tab=capacity', '/firm/people/P05?tab=leave',
  '/firm/people/P05?tab=rates', '/firm/people/P05?tab=rates&as=P02', '/firm/people/P05?tab=activity',
  '/firm/projects/PRJ-01?as=P02', '/firm/projects/PRJ-03', '/firm/projects/PRJ-01/tasks?view=list', '/firm/projects/PRJ-02/billing?as=P02', '/firm/billing?as=P02', '/firm/receivables?as=P02',
  '/firm/pipeline?view=list', '/firm/proposals/PROP-02', '/firm/proposals/OPP-02',
  ...['contribution', 'budget-vs-actual', 'fee-entitlement', 'work-in-progress', 'receivables-ageing', 'timesheet-compliance'].map((k) => `/firm/reports/${k}`), '/firm/reports/contribution?as=P02', '/firm/reports/utilization?as=P02',
  ...['profile', 'calendars', 'work-categories', 'templates', 'approval-policies', 'imports', 'imports?step=2', 'imports?step=3', 'imports?step=4'].map((k) => `/firm/settings/${k}`), '/firm/settings/profile?as=P02',
  ...TEAM_LISTS, '/me/work?as=P04&view=board', '/me/time?as=P08', '/me/profile?as=P04&section=personal',
];
export const withDemo = (path: string, demo: string) => `${path}${path.includes('?') ? '&' : '?'}demo=${demo}`;
