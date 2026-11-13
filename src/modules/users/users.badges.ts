import { StatsBadgeItem, UserStatsBadgeView } from './users.views';

/** 社区数据 → 徽章集（指标文案与配色是对外口径，放 service 之外避免混入业务） */
export function statsToBadges(stats: UserStatsBadgeView): StatsBadgeItem[] {
  return [
    { label: '文章', message: String(stats.articles), color: '2575fc' },
    { label: '讨论', message: String(stats.issues), color: '6a11cb' },
    { label: '回复', message: String(stats.replies), color: '12387e' },
    { label: '提交', message: String(stats.submissions), color: '2b1663' },
    { label: '近一年贡献', message: String(stats.contributions), color: 'ff69b4' },
    { label: '站内连击', message: `${stats.streak} 天`, color: '30a14e' },
  ];
}

/** shields.io endpoint 徽章协议（shields.io/badges/endpoint-badge） */
export function toShieldsSchema(
  badges: StatsBadgeItem[],
): { schemaVersion: 1; label: string; message: string; color: string }[] {
  return badges.map((b) => ({
    schemaVersion: 1,
    label: b.label,
    message: b.message,
    color: b.color,
  }));
}

const FONT_SIZE = 12;
const PILL_HEIGHT = 26;
const PILL_PAD = 10;
const PILL_GAP = 5;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 字宽估算：CJK 全角按 1em，其余按 0.62em */
function textWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? FONT_SIZE : FONT_SIZE * 0.62;
  }
  return width;
}

/** 站内自绘 SVG 徽章行（for-the-badge 风格：label 深底 + message 彩底），供 README <img> 相对路径引用 */
export function renderBadgesSvg(badges: StatsBadgeItem[]): string {
  const pills = badges.map((b) => {
    const labelWidth = textWidth(b.label) + PILL_PAD * 2;
    const messageWidth = textWidth(b.message) + PILL_PAD * 2;
    return { ...b, labelWidth, width: labelWidth + messageWidth };
  });
  const totalWidth =
    pills.reduce((sum, p) => sum + p.width, 0) + PILL_GAP * Math.max(pills.length - 1, 0);
  const textY = PILL_HEIGHT / 2 + FONT_SIZE * 0.36;
  const font = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";

  let x = 0;
  const parts: string[] = [];
  for (const p of pills) {
    parts.push(
      `<rect x="${x}" y="0" width="${p.width}" height="${PILL_HEIGHT}" rx="4" fill="#${p.color}"/>`,
      `<rect x="${x}" y="0" width="${p.labelWidth}" height="${PILL_HEIGHT}" rx="4" fill="#555"/>`,
      `<rect x="${x + p.labelWidth - 4}" y="0" width="4" height="${PILL_HEIGHT}" fill="#555"/>`,
      `<text x="${x + PILL_PAD}" y="${textY}" fill="#fff" font-family="${font}" font-size="${FONT_SIZE}" font-weight="600">${escapeXml(p.label)}</text>`,
      `<text x="${x + p.labelWidth + PILL_PAD}" y="${textY}" fill="#fff" font-family="${font}" font-size="${FONT_SIZE}" font-weight="600">${escapeXml(p.message)}</text>`,
    );
    x += p.width + PILL_GAP;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${PILL_HEIGHT}" ` +
    `viewBox="0 0 ${totalWidth} ${PILL_HEIGHT}" role="img" aria-label="社区数据">${parts.join('')}</svg>`
  );
}
