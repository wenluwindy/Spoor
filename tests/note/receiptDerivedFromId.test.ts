import { describe, it, expect } from 'vitest';
import { receiptDerivedFromId } from '../../src/components/nodes/note/receiptDerivedFromId';

describe('receiptDerivedFromId', () => {
  it('同一 id 结果稳定', () => {
    const a = receiptDerivedFromId('node-abc');
    const b = receiptDerivedFromId('node-abc');
    expect(a).toEqual(b);
  });

  it('不同 id 一般会有不同 txn', () => {
    const x = receiptDerivedFromId('a');
    const y = receiptDerivedFromId('b');
    expect(x.txn === y.txn && x.store === y.store && x.barcodeTail === y.barcodeTail).toBe(false);
  });

  it('取值在预期范围内', () => {
    const r = receiptDerivedFromId('any-id');
    expect(r.store).toBeGreaterThanOrEqual(10);
    expect(r.store).toBeLessThanOrEqual(99);
    expect(r.txn).toBeGreaterThanOrEqual(100000);
    expect(r.txn).toBeLessThanOrEqual(999999);
    expect(r.barcodeTail).toMatch(/^\d{6}$/);
  });
});
