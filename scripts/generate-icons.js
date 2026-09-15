// Node script to generate valid PNG icon files for PWA
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

// Minimal pure PNG generator without external dependencies
function createPng(width, height, drawPixel) {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type 6: RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT raw data (filter byte 0 per scanline + RGBA pixels)
  const rowLength = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowLength);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0; // Filter None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawPixel(x, y, width, height);
      const pixelOffset = rowOffset + 1 + x * 4;
      rawData[pixelOffset] = r;
      rawData[pixelOffset + 1] = g;
      rawData[pixelOffset + 2] = b;
      rawData[pixelOffset + 3] = a;
    }
  }

  const compressedData = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = createChunk('IDAT', compressedData);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 implementation for PNG chunks
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const len = data.length;
  const typeBuf = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  typeBuf.copy(chunk, 4);
  data.copy(chunk, 8);
  const crc = crc32(Buffer.concat([typeBuf, data]));
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

// Draw brand icon: Dark slate background (#020617) with an inner circular emblem,
// vinyl record grooves, headphones/calendar frame, and brand tricolor dots
// (ALMA Blue #9fc6e7, La Escalera Green #a7dc9e, DJ Orange #f8995d).
function renderBrandIcon(isMaskable) {
  return function(x, y, w, h) {
    const cx = w / 2;
    const cy = h / 2;
    const nx = (x - cx) / (w / 2); // -1 to 1
    const ny = (y - cy) / (h / 2); // -1 to 1
    const dist = Math.sqrt(nx * nx + ny * ny);

    // Background: dark slate #020617 to #0f172a subtle gradient
    let bgR = 2, bgG = 6, bgB = 23;
    const grad = 0.5 + 0.5 * ny;
    bgR = Math.round(2 + grad * 12);
    bgG = Math.round(6 + grad * 16);
    bgB = Math.round(23 + grad * 24);

    // If not maskable, we can round the corners smoothly or keep full bleed
    // For app icon, rounded rect or full bleed dark background
    let r = bgR, g = bgG, b = bgB, a = 255;

    // Outer emblem circle: radius ~0.75 for non-maskable, ~0.65 for maskable (safe zone)
    const maxR = isMaskable ? 0.65 : 0.78;

    if (dist <= maxR) {
      // Vinyl record base / plate (#0f172a to #1e293b)
      const plateShade = 20 + Math.round((1 - dist / maxR) * 25);
      r = plateShade;
      g = plateShade + 6;
      b = plateShade + 18;

      // Vinyl groove rings
      const grooveDist = dist * 25;
      const isGroove = Math.sin(grooveDist * Math.PI) > 0.6 && dist > 0.35 && dist < maxR - 0.05;
      if (isGroove) {
        r = Math.max(0, r - 10);
        g = Math.max(0, g - 10);
        b = Math.max(0, b - 10);
      }

      // Center vinyl label / hub (radius 0.32)
      if (dist <= 0.32) {
        // Inner hub background: dark indigo #1e1b4b
        r = 30;
        g = 27;
        b = 75;

        // Center tricolor accents:
        // ALMA Blue #9fc6e7 (159, 198, 231)
        // La Escalera Green #a7dc9e (167, 220, 158)
        // DJ Orange #f8995d (248, 153, 93)
        const angle = Math.atan2(ny, nx); // -PI to PI
        if (dist > 0.18 && dist < 0.28) {
          if (angle >= -Math.PI && angle < -Math.PI / 3) {
            // Blue sector
            r = 159; g = 198; b = 231;
          } else if (angle >= -Math.PI / 3 && angle < Math.PI / 3) {
            // Green sector
            r = 167; g = 220; b = 158;
          } else {
            // Orange sector
            r = 248; g = 153; b = 93;
          }
        }

        // Center spindle hole (radius 0.07)
        if (dist <= 0.07) {
          r = 2; g = 6; b = 23;
        } else if (dist <= 0.09) {
          r = 148; g = 163; b = 184; // silver ring #94a3b8
        }
      }

      // Smooth outer antialiased edge of the emblem
      const edgeDist = maxR - dist;
      if (edgeDist < 0.02) {
        const factor = Math.max(0, Math.min(1, edgeDist / 0.02));
        r = Math.round(r * factor + bgR * (1 - factor));
        g = Math.round(g * factor + bgG * (1 - factor));
        b = Math.round(b * factor + bgB * (1 - factor));
      }
    }

    // Tricolor indicator dots at bottom (Agenda Calendar theme)
    // Left: ALMA Blue (x=-0.25, y=0.52)
    // Mid: La Escalera Green (x=0, y=0.52)
    // Right: DJ Orange (x=0.25, y=0.52)
    const dotY = isMaskable ? 0.58 : 0.65;
    const dotRadius = isMaskable ? 0.045 : 0.055;

    const checkDot = (dotX, dR, dG, dB) => {
      const d = Math.hypot(nx - dotX, ny - dotY);
      if (d <= dotRadius) {
        const factor = Math.min(1, (dotRadius - d) / 0.015);
        r = Math.round(dR * factor + r * (1 - factor));
        g = Math.round(dG * factor + g * (1 - factor));
        b = Math.round(dB * factor + b * (1 - factor));
      }
    };

    checkDot(-0.25, 159, 198, 231); // Blue
    checkDot(0, 167, 220, 158);    // Green
    checkDot(0.25, 248, 153, 93);   // Orange

    return [r, g, b, a];
  };
}

const publicDir = path.resolve('public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

console.log('Generating PWA icons in public/...');

// 1. 192x192 PNG
const png192 = createPng(192, 192, renderBrandIcon(false));
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), png192);

// 2. 512x512 PNG
const png512 = createPng(512, 512, renderBrandIcon(false));
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), png512);

// 3. 512x512 Maskable PNG
const pngMaskable512 = createPng(512, 512, renderBrandIcon(true));
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), pngMaskable512);

// 4. 180x180 Apple Touch Icon
const appleTouchIcon = createPng(180, 180, renderBrandIcon(false));
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleTouchIcon);

// 5. 64x64 Favicon
const favicon = createPng(64, 64, renderBrandIcon(false));
fs.writeFileSync(path.join(publicDir, 'favicon.ico'), favicon);
fs.writeFileSync(path.join(publicDir, 'favicon.png'), favicon);

console.log('All PNG icons generated successfully!');
