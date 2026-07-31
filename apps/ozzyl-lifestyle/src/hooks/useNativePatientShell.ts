import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

interface NativeShellOptions {
  statusBarColor: `#${string}`;
  statusBarStyle?: 'light' | 'dark';
  onBack?: () => boolean;
}

export function useNativePatientShell(options: NativeShellOptions) {
  const { onBack, statusBarColor, statusBarStyle = 'dark' } = options;

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let removeBackButtonListener: (() => void) | undefined;
    let active = true;

    void (async () => {
      const [{ StatusBar, Style }, { App }] = await Promise.all([
        import('@capacitor/status-bar'),
        import('@capacitor/app'),
      ]);

      if (!active) return;

      await StatusBar.setStyle({
        style: statusBarStyle === 'light' ? Style.Light : Style.Dark,
      }).catch(() => undefined);

      await StatusBar.setBackgroundColor({
        color: statusBarColor,
      }).catch(() => undefined);

      const backButtonListener = await App.addListener('backButton', ({ canGoBack }) => {
        const handled = onBack?.() ?? false;
        if (handled) return;

        if (canGoBack && window.history.length > 1) {
          window.history.back();
          return;
        }

        void App.exitApp();
      });

      removeBackButtonListener = () => {
        void backButtonListener.remove();
      };
    })();

    return () => {
      active = false;
      removeBackButtonListener?.();
    };
  }, [onBack, statusBarColor, statusBarStyle]);
}
