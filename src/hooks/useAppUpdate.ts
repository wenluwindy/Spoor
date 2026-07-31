import { useSyncExternalStore } from 'react';
import { getUpdateState, subscribeUpdate, type UpdateState } from '../services/appUpdate';

/** 订阅检查更新的状态。侧边栏的小红点与设置页的更新卡片读的是同一份。 */
export function useAppUpdate(): UpdateState {
  return useSyncExternalStore(subscribeUpdate, getUpdateState, getUpdateState);
}
