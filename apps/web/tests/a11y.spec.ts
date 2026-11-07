import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

/** Section 12.3: zero contrast failures across all stories in both themes, plus the wider WCAG 2.1 AA ruleset. */
const STORYBOOK = 'http://localhost:6106';
const index = JSON.parse(readFileSync(new URL('../storybook-static/index.json', import.meta.url), 'utf8')) as {
  entries: Record<string, { id: string; type: string }>;
};
const stories = Object.values(index.entries).filter((e) => e.type === 'story').map((e) => e.id);

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    for (const id of stories) {
      test(id, async ({ page }) => {
        await page.goto(`${STORYBOOK}/iframe.html?id=${id}&viewMode=story&globals=theme:${theme}`);
        await page.waitForSelector(`html[data-theme="${theme}"]`);
        await page.waitForSelector('#storybook-root > *');
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`);
        expect(summary, `${id} in ${theme}`).toEqual([]);
      });
    }
  });
}
