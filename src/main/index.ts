/** Hermes Bots — Electron main entry (Phase 0/1 foundation). */
import { app, powerMonitor, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { hardenSession, createMainWindow } from './window';
import { AppController } from './controller';
import { registerConnectionIpc } from './ipc/connection-ipc';
import { registerHermesIpc } from './ipc/hermes-ipc';
import { log } from './logging/logger';
import { APP_NAME } from '@shared/branding';

app.setName(APP_NAME);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const controller = new AppController();

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    hardenSession();
    registerConnectionIpc(controller);
    registerHermesIpc(controller);

    const preloadPath = join(__dirname, '../preload/index.js');
    const win = createMainWindow(controller.settings, preloadPath);
    controller.attachWindow(win);

    // Reconnect to the last server on launch when enabled.
    if (controller.settings.preferences.reconnectOnLaunch && controller.settings.connection) {
      controller.reconnect().catch((err) => {
        log.warn('startup', `auto-reconnect failed: ${(err as Error).message}`);
      });
    }

    powerMonitor.on('resume', () => controller.onSystemResume());
    powerMonitor.on('unlock-screen', () => controller.onSystemResume());

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const w = createMainWindow(controller.settings, preloadPath);
        controller.attachWindow(w);
      }
    });
  });

  app.on('window-all-closed', () => {
    // Closing the app closes the tunnel; remote services keep running.
    void controller.disconnect().finally(() => app.quit());
  });

  app.on('before-quit', () => {
    void controller.disconnect();
  });
}
