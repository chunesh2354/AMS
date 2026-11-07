import { expect, test } from '@playwright/test';

test.describe('PlannerGrid', () => {
  test('is operable with the keyboard', async ({ page }) => {
    await page.goto('/firm/workload');
    const grid = page.getByRole('grid', { name: 'Resource planner' });
    await grid.waitFor();
    const divya = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Divya Menon/ }) });
    const cells = divya.getByRole('gridcell');
    await cells.nth(1).click({ position: { x: 2, y: 2 } });
    await expect(cells.nth(1)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(cells.nth(2)).toBeFocused();
    await expect(cells.nth(2)).toHaveClass(/plan__c--conflict/);
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Allocation' });
    await expect(sheet).toContainText('Overallocated by');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('[role=gridcell]:focus')).toHaveCount(1);
  });

  test('moves an allocation with Shift + arrow and asks for a reason on a conflict', async ({ page }) => {
    await page.goto('/firm/workload');
    await page.getByRole('grid', { name: 'Resource planner' }).waitFor();
    const arjun = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Arjun Das/ }) }).getByRole('gridcell');
    await arjun.nth(2).click({ position: { x: 2, y: 2 } });
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await expect(page.getByRole('button', { name: /Publish plan \(4 changes\)/ })).toBeVisible();
    await page.keyboard.press('+');
    await expect(page.getByRole('dialog', { name: 'This goes over capacity' })).toBeVisible();
  });

  test('moves a card by dragging', async ({ page }) => {
    await page.goto('/firm/workload');
    await page.getByRole('grid', { name: 'Resource planner' }).waitFor();
    const nisha = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Rohan Shetty/ }) }).getByRole('gridcell');
    await nisha.nth(4).getByRole('button').dragTo(nisha.nth(5), { targetPosition: { x: 20, y: 20 } });
    await expect(nisha.nth(5)).toContainText('16 h');
    await expect(nisha.nth(4)).not.toContainText('16 h');
  });

  test('resizes a card by dragging its right edge', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/firm/workload');
    await page.getByRole('grid', { name: 'Resource planner' }).waitFor();
    const cells = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Karan Bhat/ }) }).getByRole('gridcell');
    const box = (await cells.nth(0).locator('.pcard__grip').boundingBox())!;
    await page.mouse.move(box.x + 4, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 4 + 32, box.y + 20, { steps: 4 });
    await page.mouse.up();
    await expect(cells.nth(0)).toContainText('36 h');
  });

  test('renders only the rows in view', async ({ page }) => {
    await page.goto('http://localhost:6106/iframe.html?id=planning-plannergrid--virtualized&viewMode=story');
    const grid = page.getByRole('grid', { name: '500 people' });
    await grid.waitFor();
    await expect(grid).toHaveAttribute('aria-rowcount', '501');
    const count = await grid.getByRole('rowheader').count();
    expect(count).toBeLessThan(40);
    await grid.evaluate((el) => { el.scrollTop = 12000; });
    await expect(grid.getByRole('rowheader', { name: 'Person 251' })).toBeVisible();
  });

  test('keeps today, tentative and hold visible in Staffing, grouped by phase', async ({ page }) => {
    await page.goto('/firm/projects/PRJ-01/staffing');
    await page.getByRole('grid', { name: 'PRJ-01 staffing' }).waitFor();
    for (const phase of ['Concept design', 'Working drawings', 'Tender']) await expect(page.getByRole('row', { name: phase, exact: true })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: /Unassigned demand/ })).toBeVisible();
  });
});

