/**
 * Build build/icon.icns (and icon.png) from build/icon.svg.
 *
 * Rasterizing needs a renderer, and Electron already ships one — so load the
 * SVG in an offscreen window, capture it, and downscale with nativeImage.
 * `iconutil` (macOS) assembles the .iconset into the final .icns. No extra
 * image dependencies.
 *
 *   npm run icon
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = join(__dirname, '..');
const BUILD = join(ROOT, 'build');
const ICONSET = join(BUILD, 'icon.iconset');

// The sizes `iconutil` expects, as {file suffix, pixel size}.
const VARIANTS = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = readFileSync(join(BUILD, 'icon.svg'), 'utf8');
  const html = `<!doctype html><meta charset="utf-8">
    <style>html,body{margin:0;padding:0;background:transparent;width:1024px;height:1024px;overflow:hidden}</style>
    ${svg}`;

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  // Give the renderer a beat to paint gradients before capturing.
  await new Promise((r) => setTimeout(r, 400));

  const shot = await win.webContents.capturePage();
  const master = shot.getSize().width === 1024 ? shot : shot.resize({ width: 1024, height: 1024 });
  writeFileSync(join(BUILD, 'icon.png'), master.toPNG());
  console.log(`icon.png: ${master.getSize().width}x${master.getSize().height}`);

  rmSync(ICONSET, { recursive: true, force: true });
  mkdirSync(ICONSET, { recursive: true });
  for (const [name, size] of VARIANTS) {
    const resized = master.resize({ width: size, height: size, quality: 'best' });
    writeFileSync(join(ICONSET, name), resized.toPNG());
  }
  console.log(`wrote ${VARIANTS.length} iconset variants`);

  execFileSync('/usr/bin/iconutil', ['-c', 'icns', ICONSET, '-o', join(BUILD, 'icon.icns')]);
  rmSync(ICONSET, { recursive: true, force: true });
  console.log('built build/icon.icns');

  win.destroy();
  app.quit();
});
