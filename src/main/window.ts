/**
 * Hardened BrowserWindow: sandboxed renderer, context isolation,
 * strict CSP, blocked navigation, vetted external links, denied permissions.
 */
import { BrowserWindow, session, shell, app } from 'electron';
import { join } from 'node:path';
import { log } from './logging/logger';
import type { SettingsStore } from './storage/settings-store';

const CSP = [
  "default-src 'none'",
  // Dev only: vite/react fast-refresh injects an inline preamble script.
  process.env.ELECTRON_RENDERER_URL ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
  // Inline style attributes only (React style props); no remote styles.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'" + (process.env.ELECTRON_RENDERER_URL ? ' ws: http:' : ''),
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function hardenSession(): void {
  const ses = session.defaultSession;

  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });

  // Deny every permission request; the app needs none.
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    log.warn('security', `denied permission request: ${permission}`);
    callback(false);
  });
}

export function createMainWindow(settings: SettingsStore, preloadPath: string): BrowserWindow {
  const bounds = settings.windowBounds;
  const win = new BrowserWindow({
    width: bounds?.width ?? 1440,
    height: bounds?.height ?? 900,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0c1012',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: preloadPath,
      spellcheck: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  const saveBounds = (): void => {
    if (!win.isDestroyed()) settings.setWindowBounds(win.getBounds());
  };
  win.on('resized', saveBounds);
  win.on('moved', saveBounds);

  // Block navigation away from the app.
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
    log.warn('security', `blocked navigation to ${new URL(url).origin}`);
  });

  // New windows never open inside Electron; vetted https goes to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') {
        void shell.openExternal(url);
      } else {
        log.warn('security', `blocked window.open scheme ${parsed.protocol}`);
      }
    } catch {
      /* unparseable URL — drop it */
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(app.getAppPath(), 'out/renderer/index.html'));
  }

  return win;
}
