import { usePWAInstallContext } from '../contexts/PWAInstallContext';

export function usePWAInstall() {
  const ctx = usePWAInstallContext();
  return {
    isInstallable: ctx.isInstallable,
    isInstalled: ctx.isInstalled,
    isIOS: ctx.isIOS,
    isIOSSafari: ctx.isIOSSafari,
    isAndroid: ctx.isAndroid,
    isDismissed: ctx.isDismissed,
    isBusy: ctx.isBusy,
    hasApkFile: ctx.hasApkFile,
    apkUrl: ctx.apkUrl,
    apkMimeType: ctx.apkMimeType,
    install: ctx.triggerDownloadApp,
    openSheet: ctx.openSheet,
    closeSheet: ctx.closeSheet,
    dismissForSevenDays: ctx.dismissForSevenDays,
    setBusyActivity: ctx.setBusyActivity,
  };
}
