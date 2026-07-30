import React from 'react';
import type { NodeContentProps } from './types';
import { NoteLayoutReceipt } from './note/layouts/NoteLayoutReceipt';
import { NoteLayoutStandard, type NoteChromeLayout } from './note/layouts/NoteLayoutStandard';

export function NoteNode({ node, editingNodeId, setEditingNodeId }: NodeContentProps) {
  const layout = node.layout ?? 0;

  if (layout === 4) {
    return <NoteLayoutReceipt node={node} editingNodeId={editingNodeId} setEditingNodeId={setEditingNodeId} />;
  }

  return (
    <NoteLayoutStandard
      node={node}
      editingNodeId={editingNodeId}
      setEditingNodeId={setEditingNodeId}
      layout={layout as NoteChromeLayout}
    />
  );
}
