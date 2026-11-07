import { test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const out = (name: string) => fileURLToPath(new URL(`../../../docs/ui-screens/${name}.png`, import.meta.url));

const settle = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  await page.getByLabel('Loading').first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
};

const SHOTS = [
  { name: 'shell-team', path: '/me/home?as=P04' },
  { name: 'firm-overview', path: '/firm/overview' },
  { name: 'firm-overview-pm', path: '/firm/overview?as=P02' },
  { name: 'firm-people', path: '/firm/people' },
  { name: 'firm-person-capacity', path: '/firm/people/P05?tab=capacity' },
  { name: 'firm-approvals', path: '/firm/approvals' },
  { name: 'firm-projects', path: '/firm/projects' },
  { name: 'firm-project-overview', path: '/firm/projects/PRJ-01' },
  { name: 'firm-project-overview-pm', path: '/firm/projects/PRJ-01?as=P02' },
];
const SIZES = [
  { label: '1440', width: 1440, height: 900 },
  { label: '390', width: 390, height: 844 },
];

for (const colorScheme of ['light', 'dark'] as const) {
  for (const size of SIZES) {
    for (const shot of SHOTS) {
      test(`${shot.name} ${colorScheme} ${size.label}`, async ({ page }) => {
        await page.setViewportSize({ width: size.width, height: size.height });
        await page.emulateMedia({ colorScheme });
        await page.goto(shot.path);
        await settle(page);
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
        await page.waitForTimeout(100);
        await page.screenshot({ path: out(`${shot.name}-${colorScheme}-${size.label}`) });
      });
    }
    test(`palette ${colorScheme} ${size.label}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme });
      await page.goto('/firm/overview');
      await settle(page);
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
      await page.screenshot({ path: out(`shell-palette-${colorScheme}-${size.label}`) });
    });
    test(`add person sheet ${colorScheme} ${size.label}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme });
      await page.goto('/firm/people?add=1');
      await settle(page);
      await page.getByRole('dialog', { name: 'Add person' }).waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: out(`firm-people-add-${colorScheme}-${size.label}`) });
    });
  }
}
