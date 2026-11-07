import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/** Axe on real routes in both themes, including every list state reachable through ?demo=. */
const BUILT = [
  '/firm/overview', '/firm/overview?as=P02', '/firm/people', '/firm/people/P05?tab=overview', '/firm/people/P05?tab=access', '/firm/people/P05?tab=projects',
  '/firm/people/P05?tab=capacity', '/firm/people/P05?tab=leave', '/firm/people/P05?tab=rates', '/firm/people/P05?tab=rates&as=P02', '/firm/people/P05?tab=activity',
  '/firm/approvals', '/firm/projects', '/firm/projects/PRJ-01', '/firm/projects/PRJ-01?as=P02', '/firm/projects/PRJ-03',
];
const STATES = ['/firm/overview', '/firm/people', '/firm/approvals', '/firm/projects', '/firm/projects/PRJ-01'].flatMap((p) => ['loading', 'empty', 'error', 'denied'].map((d) => `${p}?demo=${d}`));

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    for (const path of [...BUILT, ...STATES]) {
      test(path, async ({ page }) => {
        await page.emulateMedia({ colorScheme });
        await page.goto(path);
        await page.evaluate(() => document.fonts.ready);
        if (!path.includes('demo=loading')) await page.getByLabel('Loading').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`);
        expect(summary).toEqual([]);
      });
    }
  });
}
