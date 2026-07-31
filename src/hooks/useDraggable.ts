import React, { useState, useRef, useEffect } from 'react';
import { snapToGrid } from '../services/canvasGrid';
import {
  beginGroupDrag,
  endGroupDrag,
  publishGroupDelta,
  subscribeGroupDrag,
} from '../services/canvasGroupDrag';

let maxZIndex = 10;

export interface UseDraggableOptions {
  /** 节点 id；多选整体拖拽要靠它区分 leader 与 follower。 */
  id?: string;
  /**
   * 大于 0 时把拖拽坐标对齐到该栅格（画布网格开关打开时传 24）。
   * 吸附放在 pointermove 而非 pointerup：松手才跳会让卡片"自己动一下"，
   * 拖的过程中就贴齐才看得出在对齐。
   */
  snap?: number;
  /** 当前选区的全部节点 id。本节点在其中且选区 >1 时，拖它等于拖整组。 */
  groupIds?: string[];
}

export function useDraggable(
  initialX: number,
  initialY: number,
  scale: number = 1,
  onDragEnd?: (pos: { x: number; y: number }) => void,
  options: UseDraggableOptions = {},
) {
  const { id, snap = 0, groupIds } = options;
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [zIndex, setZIndex] = useState(maxZIndex);
  const scaleRef = useRef(scale);
  const snapRef = useRef(snap);
  const posRef = useRef(pos);
  const groupIdsRef = useRef(groupIds);
  const onDragEndRef = useRef(onDragEnd);
  scaleRef.current = scale;
  snapRef.current = snap;
  groupIdsRef.current = groupIds;
  onDragEndRef.current = onDragEnd;

  // Keep posRef up to date so we can send the latest pos on up
  useEffect(() => {
     posRef.current = pos;
  }, [pos]);

  /**
   * follower 侧：跟着 leader 的位移走。
   *
   * 基准坐标在 `begin` 时锁定，之后一律 `基准 + 位移`——累加每帧增量会因浮点误差
   * 让选区在长距离拖拽后逐渐散开。松手时自己落库，因此选区里每张卡的新位置都被持久化。
   */
  useEffect(() => {
    if (!id) return;
    let base: { x: number; y: number } | null = null;
    return subscribeGroupDrag((event) => {
      if (event.leaderId === id) return;
      const ids = groupIdsRef.current;
      if (!ids || !ids.includes(id)) return;

      if (event.type === 'begin') {
        base = event.ids.includes(id) ? { ...posRef.current } : null;
        return;
      }
      if (!base) return;
      if (event.type === 'delta') {
        setPos({ x: base.x + event.dx, y: base.y + event.dy });
        return;
      }
      // end
      const settled = posRef.current;
      base = null;
      onDragEndRef.current?.(settled);
    });
  }, [id]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 仅主键拖拽：右键要留给上下文菜单，中键留给画布平移。
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.isContentEditable ||
      target.tagName === 'BUTTON' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'VIDEO' ||
      target.closest('button')
    ) {
      return;
    }

    maxZIndex += 1;
    setZIndex(maxZIndex);

    const startX = e.clientX;
    const startY = e.clientY;
    const initialPos = { ...pos };

    const ids = groupIdsRef.current;
    const isGroupLeader = Boolean(id) && Boolean(ids) && ids!.length > 1 && ids!.includes(id!);
    if (isGroupLeader) beginGroupDrag(id!, ids!);

    const onPointerMove = (moveEvent: PointerEvent) => {
      const rawX = initialPos.x + (moveEvent.clientX - startX) / scaleRef.current;
      const rawY = initialPos.y + (moveEvent.clientY - startY) / scaleRef.current;
      const nextX = snapToGrid(rawX, snapRef.current);
      const nextY = snapToGrid(rawY, snapRef.current);
      setPos({ x: nextX, y: nextY });
      // 广播吸附**之后**的位移，follower 因此整组一起贴格点，相对位置不变
      if (isGroupLeader) {
        publishGroupDelta(id!, nextX - initialPos.x, nextY - initialPos.y);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      if (isGroupLeader) endGroupDrag(id!);
      if (onDragEnd) {
        // use a small timeout to let state settle
        setTimeout(() => {
          onDragEnd(posRef.current);
        }, 0);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  return { pos, onPointerDown, zIndex };
}