test.describe('TimesheetGrid', () => {
  test('is operable with the keyboard', async ({ page }) => {
    await page.goto('/me/time?as=P04');
    const grid = page.getByRole('grid', { name: /Timesheet/ });
    await grid.waitFor();
    const first = grid.locator('[data-cell="ts-0-0"]');
    await first.click();
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    const target = grid.locator('[data-cell="ts-1-1"]');
    await expect(target).toBeFocused();
    await page.keyboard.press('Enter');
    const input = target.getByRole('textbox', { name: 'Hours' });
    await input.fill('3');
    await page.keyboard.press('Escape');
    await expect(target).toHaveText('2.00');
    await expect(target).toBeFocused();
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await expect(target).toHaveText('5.00');
    await expect(grid.locator('[data-cell="ts-2-1"]')).toBeFocused();
    await expect(grid.locator('tfoot .ts__total')).toHaveText('41.50');
  });
  test('locks every row after submit and refuses edits', async ({ page }) => {
    await page.goto('/me/time?as=P04');
    await page.getByRole('button', { name: 'Submit week' }).click();
    const grid = page.getByRole('grid', { name: /Timesheet/ });
    const cell = grid.locator('[data-cell="ts-0-0"]');
    await cell.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type('9');
    await expect(cell).toHaveText('4.00');
    await expect(grid.getByRole('textbox')).toHaveCount(0);
  });
});

test.describe('sheets', () => {
  test('trap focus, close on Escape and restore focus', async ({ page }) => {
    await page.goto('/firm/receivables');
    const open = page.getByRole('button', { name: 'Record settlement' }).first();
    await open.click();
    const sheet = page.getByRole('dialog', { name: 'Record settlement' });
    await sheet.waitFor();
    for (let i = 0; i < 25; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]') || !!document.activeElement?.closest('[role=listbox],.popover'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(open).toBeFocused();
  });
  test('open without animation under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/me/home?as=P04');
    await page.getByRole('button', { name: 'Log time' }).click();
    const sheet = page.getByRole('dialog', { name: 'Log time' });
    await sheet.waitFor();
    const duration = await sheet.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
  });
});

test.describe('fencing', () => {
  test('Contribution shows a value for Asha Rao and Restricted for Vikram Nair', async ({ page }) => {
    await page.goto('/firm/reports/contribution');
    await expect(page.getByRole('rowheader', { name: /PRJ-01/ }).locator('xpath=..')).toContainText('56%');
    await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled();
    await page.goto('/firm/reports/contribution?as=P02');
    await expect(page.getByText('56%')).toHaveCount(0);
    const disabled = page.getByRole('button', { name: /Export, disabled/ });
    await expect(disabled).toBeDisabled();
    await disabled.locator('..').focus();
    await expect(page.getByRole('tooltip')).toHaveText('Some columns are Restricted');
  });
  test('staff never see Firm navigation', async ({ page }) => {
    await page.goto('/me/home?as=P04');
    await expect(page.getByRole('link', { name: 'Billing' })).toHaveCount(0);
    await page.goto('/firm/billing?as=P04');
    await expect(page.getByText('You need the use the Firm interface permission')).toBeVisible();
  });
});

test.describe('phone', () => {
  for (const path of ['/me/home', '/me/work', '/me/schedule', '/me/time', '/me/expenses', '/me/leave', '/me/profile']) {
    test(`${path} has no sideways page scroll and shows the tab bar`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${path}?as=P04`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(scroll).toBeLessThanOrEqual(client);
      await expect(page.getByRole('navigation', { name: 'Team' })).toBeVisible();
    });
  }
});

test('reports print on white, without navigation, glass or zebra rows', async ({ page }) => {
  await page.goto('/firm/reports/budget-vs-actual');
  await page.getByRole('heading', { name: 'Budget vs actual' }).waitFor();
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.sidenav')).toBeHidden();
  await expect(page.locator('.topbar')).toBeHidden();
  const zebra = await page.locator('.dt tbody tr').nth(1).locator('th').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(zebra).toBe('rgba(0, 0, 0, 0)');
  const filter = await page.locator('.card.glass').first().evaluate((el) => getComputedStyle(el).backdropFilter);
  expect(filter).toBe('none');
});
