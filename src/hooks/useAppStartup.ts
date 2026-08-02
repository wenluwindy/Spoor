import { useEffect } from 'react';
import type { TFunction } from 'i18next';
import type { AppAlertOptions } from '../components/AppDialogProvider';
import { autoCheckForUpdateOnce } from '../services/appUpdate';
import { runDailySnapshot } from '../services/autoBackup';
import { migrateBase64MediaNodes } from '../services/migrateBase64Media';
import { getAppVersion } from '../utils/appVersion';
import { isTauriRuntime } from '../utils/isTauriRuntime';
import { logger } from '../utils/logger';

/**
 * 应用启动时跑一次的后台杂务，从 App 整体搬出（0.5.0 拆薄）。
 *
 * 四件事共同点：都是「启动后悄悄做，失败不拦路」的一次性流程，
 * 与画布渲染毫无耦合——App 里只需要挂一次这个 hook。
 */
export function useAppStartup({
  t,
  appAlert,
}: {
  t: TFunction;
  appAlert: (options: AppAlertOptions) => Promise<void>;
}): void {
  // 启动静默自检：有新版就在侧边栏设置按钮上挂个点，查不到就安静躺下，不打断
  useEffect(() => {
    autoCheckForUpdateOnce();
  }, []);

  // 每天第一次启动留一份自动快照。失败只记日志——备份是后台的好意，不该拦在启动路径上
  useEffect(() => {
    void getAppVersion().then((version) => runDailySnapshot(version, Date.now()));
  }, []);

  /**
   * 笔记落文件（0.5.0）：启动对账 + 常驻镜像。仅桌面端；懒加载让浏览器调试路径
   * 一个字节都不多背。对账合并/发现网盘冲突副本时开口说一声，静默场景不打扰。
   */
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void (async () => {
      try {
        const version = await getAppVersion();
        const { runMirrorStartup } = await import('../services/mirrorStartup');
        const report = await runMirrorStartup(version);
        const lines: string[] = [];
        if (report.importedCanvases.length > 0) {
          lines.push(t('canvas.mirror_imported', { names: report.importedCanvases.join('、') }));
        }
        for (const merged of report.mergedCanvases) {
          lines.push(
            t('canvas.mirror_merged', { name: merged.name, added: merged.added, updated: merged.updated }),
          );
        }
        if (report.foreignFiles.length > 0) {
          lines.push(t('canvas.mirror_foreign', { names: report.foreignFiles.join('、') }));
        }
        if (lines.length > 0) {
          void appAlert({ title: t('canvas.mirror_report_title'), message: lines.join('\n') });
        }
      } catch (e) {
        logger.error('mirror', '镜像启动失败（应用照常可用，笔记暂不落文件）', e);
      }
    })();
    // 启动一次性流程，依赖刻意留空
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 旧的 base64 节点搬进文件存储。best-effort，失败原样留着靠 content 兜底显示
  useEffect(() => {
    void migrateBase64MediaNodes().then((count) => {
      if (count > 0) logger.info('app', `已把 ${count} 个节点的内联数据搬到文件存储`);
    });
  }, []);
}
