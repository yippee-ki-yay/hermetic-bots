/**
 * Capture docs/screenshot.png from the built renderer in demo mode.
 *
 * The renderer falls back to an in-memory bridge when the preload API is
 * absent, so a plain browser window shows the real UI with sample personas —
 * no VPS, no credentials, nothing private in the frame.
 *
 *   npm run build && npm run screenshot
 */
const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { extname } = require('node:path');

const ROOT = join(__dirname, '..');
const RENDERER = join(ROOT, 'out/renderer');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

app.whenReady().then(async () => {
  // Serve the built renderer locally; file:// would trip the CSP.
  const server = createServer(async (req, res) => {
    const path = (req.url || '/').split('?')[0];
    const file = join(RENDERER, path === '/' ? 'index.html' : path);
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#0c1012',
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`http://127.0.0.1:${port}/`);
  await new Promise((r) => setTimeout(r, 2000));

  // Drive the demo to a populated thread: an empty "new thread" pane makes a
  // poor hero image, and this one exercises streaming, a tool row, and an
  // approval panel at once.
  await win.webContents.executeJavaScript(`
    (async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelectorAll('.orb-btn')[1]?.click();
      await wait(400);
      document.querySelector('.cmd-header .icon-btn')?.click();
      await wait(400);
      document.querySelector('.deck-list .session-row')?.click();
      await wait(900);
      const outer = document.querySelector('.transcript-outer');
      if (outer) outer.scrollTop = outer.scrollHeight;
      await wait(400);
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 800));

  const shot = await win.webContents.capturePage();
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  writeFileSync(join(ROOT, 'docs/screenshot.png'), shot.toPNG());
  console.log(`docs/screenshot.png: ${shot.getSize().width}x${shot.getSize().height}`);

  win.destroy();
  server.close();
  app.quit();
});
