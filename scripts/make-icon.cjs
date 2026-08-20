/**
 * Build build/icon.icns (and icon.png) for the app.
 *
 * Source, in order of preference:
 *   1. a path passed on the command line   — npm run icon -- /path/to/art.png
 *   2. build/icon-source.png               — drop a square export here
 *   3. build/icon.svg                      — the hand-authored fallback
 *
 * Rasterizing an SVG needs a renderer and Electron already ships one, so the
 * SVG path loads it in an offscreen window and captures it. A supplied bitmap
 * skips that entirely. `iconutil` (macOS) assembles the .iconset into the
 * final .icns, so there is no image toolchain to install.
 *
 *   npm run icon
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } = require('node:fs');
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

/** Load a supplied bitmap, or render build/icon.svg offscreen. */
async function buildMaster() {
  const argPath = process.argv.slice(2).find((a) => !a.startsWith('-') && /\.(png|jpg|jpeg|webp)$/i.test(a));
  const dropIn = join(BUILD, 'icon-source.png');
  const bitmap = argPath || (existsSync(dropIn) ? dropIn : null);

  if (bitmap) {
    const img = nativeImage.createFromBuffer(readFileSync(bitmap));
    if (img.isEmpty()) throw new Error(`could not read ${bitmap} as an image`);
    const { width, height } = img.getSize();
    console.log(`source: ${bitmap} (${width}x${height})`);
    // Square-crop off-centre art rather than distorting it.
    const side = Math.min(width, height);
    const square =
      width === height
        ? img
        : img.crop({
            x: Math.round((width - side) / 2),
            y: Math.round((height - side) / 2),
            width: side,
            height: side,
          });
    return square.resize({ width: 1024, height: 1024, quality: 'best' });
  }

  console.log('source: build/icon.svg');
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
  win.destroy();
  return shot.getSize().width === 1024 ? shot : shot.resize({ width: 1024, height: 1024 });
}

app.whenReady().then(async () => {
  const master = await buildMaster();
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

  app.quit();
});
