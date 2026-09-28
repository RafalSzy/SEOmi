import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { execSync } from 'child_process';

const iconsDir = path.resolve('src-tauri/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Function to generate a raw RGBA PNG file
function createPng(width, height, colorR, colorG, colorB) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Raw image data with scanline filter bytes (0 = None)
  const rowLength = width * 4 + 1;
  const rawData = Buffer.alloc(rowLength * height);

  for (let y = 0; y < height; y++) {
    const rowStart = y * rowLength;
    rawData[rowStart] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const pixelStart = rowStart + 1 + x * 4;
      // Gradient emerald to blue
      const ratio = (x + y) / (width + height);
      rawData[pixelStart] = Math.round(colorR * (1 - ratio) + 37 * ratio);     // R
      rawData[pixelStart + 1] = Math.round(colorG * (1 - ratio) + 99 * ratio); // G
      rawData[pixelStart + 2] = Math.round(colorB * (1 - ratio) + 235 * ratio);// B
      rawData[pixelStart + 3] = 255; // Alpha
    }
  }

  const idatData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', idatData);

  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(12 + len);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);
  const crc = crc32(buf.subarray(4, 8 + len));
  buf.writeUInt32BE(crc, 8 + len);
  return buf;
}

// CRC32 implementation for PNG chunks
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Generate the required icons
fs.writeFileSync(path.join(iconsDir, '32x32.png'), createPng(32, 32, 16, 185, 129));
fs.writeFileSync(path.join(iconsDir, '128x128.png'), createPng(128, 128, 16, 185, 129));
fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), createPng(256, 256, 16, 185, 129));
fs.writeFileSync(path.join(iconsDir, 'icon.png'), createPng(512, 512, 16, 185, 129));

// Generate icon.ico and icon.icns
const iconPng = path.join(iconsDir, 'icon.png');
fs.copyFileSync(iconPng, path.join(iconsDir, 'icon.ico'));
fs.copyFileSync(iconPng, path.join(iconsDir, 'icon.icns'));

console.log('App icons generated successfully in src-tauri/icons/');
