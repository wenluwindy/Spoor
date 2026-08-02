/**
 * 键盘优先级栈（D12）。
 *
 * Esc 在应用里有六七个互不知情的处理者：对话框、全局搜索、演示模式、拉线中、
 * 右键菜单、画布清选区……以前靠隐式约定协调（capture 阶段抢跑、调用方手工
 * `if (connectingFrom) return` 让位），每加一个新弹层都要把这张暗账重新对一遍。
 *
 * 这里把约定摆到明面上：谁出场谁占一层，Esc 处理者只需问一句
 * 「我这层现在是不是最高的？」——不是就闭嘴，把按键留给上面的人。
 *
 * 分层从高到低固定为：
 *   modal > search > presentation > linkdrag > menu > canvas
 *
 * - 同层可重入（计数）：两个 modal 叠着开互不干扰。
 * - `canvas` 是恒在的底层，不需要显式 acquire；没人占用时它就是最高层。
 * - 纯模块级状态而非 React Context：占用方横跨 hook、Provider 与普通组件，
 *   而且判断发生在原生事件监听器里，走 Context 反而要到处穿 ref。
 */

/** 从高到低排列；`isTopKeyboardLayer` 依赖这份顺序。 */
const LAYER_PRIORITY = ['modal', 'search', 'presentation', 'linkdrag', 'menu', 'canvas'] as const;

export type KeyboardLayer = (typeof LAYER_PRIORITY)[number];

/** 各层当前占用计数。canvas 不入账——它恒在，见 `isTopKeyboardLayer`。 */
const occupancy = new Map<KeyboardLayer, number>();

/**
 * 注册占用某一层，返回释放函数（可安全重复调用，只生效一次）。
 *
 * 占用跟着触发状态走：`connectingFrom` 非空就占着 'linkdrag'，清掉就释放。
 * React 里典型写法是在 effect 里 acquire、cleanup 里调返回的释放函数。
 */
export function acquireKeyboardLayer(layer: KeyboardLayer): () => void {
  occupancy.set(layer, (occupancy.get(layer) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (occupancy.get(layer) ?? 0) - 1;
    if (next <= 0) occupancy.delete(layer);
    else occupancy.set(layer, next);
  };
}

/**
 * 该层是不是当前的最高层：比它高的层都无人占用即为真。
 *
 * 注意语义是「没有人压在我上面」，不要求该层自己已被 acquire——canvas 从不
 * acquire，一切弹层退场后它自然为真。
 */
export function isTopKeyboardLayer(layer: KeyboardLayer): boolean {
  for (const candidate of LAYER_PRIORITY) {
    if (candidate === layer) return true;
    if ((occupancy.get(candidate) ?? 0) > 0) return false;
  }
  return false;
}

/** 清空全部占用。只给测试隔离用，业务代码不要碰。 */
export function resetKeyboardLayersForTest(): void {
  occupancy.clear();
}
