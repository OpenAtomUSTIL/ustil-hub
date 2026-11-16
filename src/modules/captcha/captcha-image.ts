import { randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';

export type CaptchaTheme = 'light' | 'dark';
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// 5×7 点阵只用于服务端绘制；响应不包含字符、字体映射或文本元数据。
const FONT: Record<string, string> = {
  A:'01110/10001/10001/11111/10001/10001/10001', B:'11110/10001/10001/11110/10001/10001/11110',
  C:'01111/10000/10000/10000/10000/10000/01111', D:'11110/10001/10001/10001/10001/10001/11110',
  E:'11111/10000/10000/11110/10000/10000/11111', F:'11111/10000/10000/11110/10000/10000/10000',
  G:'01111/10000/10000/10111/10001/10001/01110', H:'10001/10001/10001/11111/10001/10001/10001',
  J:'00111/00010/00010/00010/10010/10010/01100', K:'10001/10010/10100/11000/10100/10010/10001',
  L:'10000/10000/10000/10000/10000/10000/11111', M:'10001/11011/10101/10101/10001/10001/10001',
  N:'10001/11001/10101/10011/10001/10001/10001', P:'11110/10001/10001/11110/10000/10000/10000',
  Q:'01110/10001/10001/10001/10101/10010/01101', R:'11110/10001/10001/11110/10100/10010/10001',
  S:'01111/10000/10000/01110/00001/00001/11110', T:'11111/00100/00100/00100/00100/00100/00100',
  U:'10001/10001/10001/10001/10001/10001/01110', V:'10001/10001/10001/10001/10001/01010/00100',
  W:'10001/10001/10001/10101/10101/10101/01010', X:'10001/10001/01010/00100/01010/10001/10001',
  Y:'10001/10001/01010/00100/00100/00100/00100', Z:'11111/00001/00010/00100/01000/10000/11111',
  2:'01110/10001/00001/00010/00100/01000/11111', 3:'11110/00001/00001/01110/00001/00001/11110',
  4:'00010/00110/01010/10010/11111/00010/00010', 5:'11111/10000/10000/11110/00001/00001/11110',
  6:'01110/10000/10000/11110/10001/10001/01110', 7:'11111/00001/00010/00100/01000/01000/01000',
  8:'01110/10001/10001/01110/10001/10001/01110', 9:'01110/10001/10001/01111/00001/00001/01110',
};

export function randomCaptchaCode(length = 5): string {
  return Array.from({ length }, () => CHARSET[randomInt(CHARSET.length)]).join('');
}

function pngChunk(type: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, body, checksum]);
}

/** 自绘 RGB PNG；变形与噪声只落像素，不把答案以 SVG/text 或 PNG 元数据发给客户端。 */
export function renderCaptchaPng(code: string, theme: CaptchaTheme): Buffer {
  const width = 160, height = 56;
  const bg = theme === 'dark' ? [35, 34, 32] : [245, 244, 237];
  const colors = theme === 'dark' ? [[226,149,118],[132,193,169],[146,185,226]] : [[156,75,51],[52,108,89],[60,96,139]];
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = bg[i % 3];
  const paint = (x: number, y: number, color: number[]) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const at = (y * width + x) * 3;
    for (let channel = 0; channel < 3; channel++) pixels[at + channel] = color[channel];
  };
  for (let i = 0; i < 150; i++) paint(randomInt(width), randomInt(height), colors[randomInt(colors.length)]);
  for (let i = 0; i < 3; i++) {
    const offset = randomInt(8, height - 8), phase = randomInt(100);
    for (let x = 0; x < width; x++) paint(x, offset + Math.sin((x + phase) / 18) * 4, colors[i]);
  }
  for (const [index, ch] of [...code.toUpperCase()].entries()) {
    const glyph = FONT[ch];
    if (!glyph) throw new Error('Unsupported captcha character');
    const scale = randomInt(3, 5), angle = randomInt(-14, 15) * Math.PI / 180;
    const centerX = (index + 1) * width / (code.length + 1) + randomInt(-2, 3);
    const centerY = height / 2 + randomInt(-3, 4), color = colors[randomInt(colors.length)];
    for (const [row, cells] of glyph.split('/').entries()) for (const [col, value] of [...cells].entries()) {
      if (value !== '1') continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const x = (col - 2.5) * scale + dx, y = (row - 3.5) * scale + dy;
        paint(centerX + x * Math.cos(angle) - y * Math.sin(angle), centerY + x * Math.sin(angle) + y * Math.cos(angle), color);
      }
    }
  }
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
