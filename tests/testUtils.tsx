import React from 'react';
import { AppDialogProvider } from '../src/components/AppDialogProvider';

export function withAppDialogProvider(children: React.ReactNode) {
  return <AppDialogProvider>{children}</AppDialogProvider>;
}
