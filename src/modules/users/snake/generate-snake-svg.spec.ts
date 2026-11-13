import { activityToCells, generateSnakeSvgs } from './generate-snake-svg';

const dayKey = (offset: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

describe('generateSnakeSvgs', () => {
  it('activityToCells 按周日对齐铺满网格，level 取 min(count, 4)', () => {
    const cells = activityToCells([{ date: dayKey(1), count: 7 }], 2);

    expect(cells.length).toBeGreaterThan(7);
    expect(cells.length).toBeLessThanOrEqual(21);
    expect(new Set(cells.map((c) => c.y))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    const hit = cells.find((c) => c.level > 0);
    expect(hit?.level).toBe(4);
  });

  it('生成深浅两套动画 SVG，带上游署名与调色差异', () => {
    const days = [
      { date: dayKey(0), count: 2 },
      { date: dayKey(2), count: 1 },
    ];
    const svgs = generateSnakeSvgs(days, 3);

    expect(svgs.light.startsWith('<svg')).toBe(true);
    expect(svgs.dark.startsWith('<svg')).toBe(true);
    expect(svgs.light).toContain('Generated with https://github.com/Platane/snk');
    expect(svgs.dark).toContain('#161b22');
    expect(svgs.light).not.toBe(svgs.dark);
  });

  it('无活跃日也能生成（空网格不崩）', () => {
    const svgs = generateSnakeSvgs([], 3);

    expect(svgs.light.startsWith('<svg')).toBe(true);
    expect(svgs.dark.startsWith('<svg')).toBe(true);
  });
});
