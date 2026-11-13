import { renderBadgesSvg, statsToBadges, toShieldsSchema } from './users.badges';

const stats = {
  articles: 12,
  issues: 5,
  replies: 30,
  submissions: 8,
  contributions: 414,
  streak: 7,
};

describe('users.badges', () => {
  it('statsToBadges 产出六枚徽章，消息来自计数', () => {
    const badges = statsToBadges(stats);

    expect(badges).toHaveLength(6);
    expect(badges.map((b) => b.label)).toEqual([
      '文章',
      '讨论',
      '回复',
      '提交',
      '近一年贡献',
      '站内连击',
    ]);
    expect(badges[0].message).toBe('12');
    expect(badges[5].message).toBe('7 天');
  });

  it('toShieldsSchema 输出 shields endpoint 协议形状', () => {
    const schema = toShieldsSchema(statsToBadges(stats));

    expect(schema[0]).toEqual({
      schemaVersion: 1,
      label: '文章',
      message: '12',
      color: '2575fc',
    });
  });

  it('renderBadgesSvg 输出合法 SVG 且包含每枚徽章的 label 与 message', () => {
    const svg = renderBadgesSvg(statsToBadges(stats));

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('近一年贡献');
    expect(svg).toContain('414');
    expect(svg).toContain('7 天');
  });

  it('renderBadgesSvg 转义 XML 特殊字符', () => {
    const svg = renderBadgesSvg([{ label: '<b>', message: 'a&b', color: '2575fc' }]);

    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;');
    expect(svg).toContain('a&amp;b');
  });
});
