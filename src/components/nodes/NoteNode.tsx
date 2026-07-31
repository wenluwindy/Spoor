import React from 'react';
import type { NodeContentProps } from './types';
import { useAppTheme } from '../../hooks/useAppTheme';
import { NoteLayoutStandard } from './note/layouts/NoteLayoutStandard';

/**
 * 便签外壳由**全局主题**决定，不再读 `node.layout`。
 *
 * 单节点的「切换布局」已移除（见 `appThemes`）；`node.layout` 字段仍留在库里
 * 但不读不写，以便需要时回退。
 */
export function NoteNode({ node, editingNodeId, setEditingNodeId }: NodeContentProps) {
  const { noteLayout } = useAppTheme();

  return (
    <NoteLayoutStandard
      node={node}
      editingNodeId={editingNodeId}
      setEditingNodeId={setEditingNodeId}
      layout={noteLayout}
    />
  );
}
