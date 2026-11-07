import { test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const out = (name: string) => fileURLToPath(new URL(`../../../docs/ui-screens/${name}.png`, import.meta.url));

const SHOTS = [
  { name: 'shell-firm', path: '/firm/overview' },
  { name: 'shell-project', path: '/firm/projects/PRJ-01/phases' },
  { name: 'shell-team', path: '/me/home?as=P04' },
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
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: out(`${shot.name}-${colorScheme}-${size.label}`), fullPage: false });
      });
    }
    test(`palette ${colorScheme} ${size.label}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme });
      await page.goto('/firm/overview');
      await page.evaluate(() => document.fonts.ready);
      await page.keyboard.press('Control+k');
      await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
      await page.screenshot({ path: out(`shell-palette-${colorScheme}-${size.label}`) });
    });
  }
}
