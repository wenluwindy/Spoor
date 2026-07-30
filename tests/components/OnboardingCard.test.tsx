import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingCard } from '../../src/components/OnboardingCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('lucide-react', async (importOriginal) => {
  const { lucideIconMock } = await import('../lucideMock');
  return lucideIconMock(importOriginal as () => Promise<Record<string, unknown>>);
});

function renderCard() {
  const onOpenSettings = vi.fn();
  const onDismiss = vi.fn();
  const { container } = render(
    <OnboardingCard onOpenSettings={onOpenSettings} onDismiss={onDismiss} />,
  );
  return { onOpenSettings, onDismiss, container };
}

describe('OnboardingCard', () => {
  it('说明为什么需要配置并给出入口', () => {
    renderCard();
    expect(screen.getByText('onboarding.title')).toBeInTheDocument();
    expect(screen.getByText('onboarding.blurb')).toBeInTheDocument();
    expect(screen.getByText('onboarding.cta')).toBeInTheDocument();
  });

  it('点击主按钮打开设置', async () => {
    const user = userEvent.setup();
    const { onOpenSettings } = renderCard();

    await user.click(screen.getByText('onboarding.cta').closest('button')!);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('可关闭', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderCard();

    await user.click(screen.getByRole('button', { name: 'onboarding.dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('外层不吃指针事件，不挡住画布拖拽与右键', () => {
    const { container } = renderCard();
    const overlay = container.firstElementChild as HTMLElement;
    expect(overlay).toHaveClass('pointer-events-none');
    expect(overlay.firstElementChild).toHaveClass('pointer-events-auto');
  });
});
