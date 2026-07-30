import { useTranslation } from 'react-i18next';
import { Download, Monitor } from 'lucide-react';
import logoUrl from '../../LOGO.png';
import { DESKTOP_RELEASE_URL } from '../constants/desktopRelease';
import { openExternalUrl } from '../utils/openExternal';

/**
 * 在浏览器里打开构建产物时显示的引导页，替代整个应用。
 *
 * 网页版已废弃：本地文件存储、AI 生图、直连模型服务都依赖桌面端能力（Rust 侧命令与自定义协议）。
 * `npm run dev` 仍放行，见 `main.tsx` 的 DEV 判断。
 */
export function DesktopOnlyNotice() {
  const { t, i18n } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#FAF9F6] p-8 font-serif text-[#1a1a1a] paper-texture">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-[#E6E4DF] bg-white p-10 text-center shadow-xl">
        <img src={logoUrl} alt="Spoor" className="h-20 w-20" />

        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2 text-[#C2410C]">
            <Monitor className="h-4 w-4" />
            <span className="font-sans text-[10px] font-bold uppercase tracking-widest">Spoor</span>
          </div>
          <h1 className="text-2xl font-bold">{t('desktop_only.title')}</h1>
          <p className="text-[13px] leading-relaxed text-[#5a5a54]">{t('desktop_only.blurb')}</p>
        </div>

        <button
          type="button"
          onClick={() => void openExternalUrl(DESKTOP_RELEASE_URL)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-4 font-sans text-sm font-bold text-white shadow-sm shadow-[#C2410C]/20 transition-colors hover:bg-[#9A3412]"
        >
          <Download className="h-4 w-4" />
          {t('desktop_only.download')}
        </button>

        <button
          type="button"
          onClick={() => {
            const next = i18n.language === 'zh' ? 'en' : 'zh';
            void i18n.changeLanguage(next);
            localStorage.setItem('app_language', next);
          }}
          className="font-sans text-[11px] text-[#8c8a84] underline decoration-dotted transition-colors hover:text-[#C2410C]"
        >
          {i18n.language === 'zh' ? 'English' : '中文'}
        </button>
      </div>
    </div>
  );
}
