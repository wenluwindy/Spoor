import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { acquireKeyboardLayer, isTopKeyboardLayer } from '../services/keyboardLayers';

export interface AppConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作（删除等）时主按钮用强调色 */
  variant?: 'default' | 'danger';
}

export interface AppAlertOptions {
  title?: string;
  message: string;
  okLabel?: string;
}

export interface AppPromptOptions {
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface AppDialogContextValue {
  confirm: (options: AppConfirmOptions) => Promise<boolean>;
  alert: (options: AppAlertOptions) => Promise<void>;
  /** 文本输入对话框：确认返回输入串（可为空串），取消/Esc 返回 null。 */
  prompt: (options: AppPromptOptions) => Promise<string | null>;
}

const AppDialogContext = createContext<AppDialogContextValue | null>(null);

type DialogState =
  | { kind: 'confirm'; options: AppConfirmOptions }
  | { kind: 'alert'; options: AppAlertOptions }
  | { kind: 'prompt'; options: AppPromptOptions }
  | null;

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [promptValue, setPromptValue] = useState('');
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const promptResolveRef = useRef<((value: string | null) => void) | null>(null);

  const close = useCallback((result: boolean) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setDialog(null);
  }, []);

  const closePrompt = useCallback(
    (value: string | null) => {
      promptResolveRef.current?.(value);
      promptResolveRef.current = null;
      setDialog(null);
    },
    [],
  );

  const confirm = useCallback(
    (options: AppConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setDialog({ kind: 'confirm', options });
      }),
    [],
  );

  const alert = useCallback(
    (options: AppAlertOptions) =>
      new Promise<void>((resolve) => {
        resolveRef.current = (ok) => {
          if (ok) resolve();
        };
        setDialog({ kind: 'alert', options });
      }),
    [],
  );

  const prompt = useCallback(
    (options: AppPromptOptions) =>
      new Promise<string | null>((resolve) => {
        promptResolveRef.current = resolve;
        setPromptValue(options.defaultValue ?? '');
        setDialog({ kind: 'prompt', options });
      }),
    [],
  );

  // 对话框在场即占 'modal' 层：这是键盘栈的最高层，压住其下所有 Esc 处理者
  useEffect(() => {
    if (!dialog) return;
    return acquireKeyboardLayer('modal');
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!isTopKeyboardLayer('modal')) return;
      if (dialog.kind === 'confirm') close(false);
      else if (dialog.kind === 'prompt') closePrompt(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, close, closePrompt]);

  const title =
    dialog?.kind === 'confirm'
      ? dialog.options.title ?? t('dialog.confirm_title')
      : dialog?.kind === 'alert'
        ? dialog.options.title ?? t('dialog.alert_title')
        : dialog?.kind === 'prompt'
          ? dialog.options.title ?? t('dialog.prompt_title')
          : '';

  const message = dialog?.options.message ?? '';
  const isDanger = dialog?.kind === 'confirm' && dialog.options.variant === 'danger';

  return (
    <AppDialogContext.Provider value={{ confirm, alert, prompt }}>
      {children}
      {dialog ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/20 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (dialog.kind === 'confirm') close(false);
            else if (dialog.kind === 'prompt') closePrompt(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-dialog-title"
            aria-describedby="app-dialog-message"
            className="w-full max-w-md bg-app-surface-raised rounded-2xl shadow-2xl border border-app-border overflow-hidden animate-in zoom-in-95 duration-200"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-6 pt-6 pb-4 border-b border-app-surface-subtle bg-app-surface">
              <h2
                id="app-dialog-title"
                className="font-serif text-lg font-bold text-app-text leading-snug"
              >
                {title}
              </h2>
            </div>
            {message ? (
              <p
                id="app-dialog-message"
                className="px-6 py-5 text-sm font-sans text-app-text-soft leading-relaxed whitespace-pre-wrap"
              >
                {message}
              </p>
            ) : (
              <div className="pt-3" />
            )}
            {dialog.kind === 'prompt' && (
              <div className="px-6 pb-4">
                <input
                  autoFocus
                  type="text"
                  value={promptValue}
                  placeholder={dialog.options.placeholder}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      closePrompt(promptValue);
                    }
                  }}
                  className="w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm font-sans text-app-text focus:outline-none focus:ring-1 focus:ring-app-accent/40"
                />
              </div>
            )}
            <div className="px-6 pb-6 flex flex-row-reverse flex-wrap gap-2 justify-start">
              {dialog.kind === 'prompt' ? (
                <>
                  <button
                    type="button"
                    onClick={() => closePrompt(promptValue)}
                    className="px-4 py-2 rounded-xl text-sm font-sans font-bold bg-app-inverse text-app-on-inverse hover:bg-app-inverse-hover shadow-sm transition-colors"
                  >
                    {dialog.options.confirmLabel ?? t('dialog.confirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => closePrompt(null)}
                    className="px-4 py-2 rounded-xl text-sm font-sans font-medium border border-app-border text-app-text-muted bg-app-surface-raised hover:bg-app-surface-subtle transition-colors"
                  >
                    {dialog.options.cancelLabel ?? t('dialog.cancel')}
                  </button>
                </>
              ) : dialog.kind === 'confirm' ? (
                <>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => close(true)}
                    className={`px-4 py-2 rounded-xl text-sm font-sans font-bold shadow-sm transition-colors ${
                      isDanger
                        ? 'bg-app-accent text-white hover:bg-app-accent-hover'
                        : 'bg-app-inverse text-app-on-inverse hover:bg-app-inverse-hover'
                    }`}
                  >
                    {dialog.options.confirmLabel ?? t('dialog.confirm')}
                  </button>
                  <button
                    type="button"
                    onClick={() => close(false)}
                    className="px-4 py-2 rounded-xl text-sm font-sans font-medium border border-app-border text-app-text-muted bg-app-surface-raised hover:bg-app-surface-subtle transition-colors"
                  >
                    {dialog.options.cancelLabel ?? t('dialog.cancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  autoFocus
                  onClick={() => close(true)}
                  className="px-4 py-2 rounded-xl text-sm font-sans font-bold bg-app-inverse text-app-on-inverse hover:bg-app-inverse-hover shadow-sm transition-colors"
                >
                  {dialog.options.okLabel ?? t('dialog.ok')}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogContextValue {
  const ctx = useContext(AppDialogContext);
  if (!ctx) {
    throw new Error('useAppDialog must be used within AppDialogProvider');
  }
  return ctx;
}
