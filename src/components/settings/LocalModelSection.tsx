import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  X,
  Zap,
} from 'lucide-react';
import type { AIProviderProfile } from '../../types/aiConfig';
import {
  planLocalRun,
  type GgufInfo,
  type HardwareInfo,
  type LocalRunFits,
} from '../../services/localModelPlanner';
import { formatAiError, isTauriRuntime } from '../../services/ai';
import { openExternalUrl } from '../../utils/openExternal';
import { Tooltip } from '../ui/Tooltip';
import { formatBytes } from './formatBytes';

/**
 * 本地模型（local_llama）设置分区：选文件即用。
 *
 * 手打路径输入框换成文件选择器；选完立即 `gguf_inspect` 出模型卡、
 * `hardware_probe` 出硬件摘要，两者喂给 `localModelPlanner` 现算运行参数。
 * 「高级参数」面板逐项覆盖自动值，覆盖存进 `AIProviderProfile.localN*` 字段。
 * 底部「本地推理引擎」区块管 CPU/CUDA 后端与常驻 llama-server 的状态。
 */

const FIELD =
  'w-full h-9 px-3 bg-app-surface border border-app-border rounded-lg text-sm outline-none focus:border-app-accent focus:ring-1 focus:ring-app-accent transition-all';
const META_LABEL =
  'text-[10px] font-mono font-bold text-app-text-faint uppercase tracking-wider';
const SMALL_BUTTON =
  'h-8 px-2.5 rounded-lg text-[11px] font-bold border border-app-border text-app-text-muted hover:border-app-accent/40 transition-colors shrink-0 disabled:opacity-50';

/** 引擎缺失（如 mac 包异常）时指给用户的文档。 */
const LOCAL_LLM_DOC_URL = 'https://github.com/wenluwindy/Spoor/blob/main/docs/guide/LOCAL_LLM.md';

interface LocalEngineStatus {
  installed: boolean;
  backend?: 'cpu' | 'cuda' | 'metal';
  path?: string;
  nvidiaDetected: boolean;
  cudaInstalled: boolean;
}

interface LocalServerState {
  running: boolean;
  port?: number;
  modelPath?: string;
  backend?: string;
}

