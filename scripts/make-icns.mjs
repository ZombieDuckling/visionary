#!/usr/bin/env node
// Generate public/icons/icon.icns from public/icons/icon-512.svg.
//
// Rasterization needs @resvg/resvg-js, which is intentionally NOT a repo
// dependency (zero-dep policy). Run once per icon change:
//   npm i --no-save @resvg/resvg-js && node scripts/make-icns.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let Resvg;
try {
  ({ Resvg } = await import('@resvg/resvg-js'));
} catch {
  console.error('Missing rasterizer. Run: npm i --no-save @resvg/resvg-js');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'public/icons/icon-512.svg'));

// icns entries that accept raw PNG payloads (size in px → OSType).
const TYPES = [
  [16, 'icp4'],
  [32, 'icp5'],
  [32, 'ic11'], // 16pt @2x
  [64, 'ic12'], // 32pt @2x
  [128, 'ic07'],
  [256, 'ic08'],
  [256, 'ic13'], // 128pt @2x
  [512, 'ic09'],
  [512, 'ic14'], // 256pt @2x
  [1024, 'ic10'], // 512pt @2x
];

const pngBySize = new Map();
for (const size of new Set(TYPES.map(([s]) => s))) {
  const rendered = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  }).render();
  pngBySize.set(size, rendered.asPng());
}

const chunks = TYPES.map(([size, type]) => {
  const png = pngBySize.get(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 'ascii');
  header.writeUInt32BE(8 + png.length, 4);
  return Buffer.concat([header, png]);
});

const body = Buffer.concat(chunks);
const fileHeader = Buffer.alloc(8);
fileHeader.write('icns', 0, 'ascii');
fileHeader.writeUInt32BE(8 + body.length, 4);

const out = join(root, 'public/icons/icon.icns');
writeFileSync(out, Buffer.concat([fileHeader, body]));
console.log(`wrote ${out} (${8 + body.length} bytes, ${chunks.length} entries)`);
