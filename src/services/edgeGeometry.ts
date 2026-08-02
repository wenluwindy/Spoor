/**
 * 连线几何的脏标记。
 *
 * 连线的端点是读两端卡片 DOM 算出来的（见 useCanvasInteraction 的 rAF 循环）。
 * 0.3.x 那个循环**每帧**对每条边做两次 getBoundingClientRect（强制同步布局），
 * 画布静止时也在烧 CPU。现在循环只在"最近有事发生"时才真正干活：
 * 凡是可能挪动卡片或改变其尺寸的事件——平移缩放、拖拽拉伸、数据增删、
 * AI 流式长高、图片加载完成——都调一下 `markEdgesDirty()`。
 *
 * 用"冷却窗口"而不是一次性标记：布局动画（motion 过渡、卡片长高）会持续几百毫秒，
 * 单次标记只能刷新第一帧。
 */

const DEFAULT_COOLDOWN_MS = 500;

/** 模块加载时先热一秒：首屏挂载与入场动画都发生在这段时间里。 */
let dirtyUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + 1000;

export function markEdgesDirty(cooldownMs: number = DEFAULT_COOLDOWN_MS): void {
  const until = performance.now() + cooldownMs;
  if (until > dirtyUntil) dirtyUntil = until;
}

/** rAF 循环每帧问一句：这帧要不要重算连线。 */
export function edgesNeedUpdate(now: number = performance.now()): boolean {
  return now <= dirtyUntil;
}
