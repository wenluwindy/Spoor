/**
 * 全局主题表。
 *
 * 一套主题 = 一套全局色板（住在 `index.css` 的 `html[data-theme=...]` 里）
 * + 一个便签外壳形态 + 一个主题卡形态。这里只放**结构**，颜色一律不进 TS——
 * 换肤靠 CSS 变量穿透，组件不需要知道当前是什么颜色。
 *
 * `swatch` 是例外：设置页要画色卡预览，那两个值必须与 `index.css` 里对应
 * 主题的 `--color-app-surface` / `--color-app-accent` 保持一致。
 */

export const APP_THEME_IDS = ['paper', 'midnight', 'minimal', 'neo'] as const;

export type AppThemeId = (typeof APP_THEME_IDS)[number];

/** 便签与主题卡的外壳编号；小票外壳已移除，两者都是 0–3。 */
export type ShellLayout = 0 | 1 | 2 | 3;

export interface AppThemeDefinition {
  id: AppThemeId;
  labelKey: string;
  /** `note` / `text` 节点的外壳（见 `NoteLayoutStandard`）。 */
  noteLayout: ShellLayout;
  /** `theme` 节点的外壳（见 `ThemeNode`）。 */
  themeLayout: ShellLayout;
  /** 设置页色卡：底色 + 强调色，须与 index.css 同主题的令牌一致。 */
  swatch: { surface: string; accent: string };
}

export const APP_THEMES: AppThemeDefinition[] = [
  {
    id: 'paper',
    labelKey: 'settings.theme_paper',
    noteLayout: 0,
    themeLayout: 0,
    swatch: { surface: '#FAF9F6', accent: '#C2410C' },
  },
  {
    id: 'midnight',
    labelKey: 'settings.theme_midnight',
    noteLayout: 1,
    // 主题卡走「左侧强调边 + 抬升面」；形态 2 是反相实心块，深色主题下会翻成浅色，
    // 白卡压在深画布上极刺眼，那个形态留给 minimal。
    themeLayout: 1,
    swatch: { surface: '#17161A', accent: '#E2703A' },
  },
  {
    id: 'minimal',
    labelKey: 'settings.theme_minimal',
    noteLayout: 2,
    // 形态 2 是反相实心块：白底画布上的一张黑卡，正是极简要的对比。
    themeLayout: 2,
    swatch: { surface: '#FFFFFF', accent: '#3F3F46' },
  },
  {
    id: 'neo',
    labelKey: 'settings.theme_neo',
    noteLayout: 3,
    themeLayout: 3,
    swatch: { surface: '#FFFDF5', accent: '#E8590C' },
  },
];

export const DEFAULT_APP_THEME_ID: AppThemeId = 'paper';

const THEME_BY_ID = new Map(APP_THEMES.map((theme) => [theme.id, theme]));

export function isAppThemeId(value: unknown): value is AppThemeId {
  return typeof value === 'string' && THEME_BY_ID.has(value as AppThemeId);
}

/** 未知/损坏的值一律回落到默认主题，不抛错——存储里的脏数据不该让画布白屏。 */
export function resolveAppTheme(id: unknown): AppThemeDefinition {
  return THEME_BY_ID.get(id as AppThemeId) ?? THEME_BY_ID.get(DEFAULT_APP_THEME_ID)!;
}
