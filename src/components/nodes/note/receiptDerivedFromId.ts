export function receiptDerivedFromId(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  }
  const u = Math.abs(h);
  const store = (u % 90) + 10;
  const txn = (u % 900000) + 100000;
  const barcodeTail = (u % 1000000).toString().padStart(6, '0');
  return { store, txn, barcodeTail };
}
