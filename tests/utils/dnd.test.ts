import { describe, it, expect } from 'vitest';
import { dataTransferHasFiles, preventDefaultIfFileDrag } from '../../src/utils/dnd';

describe('dnd utils', () => {
  it('dataTransferHasFiles is false when empty', () => {
    expect(dataTransferHasFiles(null)).toBe(false);
    expect(dataTransferHasFiles(undefined)).toBe(false);
    const dt = { types: [] } as unknown as DataTransfer;
    expect(dataTransferHasFiles(dt)).toBe(false);
  });

  it('dataTransferHasFiles detects Files type', () => {
    const dt = {
      types: ['Files'],
      dropEffect: 'none',
    } as unknown as DataTransfer;
    expect(dataTransferHasFiles(dt)).toBe(true);
  });

  it('preventDefaultIfFileDrag calls preventDefault for file drags only', () => {
    let prevented = 0;
    const noFiles = {
      preventDefault: () => {
        prevented++;
      },
      dataTransfer: { types: ['text/plain'] } as unknown as DataTransfer,
    };
    preventDefaultIfFileDrag(noFiles);
    expect(prevented).toBe(0);

    const files = {
      preventDefault: () => {
        prevented++;
      },
      dataTransfer: {
        types: ['Files'],
        dropEffect: 'none',
      } as unknown as DataTransfer,
    };
    preventDefaultIfFileDrag(files);
    expect(prevented).toBe(1);
    expect(files.dataTransfer.dropEffect).toBe('copy');
  });
});
