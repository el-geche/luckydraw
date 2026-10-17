// Generates PWA icons (gold-on-navy mark) from SVG. Run: node client/scripts/generate-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

// The mark occupies the central ~62% of the canvas; maskable variant keeps it inside the 80% safe zone.
const mark = (scale) => `
  <g transform="translate(256 256) scale(${scale}) translate(-32 -34)">
    <circle cx="32" cy="34" r="22" fill="none" stroke="#c9a24a" stroke-width="3"/>
    <path d="M32 12v44M10 34h44M16.4 18.4l31.2 31.2M47.6 18.4L16.4 49.6" stroke="#c9a24a" stroke-width="1.4" opacity=".45"/>
    <circle cx="32" cy="34" r="5.5" fill="#c9a24a"/>
    <path d="M32 4l6 9H26z" fill="#e6c77f"/>
  </g>`;
const bg = (rounded) => `<defs><radialGradient id="g" cx="50%" cy="30%" r="75%"><stop offset="0" stop-color="#16233f"/><stop offset="1" stop-color="#0b1324"/></radialGradient></defs>
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="url(#g)"/>`;
const svg = ({ rounded, scale }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg(rounded)}${mark(scale)}</svg>`;

const any = svg({ rounded: true, scale: 5.6 });
const full = svg({ rounded: false, scale: 5.6 });   // apple-touch: iOS applies its own mask
const maskable = svg({ rounded: false, scale: 4.3 });
fs.writeFileSync(path.join(out, 'icon.svg'), any);
fs.writeFileSync(path.join(out, 'maskable.svg'), maskable);
const png = (s, size, file) => fs.writeFileSync(path.join(out, file), new Resvg(s, { fitTo: { mode: 'width', value: size } }).render().asPng());
for (const size of [64, 128, 192, 256, 512]) png(any, size, `icon-${size}.png`);
png(maskable, 512, 'maskable-512.png');
png(maskable, 192, 'maskable-192.png');
png(full, 180, 'apple-touch-icon-180.png');
console.log('icons written to', out);
