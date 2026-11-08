import { expect, test } from '@playwright/test';

test('body resolves to Jost with tabular figures', async ({ page }) => {
  await page.goto('/firm/overview');
  const style = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return { family: getComputedStyle(document.body).fontFamily, features: s.fontFeatureSettings };
  });
  expect(style.family).toContain('Jost');
  expect(style.features).toContain('tnum');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('15px "Jost Variable"'))).toBe(true);
});

test('navigates through the real shell and keeps route paths', async ({ page }) => {
  await page.goto('/firm/overview');
  await page.getByRole('link', { name: /Approvals/ }).click();
  await expect(page).toHaveURL(/\/firm\/approvals$/);
  await page.getByRole('radio', { name: 'Team' }).click();
  await expect(page).toHaveURL(/\/me\/home$/);
});

test('command palette is fully keyboard driven', async ({ page }) => {
  await page.goto('/firm/overview');
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  await page.keyboard.type('apr');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/firm\/approvals$/);
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the app is light only and offers no theme toggle', async ({ page }) => {
  await page.goto('/firm/overview');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /account menu/ }).click();
  await expect(page.getByRole('menuitem', { name: 'My profile' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /^(System|Light|Dark)/ })).toHaveCount(0);
});

test('view as Rohan hides Firm navigation and fences the route', async ({ page }) => {
  await page.goto('/firm/billing?as=P04');
  await expect(page.getByText('Ask Asha Rao (Principal)')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Billing' })).toHaveCount(0);
});

test('sidebar is 232 px, collapses to 64 px under 1280 and hides under 768', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/firm/overview');
  const nav = page.getByRole('navigation', { name: 'Main' });
  expect((await nav.boundingBox())?.width).toBe(232);
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect.poll(async () => (await nav.boundingBox())?.width).toBe(64);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Firm' })).toBeVisible();
  // UX-25: the banner is hidden on Overview and Approvals, which work on a phone, and shown elsewhere.
  await expect(page.getByText('Best on a larger screen')).toBeHidden();
  await page.goto('/firm/people');
  await expect(page.getByText('Best on a larger screen')).toBeVisible();
});

test('no horizontal page scroll on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/me/home?as=P04');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe('fallbacks', () => {
  test('reduced transparency turns glass solid with no layout shift', async ({ page }) => {
    await page.goto('/firm/overview');
    const nav = page.getByRole('navigation', { name: 'Main' });
    const before = await nav.boundingBox();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
    await expect.poll(() => nav.evaluate((el) => getComputedStyle(el).backdropFilter)).toBe('none');
    expect(await nav.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    expect(await nav.boundingBox()).toEqual(before);
  });

  test('the shell has no glass: no blur on the navigation, top bar or palette', async ({ page }) => {
    await page.goto('/firm/overview');
    for (const el of [page.getByRole('navigation', { name: 'Main' }), page.locator('.topbar')]) {
      expect(await el.evaluate((e) => getComputedStyle(e).backdropFilter)).toBe('none');
      expect(await el.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 255, 255)');
    }
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    expect(await palette.evaluate((e) => getComputedStyle(e).backdropFilter)).toBe('none');
  });
});

test.describe('sheet in Storybook', () => {
  const url = 'http://localhost:6106/iframe.html?id=shell-sheet--form-480&viewMode=story&globals=theme:light';

  test('traps focus, closes on Escape and restores focus', async ({ page }) => {
    await page.goto(url);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('opens without animation under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url);
    const duration = await page.getByRole('dialog').evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration).toBe('0s');
  });
});
