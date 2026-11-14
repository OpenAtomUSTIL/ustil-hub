import { randomInt } from 'node:crypto';

// 不含易混字符（0/O、1/I/l），降低机器识别与人工误读
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const TINTS = ['#d97757', '#629987', '#6a9bcc', '#827dbd', '#bf4d43'];

export function randomCaptchaCode(length = 5): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CHARSET[randomInt(CHARSET.length)];
  }
  return code;
}

/** 自绘 SVG 验证码：逐字符扰动 + 噪声线，无第三方依赖 */
export function renderCaptchaSvg(code: string): string {
  const width = 140;
  const height = 48;
  const chars = code.split('');
  const step = width / (chars.length + 1);

  const noise = Array.from({ length: 4 }, () => {
    const y1 = randomInt(4, height - 4);
    const y2 = randomInt(4, height - 4);
    const cpx = randomInt(10, width - 10);
    const cpy = randomInt(4, height - 4);
    return `<path d="M0 ${y1} Q ${cpx} ${cpy} ${width} ${y2}" stroke="${TINTS[randomInt(TINTS.length)]}" stroke-width="1.2" fill="none" opacity="0.45"/>`;
  }).join('');

  const dots = Array.from({ length: 8 }, () =>
    `<circle cx="${randomInt(2, width - 2)}" cy="${randomInt(2, height - 2)}" r="1.2" fill="${TINTS[randomInt(TINTS.length)]}" opacity="0.4"/>`,
  ).join('');

  const glyphs = chars
    .map((ch, i) => {
      const x = step * (i + 1) + randomInt(-3, 3);
      const y = height / 2 + randomInt(-6, 7);
      const rotate = randomInt(-22, 23);
      const size = randomInt(22, 30);
      const fill = TINTS[randomInt(TINTS.length)];
      return `<text x="${x}" y="${y}" font-family="monospace" font-size="${size}" font-weight="bold" fill="${fill}" text-anchor="middle" transform="rotate(${rotate} ${x} ${y})">${ch}</text>`;
    })
    .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" rx="6" fill="#f5f4ed"/>`,
    noise,
    dots,
    glyphs,
    `</svg>`,
  ].join('');
}
