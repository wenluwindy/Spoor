import { useTranslation } from 'react-i18next';
import { ArrowRight, Settings, X } from 'lucide-react';
import { Tooltip } from './ui/Tooltip';

export interface OnboardingCardProps {
  onOpenSettings: () => void;
  onDismiss: () => void;
}

/**
 * 未配置任何模型服务时浮在画布上的引导卡。
 *
 * 内置 API Key 移除后，「装完就能用」这条路没有了；不给引导的话新用户第一次点 AI
 * 只会撞到一个报错弹窗。样式沿用主题卡的纸质外观。
 */
export function OnboardingCard({ onOpenSettings, onDismiss }: OnboardingCardProps) {
  const { t } = useTranslation();

  return (
    // 外层不吃指针事件，避免挡住底下的画布拖拽与右键
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-8">
      <div className="pointer-events-auto relative w-full max-w-sm rounded-2xl border border-[#E6E4DF] bg-white/95 p-6 shadow-xl backdrop-blur-sm">
        <Tooltip label={t('onboarding.dismiss')}>
          <button
            type="button"
            onClick={onDismiss}
            className="absolute right-3 top-3 rounded-full p-1.5 text-[#8c8a84] transition-colors hover:bg-[#F4F1ED] hover:text-[#1a1a1a]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </Tooltip>

        <div className="mb-3 flex items-center gap-2 text-[#C2410C]">
          <Settings className="h-4 w-4" />
          <span className="font-sans text-[10px] font-bold tracking-wider text-[#8c8a84]">
            {t('onboarding.eyebrow')}
          </span>
        </div>

        <h2 className="mb-2 font-serif text-lg font-bold text-[#1a1a1a]">
          {t('onboarding.title')}
        </h2>
        <p className="mb-5 text-[13px] leading-relaxed text-[#5a5a54]">{t('onboarding.blurb')}</p>

        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#C2410C] px-4 font-sans text-sm font-bold text-white shadow-sm shadow-[#C2410C]/20 transition-colors hover:bg-[#9A3412]"
        >
          {t('onboarding.cta')}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
