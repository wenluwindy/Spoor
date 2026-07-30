import * as RTL from '@testing-library/react-impl';
import React from 'react';
import { AppDialogProvider } from '../src/components/AppDialogProvider';

export * from '@testing-library/react-impl';

function AppDialogWrapper({ children }: { children: React.ReactNode }) {
  return <AppDialogProvider>{children}</AppDialogProvider>;
}

function mergeWrapper(
  Outer: React.ComponentType<{ children: React.ReactNode }>,
  Inner?: RTL.RenderOptions['wrapper'],
) {
  if (!Inner) return Outer;
  return function MergedWrapper({ children }: { children: React.ReactNode }) {
    return (
      <Outer>
        <Inner>{children}</Inner>
      </Outer>
    );
  };
}

export function render(
  ui: React.ReactElement,
  options?: RTL.RenderOptions,
) {
  const { wrapper: inner, ...rest } = options ?? {};
  return RTL.render(ui, {
    ...rest,
    wrapper: mergeWrapper(AppDialogWrapper, inner),
  });
}

export function renderHook<TResult, TProps>(
  hook: (props: TProps) => TResult,
  options?: RTL.RenderHookOptions<TProps>,
) {
  const { wrapper: inner, ...rest } = options ?? {};
  return RTL.renderHook(hook, {
    ...rest,
    wrapper: mergeWrapper(AppDialogWrapper, inner),
  });
}
