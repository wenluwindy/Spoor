/**
 * English 文案 —— 按命名空间组装的入口。
 *
 * 历史教训：文案最初挤在 700 余行的 src/i18n.ts 里；第一次拆分按「语言」维度
 * 拆成 zh.ts / en.ts，结果单文件很快又长回 700+ 行。这次按「模块」拆——每个
 * 顶层命名空间一个文件（./dialog、./settings、…），本文件只负责组装成与旧
 * en.ts 完全相同的形状，既有 import 路径 `./en` 保持不变。
 *
 * 新增文案请写进对应命名空间文件；新增命名空间时在这里挂上（en/zh 两边都要）。
 */
import { dialog } from './dialog';
import { app } from './app';
import { desktop_only } from './desktop_only';
import { onboarding } from './onboarding';
import { sidebar } from './sidebar';
import { canvas } from './canvas';
import { imagegen } from './imagegen';
import { nodes } from './nodes';
import { settings } from './settings';
import { ai } from './ai';
import { lab } from './lab';
import { reference } from './reference';
import { agents } from './agents';
import { seed } from './seed';
import { errors } from './errors';

export const en = {
  dialog,
  app,
  desktop_only,
  onboarding,
  sidebar,
  canvas,
  imagegen,
  nodes,
  settings,
  ai,
  lab,
  reference,
  agents,
  seed,
  errors,
};
