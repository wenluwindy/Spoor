import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright 冒烟线（roadmap D13）。
 *
 * 只跑 `e2e/` 下的 spec；单测通道（`npm test` → vitest）不受影响。
 * webServer 直接起 `npm run dev`：`shouldRenderFullApp` 只在 DEV 下于浏览器里
 * 渲染完整应用，构建产物在浏览器里只会看到 DesktopOnlyNotice。
 * IndexedDB 的隔离靠 Playwright 的默认行为——每个 test 一个全新 browser context。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // 冒烟链是一条有状态的操作序列，串行跑，失败重试一次抵御偶发抖动
  fullyParallel: false,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // vite 配置里 host=0.0.0.0、端口 3000（见 package.json 的 dev 脚本）
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
