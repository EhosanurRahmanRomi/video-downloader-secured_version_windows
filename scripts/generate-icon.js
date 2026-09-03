'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const scale = 3;
const sourceSize = 512 * scale;
const pixels = new Uint8Array(sourceSize * sourceSize * 4);

function blend(x, y, color) {
  if (x < 0 || y < 0 || x >= sourceSize || y >= sourceSize) return;
  const index = (y * sourceSize + x) * 4;
  const alpha = color[3] / 255;
  const existingAlpha = pixels[index + 3] / 255;
  const outAlpha = alpha + existingAlpha * (1 - alpha);
  if (!outAlpha) return;
  for (let channel = 0; channel < 3; channel += 1) {
    pixels[index + channel] = Math.round((color[channel] * alpha + pixels[index + channel] * existingAlpha * (1 - alpha)) / outAlpha);
  }
  pixels[index + 3] = Math.round(outAlpha * 255);
}

function roundedContains(x, y, left, top, right, bottom, radius) {
  const closestX = Math.max(left + radius, Math.min(x, right - radius));
  const closestY = Math.max(top + radius, Math.min(y, bottom - radius));
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

function roundedRect(left, top, right, bottom, radius, colorAt) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (roundedContains(x, y, left, top, right, bottom, radius)) blend(x, y, colorAt(x, y));
    }
  }
}

function triangle(a, b, c, color) {
  const minX = Math.floor(Math.min(a[0], b[0], c[0]));
  const maxX = Math.ceil(Math.max(a[0], b[0], c[0]));
  const minY = Math.floor(Math.min(a[1], b[1], c[1]));
  const maxY = Math.ceil(Math.max(a[1], b[1], c[1]));
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const p = [x, y];
      const d1 = sign(p, a, b); const d2 = sign(p, b, c); const d3 = sign(p, c, a);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) blend(x, y, color);
    }
  }
}

function line(x1, y1, x2, y2, width, color) {
  const minX = Math.floor(Math.min(x1, x2) - width);
  const maxX = Math.ceil(Math.max(x1, x2) + width);
  const minY = Math.floor(Math.min(y1, y2) - width);
  const maxY = Math.ceil(Math.max(y1, y2) + width);
  const dx = x2 - x1; const dy = y2 - y1; const lengthSquared = dx * dx + dy * dy;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
      const px = x1 + t * dx; const py = y1 + t * dy;
      if ((x - px) ** 2 + (y - py) ** 2 <= (width / 2) ** 2) blend(x, y, color);
    }
  }
}

const s = (value) => Math.round(value * scale);
roundedRect(0, 0, sourceSize, sourceSize, s(118), () => [13, 20, 32, 255]);
roundedRect(s(59), s(86), s(453), s(423), s(78), (x, y) => {
  const position = Math.min(1, Math.max(0, ((x / scale - 68) + (y / scale - 91)) / 700));
  return [Math.round(104 - 64 * position), Math.round(183 - 70 * position), Math.round(255 - 35 * position), 255];
});
triangle([s(207), s(180)], [s(207), s(343)], [s(360), s(261.5)], [255, 255, 255, 255]);
line(s(256), s(45), s(256), s(160), s(28), [255, 255, 255, 255]);
line(s(203), s(108), s(256), s(162), s(28), [255, 255, 255, 255]);
line(s(309), s(108), s(256), s(162), s(28), [255, 255, 255, 255]);

const size = 512;
const output = Buffer.alloc(size * size * 4);
for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      let sum = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          sum += pixels[(((y * scale + sy) * sourceSize + (x * scale + sx)) * 4) + channel];
        }
      }
      output[((y * size + x) * 4) + channel] = Math.round(sum / (scale * scale));
    }
  }
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return result;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8; ihdr[9] = 6;
const scanlines = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) output.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync(path.resolve(__dirname, '..', 'build', 'icon.png'), png);
console.log(`Generated 512x512 app icon (${png.length} bytes).`);