interface CudaProgress {
  downloaded: number;
  total: number;
  phase: 'llama' | 'cudart' | 'extract';
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** Rust `gguf_inspect` 的错误串 → 人话 i18n key。 */
function ggufErrorKey(raw: string): string {
  if (raw.includes('not_a_gguf')) return 'settings.local_gguf_err_not_gguf';
  if (raw.includes('file_not_found')) return 'settings.local_gguf_err_not_found';
  if (raw.includes('unsupported_gguf_version')) return 'settings.local_gguf_err_version';
  return 'settings.local_gguf_err_generic';
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function formatCtx(ctx: number): string {
  return ctx >= 1024 && ctx % 1024 === 0 ? `${ctx / 1024}K` : String(ctx);
}

const FITS_STYLE: Record<LocalRunFits, string> = {
  'gpu-full': 'text-[#3f7d4f] border-[#3f7d4f]/40 bg-[#3f7d4f]/5',
  'gpu-partial': 'text-[#b45309] border-[#b45309]/40 bg-[#b45309]/5',
  'cpu-only': 'text-app-text-muted border-app-border bg-app-surface',
  'wont-fit': 'text-app-accent border-app-accent/40 bg-app-accent/5',
};

export interface LocalModelSectionProps {
  provider: AIProviderProfile;
  onPatch: (patch: Partial<AIProviderProfile>) => void;
}

export function LocalModelSection({ provider, onPatch }: LocalModelSectionProps) {
  const { t } = useTranslation();
  const isTauri = isTauriRuntime();
  const path = (provider.localGgufPath ?? '').trim();

  const [gguf, setGguf] = useState<GgufInfo | null>(null);
  const [ggufError, setGgufError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [engine, setEngine] = useState<LocalEngineStatus | null>(null);
  const [server, setServer] = useState<LocalServerState | null>(null);
  const [cudaPhase, setCudaPhase] = useState<'idle' | 'downloading' | 'done' | 'error'>('idle');
  const [cudaProgress, setCudaProgress] = useState<CudaProgress | null>(null);
  const [cudaError, setCudaError] = useState<string | null>(null);
  const [cudaDismissed, setCudaDismissed] = useState(false);

  const refreshHardware = useCallback(async (refresh: boolean) => {
    setProbing(true);
    try {
      setHardware(await tauriInvoke<HardwareInfo>('hardware_probe', { refresh }));
    } catch {
      setHardware(null);
    } finally {
      setProbing(false);
    }
  }, []);

  const refreshEngine = useCallback(async () => {
    try {
      setEngine(await tauriInvoke<LocalEngineStatus>('local_engine_status'));
    } catch {
      setEngine(null);
    }
  }, []);

  const refreshServer = useCallback(async () => {
    try {
      setServer(await tauriInvoke<LocalServerState>('local_server_state'));
    } catch {
      setServer(null);
    }
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    void refreshHardware(false);
    void refreshEngine();
    void refreshServer();
  }, [isTauri, refreshHardware, refreshEngine, refreshServer]);

  // 常驻 server 的状态轻量轮询：只在本分区挂载（设置页打开）期间跑
  useEffect(() => {
    if (!isTauri) return;
    const id = window.setInterval(() => void refreshServer(), 10_000);
    return () => window.clearInterval(id);
  }, [isTauri, refreshServer]);

  // 路径一变（选新文件/清除/外部改动）立即重新解析
  useEffect(() => {
    if (!isTauri || !path) {
      setGguf(null);
      setGgufError(null);
      return;
    }
    let cancelled = false;
    setInspecting(true);
    tauriInvoke<GgufInfo>('gguf_inspect', { path })
      .then((info) => {
        if (cancelled) return;
        setGguf(info);
        setGgufError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setGguf(null);
        setGgufError(formatAiError(e));
      })
      .finally(() => {
        if (!cancelled) setInspecting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isTauri, path]);

  const overrides = useMemo(
    () => ({
      nGpuLayers: provider.localNGpuLayers,
      nCtx: provider.localNCtx,
      nThreads: provider.localNThreads,
      maxTokens: provider.localMaxTokens,
    }),
    [provider.localNGpuLayers, provider.localNCtx, provider.localNThreads, provider.localMaxTokens],
  );
  const hasOverrides = Object.values(overrides).some((v) => v !== undefined);
  const autoPlan = useMemo(
    () => (gguf && hardware ? planLocalRun(gguf, hardware, {}, { engineBackend: engine?.backend ?? null }) : null),
    [gguf, hardware, engine?.backend],
  );
  const plan = useMemo(
    () => (gguf && hardware ? planLocalRun(gguf, hardware, overrides, { engineBackend: engine?.backend ?? null }) : null),
    [gguf, hardware, overrides, engine?.backend],
  );

  const pickModel = async () => {
    const picked = await tauriInvoke<string | null>('user_file_pick_open_path', {
      filters: [{ name: 'GGUF', extensions: ['gguf'] }],
    }).catch(() => null);
    if (!picked) return;
    setCudaDismissed(false);
    onPatch({ localGgufPath: picked });
  };

  const installCuda = async () => {
    setCudaPhase('downloading');
    setCudaError(null);
    setCudaProgress(null);
    let unlisten: (() => void) | undefined;
    try {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen<CudaProgress>('llama-engine-download-progress', (event) => {
        setCudaProgress(event.payload);
      });
      await tauriInvoke('local_engine_install_cuda');
      setCudaPhase('done');
      await refreshEngine();
    } catch (e) {
      setCudaPhase('error');
      setCudaError(formatAiError(e));
    } finally {
      unlisten?.();
    }
  };

  const unloadModel = async () => {
    try {
      await tauriInvoke('local_server_stop');
    } catch {
      /* 停失败也要刷新状态给用户看真相 */
    }
    await refreshServer();
  };

  const patchOverride = (
    key: 'localNGpuLayers' | 'localNCtx' | 'localNThreads' | 'localMaxTokens',
    raw: string,
  ) => {
    if (raw.trim() === '') {
      onPatch({ [key]: undefined } as Partial<AIProviderProfile>);
      return;
    }
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return;
    onPatch({ [key]: n } as Partial<AIProviderProfile>);
  };

  const keepAliveValue =
    provider.localKeepAliveMinutes === null
      ? 'session'
      : String(provider.localKeepAliveMinutes ?? 15);

  if (!isTauri) {
    return (
      <div className="space-y-1.5">
        <span className={META_LABEL}>{t('settings.local_gguf_path')}</span>
        <p className="text-[11px] text-app-text-muted leading-relaxed">
          {t('errors.ai.local_desktop_only')}
        </p>
      </div>
    );
  }

  const cudaPct =
    cudaProgress && cudaProgress.total > 0
      ? Math.min(100, Math.round((cudaProgress.downloaded / cudaProgress.total) * 100))
      : null;
  const showCudaBanner =
    Boolean(gguf) &&
    engine?.nvidiaDetected === true &&
    engine.cudaInstalled === false &&
    !cudaDismissed &&
    cudaPhase === 'idle';

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-app-text-faint leading-relaxed">
        {t('settings.local_llama_hint')}
      </p>

      {/* ── 模型文件 ── */}
      <div className="space-y-1.5">
        <span className={META_LABEL}>{t('settings.local_gguf_path')}</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void pickModel()} className={SMALL_BUTTON}>
            <span className="flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" aria-hidden />
              {t('settings.local_pick_model')}
            </span>
          </button>
          {path ? (
            <>
              <span className="flex-1 min-w-0 truncate text-[11px] font-mono text-app-text-muted" title={path}>
                {path}
              </span>
              <Tooltip label={t('settings.local_clear_model')}>
                <button
                  type="button"
                  onClick={() => onPatch({ localGgufPath: undefined })}
                  className="p-1 text-app-text-faint hover:text-app-accent transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            </>
          ) : (
            <span className="text-[11px] text-app-text-faint">
              {t('settings.local_no_model_yet')}
            </span>
          )}
        </div>

        {inspecting && (
          <p className="flex items-center gap-1.5 text-[11px] text-app-text-faint">
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
            {t('settings.local_inspecting')}
          </p>
        )}
        {ggufError && !inspecting && (
          <p className="text-[11px] leading-relaxed text-app-accent">
            {t(ggufErrorKey(ggufError))}
            {ggufErrorKey(ggufError) === 'settings.local_gguf_err_generic' && (
              <span className="block font-mono text-[10px] break-all">{ggufError}</span>
            )}
          </p>
        )}
        {gguf && !inspecting && (
          <div className="rounded-lg border border-app-border bg-app-surface p-2.5 space-y-0.5">
            <p className="text-xs font-bold text-app-text">{gguf.modelName ?? fileName(path)}</p>
            <p className="text-[10px] font-mono text-app-text-faint">
              {[
                gguf.architecture,
                gguf.quantLabel,
                gguf.sizeLabel ?? formatBytes(gguf.fileBytes),
                gguf.blockCount != null
                  ? t('settings.local_model_layers', { n: gguf.blockCount })
                  : null,
                gguf.contextLength
                  ? t('settings.local_model_train_ctx', { ctx: formatCtx(gguf.contextLength) })
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        )}

        {/* CUDA 入口一：选完文件当场问，不阻塞，跳过就先用 CPU */}
        {showCudaBanner && (
          <div className="rounded-lg border border-[#b45309]/40 bg-[#b45309]/5 p-2.5 space-y-2">
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-app-text">
              <Zap className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#b45309]" aria-hidden />
              {t('settings.local_cuda_offer')}
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void installCuda()} className={SMALL_BUTTON}>
                {t('settings.local_cuda_install')}
              </button>
              <button
                type="button"
                onClick={() => setCudaDismissed(true)}
                className="text-[11px] text-app-text-muted hover:text-app-text hover:underline"
              >
                {t('settings.local_cuda_skip')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── 硬件摘要 ── */}
      {hardware && (
        <div className="flex items-center gap-1.5 text-[11px] text-app-text-muted">
          <Cpu className="w-3.5 h-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate">
            {[
              hardware.unifiedMemory
                ? t('settings.local_hw_unified')
                : hardware.gpus[0] && hardware.gpus[0].dedicatedVramBytes > 0
                  ? `${hardware.gpus[0].name} · ${t('settings.local_hw_vram', {
                      size: formatBytes(hardware.gpus[0].dedicatedVramBytes),
                    })}`
                  : t('settings.local_hw_no_gpu'),
              t('settings.local_hw_ram', { size: formatBytes(hardware.availableRamBytes) }),
              t('settings.local_hw_cores', { n: hardware.physicalCores }),
            ].join(' · ')}
          </span>
          <Tooltip label={t('settings.local_hw_refresh')}>
            <button
              type="button"
              disabled={probing}
              onClick={() => void refreshHardware(true)}
              className="p-1 text-app-text-faint hover:text-app-text transition-colors disabled:opacity-50 shrink-0"
            >
              {probing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
            </button>
          </Tooltip>
        </div>
      )}

      {/* ── 自动参数卡 ── */}
      {plan && (
        <div className="rounded-lg border border-app-border bg-app-surface p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <span className={META_LABEL}>{t('settings.local_plan_title')}</span>
            <span
              className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${FITS_STYLE[plan.fits]}`}
            >
              {t(`settings.local_fit_${plan.fits.replace(/-/g, '_')}`)}
            </span>
            {hasOverrides && (
              <span className="text-[10px] text-app-text-faint">
                {t('settings.local_plan_overridden')}
              </span>
            )}
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            {(
              [
                ['local_plan_gpu_layers', plan.nGpuLayers],
                ['local_plan_ctx', plan.nCtx],
                ['local_plan_threads', plan.nThreads],
                ['local_plan_max_tokens', plan.maxTokens],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="rounded bg-app-surface-subtle/60 py-1.5">
                <p className="text-sm font-bold font-mono text-app-text">{value}</p>
                <p className="text-[9px] font-mono uppercase tracking-wider text-app-text-faint">
                  {t(`settings.${key}`)}
                </p>
              </div>
            ))}
          </div>

          <p className="text-[10px] font-mono text-app-text-faint">
            {plan.estVramBytes > 0 &&
              `${t('settings.local_plan_est_vram', { size: formatBytes(plan.estVramBytes) })} · `}
            {t('settings.local_plan_est_ram', { size: formatBytes(plan.estRamBytes) })}
          </p>

          {plan.fits === 'wont-fit' && plan.advice && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-app-accent">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
              {t(`settings.local_advice_${plan.advice}`)}
            </p>
          )}

          {/* 高级参数：逐项覆盖，自动值作 placeholder */}
          <details className="group">
            <summary className="cursor-pointer list-none text-[10px] font-mono uppercase tracking-wider text-app-text-faint hover:text-app-text [&::-webkit-details-marker]:hidden">
              {t('settings.local_advanced')}
            </summary>
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['localNGpuLayers', 'local_plan_gpu_layers', autoPlan?.nGpuLayers],
                    ['localNCtx', 'local_plan_ctx', autoPlan?.nCtx],
                    ['localNThreads', 'local_plan_threads', autoPlan?.nThreads],
                    ['localMaxTokens', 'local_plan_max_tokens', autoPlan?.maxTokens],
                  ] as const
                ).map(([field, labelKey, autoValue]) => (
                  <div key={field} className="space-y-1">
                    <label className={META_LABEL} htmlFor={`${field}-${provider.id}`}>
                      {t(`settings.${labelKey}`)}
                    </label>
                    <input
                      id={`${field}-${provider.id}`}
                      type="number"
                      min={0}
                      className={FIELD}
                      placeholder={autoValue != null ? String(autoValue) : ''}
                      value={provider[field] ?? ''}
                      onChange={(e) => patchOverride(field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              {hasOverrides && (
                <button
                  type="button"
                  onClick={() =>
                    onPatch({
                      localNGpuLayers: undefined,
                      localNCtx: undefined,
                      localNThreads: undefined,
                      localMaxTokens: undefined,
                    })
                  }
                  className="text-[11px] font-bold text-app-accent hover:underline"
                >
                  {t('settings.local_reset_auto')}
                </button>
              )}
            </div>
          </details>
        </div>
      )}

      {/* ── 模型保留时长 ── */}
      <div className="grid grid-cols-2 gap-3 items-end">
        <div className="space-y-1.5">
          <label className={META_LABEL} htmlFor={`keepalive-${provider.id}`}>
            {t('settings.local_keep_alive')}
          </label>
          <select
            id={`keepalive-${provider.id}`}
            className={FIELD}
            value={keepAliveValue}
            onChange={(e) => {
              const v = e.target.value;
              onPatch({ localKeepAliveMinutes: v === 'session' ? null : Number(v) });
            }}
          >
            <option value="0">{t('settings.local_keep_alive_0')}</option>
            <option value="5">{t('settings.local_keep_alive_5')}</option>
            <option value="15">{t('settings.local_keep_alive_15')}</option>
            <option value="30">{t('settings.local_keep_alive_30')}</option>
            <option value="session">{t('settings.local_keep_alive_session')}</option>
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2 text-[11px] text-app-text-muted cursor-pointer">
          <input
            type="checkbox"
            className="rounded border-app-border"
            checked={provider.localEnableThinking ?? false}
            onChange={(e) => onPatch({ localEnableThinking: e.target.checked })}
          />
          {t('settings.local_enable_thinking')}
        </label>
      </div>

      {/* ── 本地推理引擎（CUDA 入口二 + server 状态） ── */}
      <section className="pt-2 border-t border-app-surface-subtle space-y-2">
        <div className="flex items-center gap-1.5">
          <HardDrive className="w-3.5 h-3.5 text-app-text-muted" aria-hidden />
          <span className={META_LABEL}>{t('settings.local_engine_title')}</span>
          {engine?.installed && (
            <span className="text-[10px] font-mono text-app-text-muted border border-app-border rounded px-1.5 py-0.5">
              {t(`settings.local_engine_backend_${engine.backend ?? 'cpu'}`)}
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => {
              void refreshEngine();
              void refreshServer();
            }}
            className="text-[11px] text-app-text-muted hover:text-app-text hover:underline"
          >
            {t('settings.local_engine_recheck')}
          </button>
        </div>

        {engine && !engine.installed && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-app-accent">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
            <span>
              {t('settings.local_engine_missing')}{' '}
              <a
                href={LOCAL_LLM_DOC_URL}
                role="link"
                className="text-[#1d4ed8] hover:underline cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  void openExternalUrl(LOCAL_LLM_DOC_URL);
                }}
              >
                {t('settings.local_engine_docs')}
              </a>
            </span>
          </p>
        )}
        {engine?.path && (
          <p className="text-[10px] font-mono text-app-text-faint truncate" title={engine.path}>
            {engine.path}
          </p>
        )}

        {/* CUDA 入口二：设置里随时后补 */}
        {engine?.nvidiaDetected && !engine.cudaInstalled && cudaPhase !== 'downloading' && (
          <button type="button" onClick={() => void installCuda()} className={SMALL_BUTTON}>
            <span className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" aria-hidden />
              {t('settings.local_cuda_install')}
            </span>
          </button>
        )}
        {cudaPhase === 'downloading' && (
          <div className="space-y-1.5">
            <div className="h-1.5 rounded-full bg-app-surface-sunken overflow-hidden">
              <div
                role="progressbar"
                aria-valuenow={cudaPct ?? 0}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('settings.local_cuda_downloading')}
                className="h-full bg-app-accent transition-[width] duration-200"
                style={{ width: `${cudaPct ?? 0}%` }}
              />
            </div>
            <p className="text-[10px] font-mono text-app-text-faint">
              {t('settings.local_cuda_downloading')}
              {cudaProgress && ` · ${t(`settings.local_cuda_phase_${cudaProgress.phase}`)}`}
              {cudaPct != null && ` · ${cudaPct}%`}
            </p>
          </div>
        )}
        {cudaPhase === 'done' && (
          <p className="flex items-center gap-1.5 text-[11px] text-[#3f7d4f]">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden />
            {t('settings.local_cuda_done')}
          </p>
        )}
        {cudaPhase === 'error' && (
          <p className="text-[11px] leading-relaxed text-app-accent">
            {t('settings.local_cuda_failed')}
            {cudaError && <span className="block font-mono text-[10px] break-all">{cudaError}</span>}
          </p>
        )}

        <div className="flex items-center gap-2 text-[11px] text-app-text-muted">
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${server?.running ? 'bg-[#3f7d4f]' : 'bg-app-border'}`}
            aria-hidden
          />
          <span className="flex-1 min-w-0 truncate">
            {server?.running
              ? t('settings.local_engine_server_running', { port: server.port ?? 0 })
              : t('settings.local_engine_server_idle')}
          </span>
          {server?.running && (
            <button type="button" onClick={() => void unloadModel()} className={SMALL_BUTTON}>
              {t('settings.local_engine_unload')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
