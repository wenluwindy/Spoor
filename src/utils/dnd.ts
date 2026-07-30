/** HTML5 拖放：是否为「系统文件」类拖动（resource Files）。 */
export function dataTransferHasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt?.types?.length) return false;
  return Array.from(dt.types).includes('Files');
}

/** 允许在浏览器中放置文件（须在 dragenter/dragover 上调用）。 */
export function preventDefaultIfFileDrag(e: { preventDefault: () => void; dataTransfer: DataTransfer | null }): void {
  const dt = e.dataTransfer;
  if (!dataTransferHasFiles(dt)) return;
  e.preventDefault();
  if (dt) dt.dropEffect = 'copy';
}
