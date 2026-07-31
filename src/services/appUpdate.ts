import { isTauriRuntime } from '../utils/isTauriRuntime';

/**
 * 检查更新的外部 store。
 *
 * 用 store 而不是 props：侧边栏的小红点与设置页的更新卡片读的是同一份状态，
 * 靠 props 得从 `App` 一路穿过 `AISettingsModal` 再到 `GeneralSettingsTab`。
 * 写法沿用 [`services/appTheme`] 的 `listeners: Set` + `useSyncExternalStore`。
 *
 * 请求、下载、拉起安装程序全在 Rust（`src-tauri/src/updater.rs`），
 * 这里只发指令、收进度、存状态。
 */

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up_to_date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error';

export interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  notes: string;
  assetName: string;
  assetSize: number;
  downloadUrl: string;
  releaseUrl: string;
}

export interface UpdateState {
  phase: UpdatePhase;
  info: UpdateInfo | null;
  /** 0–100，仅 `downloading` 阶段有意义。 */
  progress: number;
  /** 下载完成后的安装包绝对路径。 */
  installerPath: string | null;
  /** Rust 抛上来的原始错误，折叠展示。 */
  error: string | null;
}

const INITIAL: UpdateState = {
  phase: 'idle',
  info: null,
  progress: 0,
  installerPath: null,
  error: null,
};

let current: UpdateState = INITIAL;
const listeners = new Set<() => void>();

function setState(patch: Partial<UpdateState>): void {
  current = { ...current, ...patch };
  listeners.forEach((fn) => fn());
}

export function getUpdateState(): UpdateState {
  return current;
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 测试用：把 store 恢复到初始状态。 */
export function resetUpdateState(): void {
  current = INITIAL;
  listeners.forEach((fn) => fn());
}

// ───────────────────────────── 调用 ─────────────────────────────

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

async function getInvoke(): Promise<InvokeFn> {
  const mod = await import('@tauri-apps/api/core');
  return mod.invoke as InvokeFn;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 查一次最新发布。
 *
 * `silent` 用于启动自检：查不到就安静躺回 idle，不要在用户没主动问的时候
 * 弹一个网络错误出来。手动点击时则要如实报错。
 */
export async function checkForUpdate({ silent = false } = {}): Promise<UpdateState> {
  if (!isTauriRuntime()) {
    setState({ phase: 'up_to_date', info: null, error: null });
    return current;
  }
  // 已经在下载或下完了就别用一次检查把进度冲掉
  if (current.phase === 'checking' || current.phase === 'downloading') return current;

  setState({ phase: 'checking', error: null });
  try {
    const invoke = await getInvoke();
    const info = await invoke<UpdateInfo>('check_for_update');
    setState({ phase: info.available ? 'available' : 'up_to_date', info, error: null });
  } catch (e) {
    console.error('[Spoor] check_for_update failed', e);
    setState(silent ? { phase: 'idle' } : { phase: 'error', error: describe(e) });
  }
  return current;
}

/**
 * 启动自检每会话只跑一次；用户手动点检查不受此限制。
 *
 * `App` 每次挂载都会调它，但守卫在模块级——测试里反复 render 不会真的去打网络，
 * 何况非 Tauri 环境这里本来就直接返回。
 */
let autoChecked = false;

export function autoCheckForUpdateOnce(): void {
  if (autoChecked || !isTauriRuntime()) return;
  autoChecked = true;
  void checkForUpdate({ silent: true });
}

let unlistenProgress: (() => void) | null = null;

/** 下载安装包。进度由 Rust 通过 `update-download-progress` 事件推上来。 */
export async function downloadUpdate(): Promise<UpdateState> {
  const info = current.info;
  if (!isTauriRuntime() || !info?.available) return current;
  if (current.phase === 'downloading') return current;

  setState({ phase: 'downloading', progress: 0, error: null });
  try {
    const [invoke, { listen }] = await Promise.all([
      getInvoke(),
      import('@tauri-apps/api/event'),
    ]);

    unlistenProgress?.();
    unlistenProgress = await listen<{ received: number; total: number }>(
      'update-download-progress',
      ({ payload }) => {
        const total = payload.total || info.assetSize;
        if (!total) return;
        setState({ progress: Math.min(100, Math.round((payload.received / total) * 100)) });
      },
    );

    const installerPath = await invoke<string>('download_update', {
      url: info.downloadUrl,
      assetName: info.assetName,
      expectedSize: info.assetSize,
    });
    setState({ phase: 'ready', progress: 100, installerPath, error: null });
  } catch (e) {
    console.error('[Spoor] download_update failed', e);
    setState({ phase: 'error', error: describe(e) });
  } finally {
    unlistenProgress?.();
    unlistenProgress = null;
  }
  return current;
}

/**
 * 拉起安装程序。
 *
 * Rust 侧起完进程会立刻退出本应用——NSIS 要覆盖的正是当前跑着的 exe，
 * 不退出就会被文件占用挡住。所以这个调用**正常情况下不会返回**。
 */
export async function installUpdate(): Promise<void> {
  const path = current.installerPath;
  if (!isTauriRuntime() || !path) return;
  try {
    const invoke = await getInvoke();
    await invoke('install_update', { path });
  } catch (e) {
    console.error('[Spoor] install_update failed', e);
    setState({ phase: 'error', error: describe(e) });
  }
}
