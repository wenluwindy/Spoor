import React from 'react';
import type { NodeContentProps } from './types';

export function VideoNode({ node }: NodeContentProps) {
  return (
    <div 
      className="w-full h-full bg-white p-2 shadow-lg border-2 border-[#E6E4DF] flex flex-col"
      style={{ outline: '1px solid transparent' }}
    >
      <div className="w-full bg-[#1a1a1a] rounded flex items-center justify-center border border-dashed border-[#d1cfca] overflow-hidden flex-1">
        <video className="w-full h-full object-cover pointer-events-auto" controls src={node.content}/>
      </div>
    </div>
  );
}
