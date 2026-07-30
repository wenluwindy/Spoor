import { useEffect, useRef, useState } from 'react';
import { isTauriRuntime } from '../utils/isTauriRuntime';

/**
 * Tauri 原生文件拖放。
 *
 * 取代原来的 HTML5 `dragover`/`drop`：`dragDropEnabled: true` 之后 webview 不再
 * 派发这些事件，改由 Tauri 给出**绝对路径**。收益是拖一个 500MB 的视频进来时
 * 文件字节完全不进 JS，Rust 直接 `fs::copy`。
 *
 * 代价是拿不到 `DataTransfer`，也就没法在放下之前知道拖的是什么类型——
 * 类型判断挪到落库时（`services/fileImport.classifyFile`）。
 */

export interface DropPoint {
  x: number;
  y: number;
}

/**
 * Tauri 给的是**物理像素**、相对窗口左上角；DOM 用的是 CSS 像素。
 * 缩放显示器（125%/150%）上不换算会偏出一大截。
 */
export function physicalToClientPoint(
  position: { x: number; y: number },
  devicePixelRatio: number,
): DropPoint {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return { x: position.x / ratio, y: position.y / ratio };
}

interface UseNativeFileDropParams {
  /** 只在画布页监听；切到长文/研究页时不该接收拖放。 */
  enabled: boolean;
  onDrop: (paths: string[], point: DropPoint) => void;
}

export function useNativeFileDrop({ enabled, onDrop }: UseNativeFileDropParams) {
  const [isDragOver, setIsDragOver] = useState(false);

  /**
   * 回调放 ref、不进依赖数组。
   *
   * `onDrop` 通常闭包了画布变换、落库函数，每次渲染都是新身份；若进依赖，
   * 每次渲染都要退订再订阅一次，而 cleanup 里的 `setIsDragOver(false)` 会把
   * 刚亮起来的拖放高亮立刻抹掉——拖着文件在画布上移动时提示根本不会出现。
   */
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  useEffect(() => {
    if (!enabled || !isTauriRuntime()) {
      setIsDragOver(false);
      return;
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { getCurrentWebview } = await import('@tauri-apps/api/webview');
      const stop = await getCurrentWebview().onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type === 'over') {
          setIsDragOver(true);
          return;
        }
        if (payload.type === 'leave') {
          setIsDragOver(false);
          return;
        }
        if (payload.type === 'drop') {
          setIsDragOver(false);
          if (payload.paths.length === 0) return;
          onDropRef.current(
            payload.paths,
            physicalToClientPoint(payload.position, window.devicePixelRatio),
          );
        }
      });
      // 订阅是异步的：期间组件可能已经卸载，那就立刻退订
      if (cancelled) stop();
      else unlisten = stop;
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      setIsDragOver(false);
    };
  }, [enabled]);

  return { isDragOver };
}
