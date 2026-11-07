import { test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const out = (name: string) => fileURLToPath(new URL(`../../../docs/ui-screens/${name}.png`, import.meta.url));

const settle = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.getByLabel('Loading').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
};

type Shot = { name: string; path: string; phone?: boolean; click?: string; press?: string };

/** All 28 screens in section 9, then key states and overlays. Team screens, Overview and Approvals also shoot at 390 px. */
const SHOTS: Shot[] = [
  { name: 'firm-overview', path: '/firm/overview', phone: true },
  { name: 'firm-overview-pm', path: '/firm/overview?as=P02' },
  { name: 'firm-people', path: '/firm/people' },
  { name: 'firm-person-capacity', path: '/firm/people/P05?tab=capacity' },
  { name: 'firm-workload', path: '/firm/workload' },
  { name: 'firm-pipeline', path: '/firm/pipeline' },
  { name: 'firm-proposal', path: '/firm/proposals/PROP-01' },
  { name: 'firm-projects', path: '/firm/projects' },
  { name: 'firm-project-overview', path: '/firm/projects/PRJ-01' },
  { name: 'firm-project-overview-pm', path: '/firm/projects/PRJ-01?as=P02' },
  { name: 'firm-project-phases', path: '/firm/projects/PRJ-01/phases' },
  { name: 'firm-project-tasks', path: '/firm/projects/PRJ-01/tasks' },
  { name: 'firm-project-staffing', path: '/firm/projects/PRJ-01/staffing' },
  { name: 'firm-project-time', path: '/firm/projects/PRJ-01/time' },
  { name: 'firm-project-costs', path: '/firm/projects/PRJ-01/costs' },
  { name: 'firm-project-billing', path: '/firm/projects/PRJ-02/billing' },
  { name: 'firm-project-changes', path: '/firm/projects/PRJ-01/changes' },
  { name: 'firm-project-files', path: '/firm/projects/PRJ-01/files' },
  { name: 'firm-project-activity', path: '/firm/projects/PRJ-01/activity' },
  { name: 'firm-approvals', path: '/firm/approvals', phone: true },
  { name: 'firm-billing', path: '/firm/billing' },
  { name: 'firm-billing-draft', path: '/firm/billing?tab=drafts' },
  { name: 'firm-billing-accounting', path: '/firm/billing?tab=accounting' },
  { name: 'firm-receivables', path: '/firm/receivables' },
  { name: 'firm-reports', path: '/firm/reports/utilization' },
  { name: 'firm-reports-contribution-pm', path: '/firm/reports/contribution?as=P02' },
  { name: 'firm-settings', path: '/firm/settings/profile' },
  { name: 'firm-settings-integrations', path: '/firm/settings/integrations' },
  { name: 'firm-settings-import', path: '/firm/settings/imports?step=3' },
  { name: 'me-home', path: '/me/home?as=P04', phone: true },
  { name: 'me-work', path: '/me/work?as=P04', phone: true },
  { name: 'me-schedule', path: '/me/schedule?as=P04', phone: true },
  { name: 'me-time', path: '/me/time?as=P04', phone: true },
  { name: 'me-time-returned', path: '/me/time?as=P08', phone: true },
  { name: 'me-expenses', path: '/me/expenses?as=P04', phone: true },
  { name: 'me-leave', path: '/me/leave?as=P04', phone: true },
  { name: 'me-profile', path: '/me/profile?as=P04', phone: true },
  { name: 'sheet-add-person', path: '/firm/people?add=1' },
  { name: 'sheet-budget-revision', path: '/firm/projects/PRJ-01/phases', click: 'Budget revision' },
  { name: 'sheet-task', path: '/firm/projects/PRJ-01/tasks', click: '^Stair section at grid C' },
  { name: 'sheet-create-project', path: '/firm/proposals/PROP-01', click: 'Create project' },
  { name: 'sheet-submit-mock', path: '/firm/billing?tab=drafts', click: 'Submit to accounting' },
  { name: 'sheet-settlement', path: '/firm/receivables', click: 'Record settlement' },
  { name: 'sheet-log-time', path: '/me/home?as=P04', click: 'Log time', phone: true },
  { name: 'sheet-request-leave', path: '/me/home?as=P04', click: 'Request leave', phone: true },
  { name: 'sheet-new-expense', path: '/me/expenses?as=P04', click: 'New expense' },
  { name: 'overlay-palette', path: '/firm/overview', press: 'Control+k', phone: true },
  { name: 'overlay-notifications', path: '/firm/overview', click: 'Notifications' },
  { name: 'overlay-denied', path: '/firm/billing?as=P02' },
];
const SIZES = [{ label: '1440', width: 1440, height: 900 }, { label: '390', width: 390, height: 844 }];

for (const colorScheme of ['light', 'dark'] as const) {
  for (const size of SIZES) {
    for (const shot of SHOTS.filter((s) => size.label === '1440' || s.phone)) {
      test(`${shot.name} ${colorScheme} ${size.label}`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.goto(shot.path);
        await settle(page);
        if (shot.click) await page.getByRole('button', { name: new RegExp(shot.click) }).first().click();
        if (shot.press) await page.keyboard.press(shot.press);
        if (shot.click || shot.press) {
          await page.waitForTimeout(150);
          await page.screenshot({ path: out(`${shot.name}-${colorScheme}-${size.label}`) });
          return;
        }
        if (await page.getByRole('dialog').count()) {
          await page.waitForTimeout(150);
          await page.screenshot({ path: out(`${shot.name}-${colorScheme}-${size.label}`) });
          return;
        }
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
        await page.waitForTimeout(100);
        await page.screenshot({ path: out(`${shot.name}-${colorScheme}-${size.label}`) });
      });
    }
  }
}
