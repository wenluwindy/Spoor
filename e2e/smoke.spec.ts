import { test, expect, type Page } from '@playwright/test';

/**
 * 冒烟链（roadmap D13）：建卡 → 写字 → 连线 → 撤销 → 搜索。
 *
 * 走真实浏览器（`npm run dev`，DEV 下 `shouldRenderFullApp` 渲染完整应用），
 * 覆盖画布最核心的一条用户路径。每个 test 一个全新 context，IndexedDB 天然干净，
 * 因此每次启动都会种入种子卡（`useSeedData`：4 张卡 + 4 条线）——测试开场用
 * Ctrl+A + Delete 清空画布，之后的断言全部从零开始数。
 */

/** 画布右键菜单「新建便签」（src/i18n/zh/sidebar.ts → sidebar.new_note）。 */
const NEW_NOTE_LABEL = '新建便签';
/** 引导卡关闭按钮的 aria-label（Tooltip 会把 label 写成 aria-label；onboarding.dismiss）。 */
const ONBOARDING_DISMISS_LABEL = '暂不设置';

const NODE = '[data-node-id]';
const EDGE = 'svg g[data-edge-id]';

test.beforeEach(async ({ page }) => {
  // 应用语言取 localStorage('app_language')，否则回落 'en'（src/i18n.ts）。
  // 固定为中文，让菜单文案断言不受机器 locale 影响。
  await page.addInitScript(() => localStorage.setItem('app_language', 'zh'));
});

async function nodeIds(page: Page): Promise<string[]> {
  return page.$$eval(NODE, (els) => els.map((el) => el.getAttribute('data-node-id') ?? ''));
}

/** 右键空白处 → 新建便签 → 返回新卡的 locator。 */
async function createNoteAt(page: Page, x: number, y: number) {
  const before = await nodeIds(page);
  await page.mouse.click(x, y, { button: 'right' });
  const menu = page.locator('[data-canvas-context-menu]');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: NEW_NOTE_LABEL }).click();
  await expect(page.locator(NODE)).toHaveCount(before.length + 1);
  const after = await nodeIds(page);
  const id = after.find((candidate) => !before.includes(candidate));
  expect(id, 'newly created note id').toBeTruthy();
  return page.locator(`[data-node-id="${id}"]`);
}

/** 点击便签正文进入编辑，输入文字，点空白处失焦落库。 */
async function typeIntoNote(page: Page, note: import('@playwright/test').Locator, text: string) {
  await note.locator('.cursor-text').click();
  const editor = note.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.type(text);
  // 点画布空白处触发 blur → onBlur 写库并退出编辑态
  await page.mouse.click(320, 560);
  await expect(note).toContainText(text);
}

test('冒烟链：建两张便签、写字、拖线相连、撤销断线、Ctrl+F 搜索命中', async ({ page }) => {
  await page.goto('/');

  // ---- 画布加载：种子卡出现（全新 IndexedDB 必然触发 useSeedData） ----
  await expect(page.locator(NODE).first()).toBeVisible({ timeout: 30_000 });

  // 未配置 AI 时中央浮着引导卡，会挡住画布中部的点击——先关掉
  const dismissOnboarding = page.getByRole('button', { name: ONBOARDING_DISMISS_LABEL });
  if (await dismissOnboarding.isVisible().catch(() => false)) {
    await dismissOnboarding.click();
  }

  // ---- 清掉种子卡：Ctrl+A 全选 + Delete，后续断言从零开始数 ----
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(page.locator(NODE)).toHaveCount(0);
  await expect(page.locator(EDGE)).toHaveCount(0);

  // ---- 右键空白处建第一张便签并写入文字 ----
  const noteA = await createNoteAt(page, 420, 190);
  await typeIntoNote(page, noteA, '冒烟便签甲');

  // ---- 第二张 ----
  const noteB = await createNoteAt(page, 880, 190);
  await typeIntoNote(page, noteB, '冒烟便签乙');

  // ---- 从第一张的出口拖到第二张：出现一条边 ----
  const boxA = await noteA.boundingBox();
  const boxB = await noteB.boundingBox();
  expect(boxA && boxB, 'both notes have bounding boxes').toBeTruthy();
  // 悬停让出口（data-port="out"，右侧中点）从 group-hover 里显形
  await page.mouse.move(boxA!.x + boxA!.width / 2, boxA!.y + boxA!.height / 2);
  const outPort = noteA.locator('[data-port="out"]');
  const portBox = await outPort.boundingBox();
  expect(portBox, 'out port bounding box').toBeTruthy();
  await page.mouse.move(portBox!.x + portBox!.width / 2, portBox!.y + portBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(boxB!.x + boxB!.width / 2, boxB!.y + boxB!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator(EDGE)).toHaveCount(1);

  // ---- Ctrl+Z 撤销：边消失（连线是最后一步可撤销操作） ----
  await page.keyboard.press('Control+z');
  await expect(page.locator(EDGE)).toHaveCount(0);
  // 两张卡还在
  await expect(page.locator(NODE)).toHaveCount(2);

  // ---- Ctrl+F 搜索写入的文字：命中计数 1/1 ----
  await page.keyboard.press('Control+f');
  const searchPanel = page.locator('[data-canvas-search]');
  await expect(searchPanel).toBeVisible();
  await searchPanel.locator('input').fill('冒烟便签甲');
  // canvas.search.position → "{{index}}/{{total}}"
  await expect(searchPanel).toContainText('1/1');
});
