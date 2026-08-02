/**
 * AI 配置的持久化收口（路线图 A3：API Key 迁出 localStorage）。
 *
 * 桌面端的真身在系统密钥库（`src-tauri/keystore.rs`：Windows DPAPI / macOS
 * Keychain / 其余平台明文降级），localStorage 只剩两个角色：
 *
 * 1. **浏览器调试模式**（非 Tauri）：维持原状，`ai_config` 键直读直写；
 * 2. **降级与迁移**：密钥库写失败时的兜底落点，以及旧版本存量配置的迁移来源。
 *
 * 迁移是**先复制后切换**：keystore_save 成功之后才把旧键改名为
 * `ai_config_migrated_backup`，保留一个版本周期——密钥库这台新机器万一翻车，
 * 用户的 Key 还在原地。写失败则一切原样不动，下次启动重试。
 *
 * `keystore_corrupt`（文件在但解不开）时**不覆盖坏文件**：坏文件留给人排查，
 * 本次会话的读写都退回 localStorage，并通过 degraded 订阅把警示亮到设置页。
 */
import { isTauriRuntime } from '../utils/isTauriRuntime';

/** 旧版（0.4.x 及更早）与浏览器调试模式使用的 localStorage 键。 */
export const AI_CONFIG_STORAGE_KEY = 'ai_config';
/** 迁移成功后旧值的去处，保留一个版本周期再谈删除。 */
export const AI_CONFIG_MIGRATED_BACKUP_KEY = 'ai_config_migrated_backup';

export type AiConfigDegradedReason =
  /** 密钥库文件在但解不开（换系统账户 / 文件损坏），本次会话读写退回 localStorage */
  | 'corrupt'
  /** 密钥库读写失败（IO / 权限），配置暂以明文落在 localStorage */
  | 'unavailable';

export interface AiConfigLoadResult {
  /** 原始 JSON 字符串；两边都没有时为 null（真·首启）。解析与规范化留给调用方。 */
  raw: string | null;
  degraded: AiConfigDegradedReason | null;
}

// ───────────────────────────── degraded 状态（设置页警示条订阅它） ─────────────────────────────

let degradedReason: AiConfigDegradedReason | null = null;
/** corrupt 是会话级"粘性"标记：一旦确认文件坏了，本会话的保存一律不去碰它。 */
let keystoreCorrupt = false;
const listeners = new Set<() => void>();

function setDegraded(reason: AiConfigDegradedReason | null): void {
  if (degradedReason === reason) return;
  degradedReason = reason;
  listeners.forEach((fn) => fn());
}

export function getAiConfigDegradedReason(): AiConfigDegradedReason | null {
  return degradedReason;
}

/** `useSyncExternalStore` 形状的订阅；返回退订函数。 */
export function subscribeAiConfigDegraded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 仅测试用：模块级状态在用例之间清零。 */
export function __resetAiConfigStoreForTests(): void {
  degradedReason = null;
  keystoreCorrupt = false;
  listeners.clear();
}

// ───────────────────────────── 读 ─────────────────────────────

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** 迁移候选：优先旧键；只剩备份键（密钥库文件丢了）时用备份重迁。 */
function readLegacyCandidate(): { value: string | null; fromLegacyKey: boolean } {
  const legacy = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
  if (legacy !== null) return { value: legacy, fromLegacyKey: true };
  return { value: localStorage.getItem(AI_CONFIG_MIGRATED_BACKUP_KEY), fromLegacyKey: false };
}

/**
 * 读出整份 AI 配置的原始 JSON。
 *
 * Tauri 下的状态机：
 * - keystore 有 → 直接用（localStorage 备份原样不动）；
 * - keystore 空 → 走 localStorage 迁移路径，写成功才把旧键改名为备份；
 * - keystore 坏（corrupt）→ 不覆盖坏文件，回退读 localStorage（旧键或备份），亮 degraded；
 * - keystore 读失败（IO）→ 同上回退，但不粘住 corrupt 标记，保存时仍会先试密钥库。
 */
export async function loadAiConfig(): Promise<AiConfigLoadResult> {
  if (!isTauriRuntime()) {
    return { raw: localStorage.getItem(AI_CONFIG_STORAGE_KEY), degraded: null };
  }

  let stored: string | null;
  try {
    stored = await invokeTauri<string | null>('keystore_load');
  } catch (error) {
    const reason: AiConfigDegradedReason = String(error).includes('keystore_corrupt')
      ? 'corrupt'
      : 'unavailable';
    if (reason === 'corrupt') keystoreCorrupt = true;
    setDegraded(reason);
    return { raw: readLegacyCandidate().value, degraded: reason };
  }

  if (stored !== null && stored !== undefined) {
    setDegraded(null);
    return { raw: stored, degraded: null };
  }

  // 密钥库是空的：首启，或从旧版本升级上来。localStorage 里有存量就迁进去。
  const { value: candidate, fromLegacyKey } = readLegacyCandidate();
  if (candidate === null) return { raw: null, degraded: null };

  try {
    await invokeTauri('keystore_save', { payload: candidate });
    // 先复制后切换：keystore 落稳之后才动旧键
    if (fromLegacyKey) {
      localStorage.setItem(AI_CONFIG_MIGRATED_BACKUP_KEY, candidate);
      localStorage.removeItem(AI_CONFIG_STORAGE_KEY);
    }
    setDegraded(null);
    return { raw: candidate, degraded: null };
  } catch {
    // 迁移失败不是数据损失：旧键原样保留，下次启动重试；本次先降级用着
    setDegraded('unavailable');
    return { raw: candidate, degraded: 'unavailable' };
  }
}

// ───────────────────────────── 写 ─────────────────────────────

/**
 * 保存整份 AI 配置。所有写路径都收口到这里。
 *
 * Tauri 下写密钥库；失败（或本会话已确认 corrupt）时降级写 localStorage 并返回
 * `degraded: true`——配置永远不会因为密钥库故障而丢，只是暂时回到明文。
 * 密钥库写成功后，localStorage 里若还躺着一份降级明文，会顺手挪进备份键。
 */
export async function saveAiConfig(config: unknown): Promise<{ degraded: boolean }> {
  const payload = JSON.stringify(config);

  if (!isTauriRuntime()) {
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, payload);
    return { degraded: false };
  }

  if (keystoreCorrupt) {
    // 坏文件不碰：留给人（或下个版本的修复逻辑）诊断，新配置先在 localStorage 活着
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, payload);
    setDegraded('corrupt');
    return { degraded: true };
  }

  try {
    await invokeTauri('keystore_save', { payload });
    const stale = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (stale !== null) {
      // 之前降级留下的明文：密钥库既然又能写了，明文不该继续躺在主键上
      localStorage.setItem(AI_CONFIG_MIGRATED_BACKUP_KEY, stale);
      localStorage.removeItem(AI_CONFIG_STORAGE_KEY);
    }
    setDegraded(null);
    return { degraded: false };
  } catch {
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, payload);
    setDegraded('unavailable');
    return { degraded: true };
  }
}
