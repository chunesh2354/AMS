import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { FIRM_LISTS, READY, TEAM_LISTS, withDemo } from './routes';

/** Axe on real routes in both themes, including every list state reachable through ?demo=. */
const STATES = [...FIRM_LISTS, ...TEAM_LISTS].flatMap((p) => ['loading', 'empty', 'error', 'denied'].map((d) => withDemo(p, d)));

const axe = async (page: Page) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`);
};

/** Sheets and overlays, opened the way a person opens them. */
const OVERLAYS: { name: string; path: string; click?: string; press?: string }[] = [
  { name: 'budget revision', path: '/firm/projects/PRJ-01/phases', click: 'Budget revision' },
  { name: 'task sheet', path: '/firm/projects/PRJ-01/tasks', click: '^Stair section at grid C' },
  { name: 'add task', path: '/firm/projects/PRJ-01/tasks', click: 'Add task' },
  { name: 'add cost', path: '/firm/projects/PRJ-01/costs', click: 'Add cost' },
  { name: 'compare bills', path: '/firm/projects/PRJ-01/costs', click: 'Compare bills' },
  { name: 'raise a change', path: '/firm/projects/PRJ-01/changes', click: 'Raise a change' },
  { name: 'link document', path: '/firm/projects/PRJ-01/files', click: 'Link document' },
  { name: 'create project', path: '/firm/proposals/PROP-01', click: 'Create project' },
  { name: 'add opportunity', path: '/firm/pipeline', click: 'Add opportunity' },
  { name: 'generate draft', path: '/firm/billing', click: 'Generate billing draft' },
  { name: 'submit to accounting', path: '/firm/billing?tab=drafts', click: 'Submit to accounting' },
  { name: 'record settlement', path: '/firm/receivables', click: 'Record settlement' },
  { name: 'log time', path: '/me/home?as=P04', click: 'Log time' },
  { name: 'request leave', path: '/me/home?as=P04', click: 'Request leave' },
  { name: 'new expense', path: '/me/expenses?as=P04', click: 'New expense' },
  { name: 'edit person', path: '/firm/people/P05', click: 'Edit person' },
];

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    for (const path of [...READY, ...STATES]) {
      test(path, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        if (!path.includes('demo=loading')) await page.getByLabel('Loading').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        expect(await axe(page)).toEqual([]);
      });
    }
    for (const o of OVERLAYS) {
      test(`overlay ${o.name}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.goto(o.path);
        await page.evaluate(() => document.fonts.ready);
        await page.getByLabel('Loading').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        await page.getByRole('button', { name: new RegExp(o.click!) }).first().click();
        await page.getByRole('dialog').waitFor();
        expect(await axe(page)).toEqual([]);
      });
    }
  });
}
