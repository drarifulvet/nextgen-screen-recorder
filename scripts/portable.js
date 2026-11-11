// Makes the portable zip from the unpacked Windows build (run after `electron-builder --win`).
// Output: dist/NextGen-Screen-Recorder-Portable-<version>.zip containing one folder
// "NextGen Screen Recorder" with the app, a portable.ini marker and a short read-me.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
// electron-builder ships its own 7-Zip; use the same one (works on Windows, macOS and Linux).
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip');

const ROOT = path.join(__dirname, '..');
const { version } = require(path.join(ROOT, 'package.json'));
const SRC = path.join(ROOT, 'dist', 'win-unpacked');
const STAGE = path.join(ROOT, 'dist', 'portable-stage');
const FOLDER = path.join(STAGE, 'NextGen Screen Recorder');
const OUT = path.join(ROOT, 'dist', `NextGen-Screen-Recorder-Portable-${version}.zip`);

if (!fs.existsSync(path.join(SRC, 'NextGen Screen Recorder.exe'))) {
  console.error('Build the Windows app first (dist/win-unpacked is missing).');
  process.exit(1);
}
(async () => {
fs.rmSync(STAGE, { recursive: true, force: true });
fs.rmSync(OUT, { force: true });
fs.cpSync(SRC, FOLDER, { recursive: true });

fs.writeFileSync(path.join(FOLDER, 'portable.ini'), [
  '; NextGen Screen Recorder - portable mode',
  '; While this file is here, settings, stream keys and the Library list are kept in the',
  '; "NextGen Recorder Data" folder next to the app instead of in your Windows profile.',
  '; Delete this file to use the normal Windows profile location.',
  '',
].join('\r\n'));

fs.writeFileSync(path.join(FOLDER, 'READ ME - Portable.txt'), [
  `NextGen Screen Recorder ${version} - portable version`,
  'Free screen recorder by NextGen IT. No installation needed.',
  '',
  'HOW TO START',
  '1. Keep this whole folder together (on your PC or a USB stick).',
  '2. Double-click "NextGen Screen Recorder.exe".',
  '3. If Windows shows "Windows protected your PC", click "More info", then "Run anyway".',
  '',
  'WHERE THINGS ARE KEPT',
  '- Settings, stream keys and the Library list: the "NextGen Recorder Data" folder here.',
  '- Videos: your Videos\\NextGen Recorder folder (change it in Settings > Saving).',
  '- Stream keys are encrypted for your Windows account. On another PC you will need',
  '  to paste them again.',
  '',
  'TO UPDATE',
  'Download the new portable zip and copy the "NextGen Recorder Data" folder into it.',
  '',
  'Help and downloads: https://github.com/drarifulvet/nextgen-screen-recorder/releases',
  '',
].join('\r\n'));

execFileSync(await getPath7za(), ['a', '-tzip', '-mx=7', OUT, FOLDER], { stdio: 'ignore' });
fs.rmSync(STAGE, { recursive: true, force: true });
console.log(`  • portable zip: ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`);
})().catch((e) => { console.error('Portable zip failed:', e.message); process.exit(1); });
