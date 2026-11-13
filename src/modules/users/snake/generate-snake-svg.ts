/* 站内贪吃蛇 SVG 生成：活跃数据 → 贡献网格 → Platane/snk 同款求解/渲染（vendored，见 vendor/NOTICE.txt） */
import { cellsToGrid } from './vendor/cellsToGrid';
import { snake4 } from './vendor/types/__fixtures__/snake';
import { getBestRoute } from './vendor/solver/getBestRoute';
import { getPathToPose } from './vendor/solver/getPathToPose';
import { createSvg } from './vendor/svg-creator';
import type { Color } from './vendor/types/grid';
import { basePalettes } from './vendor/palettes';

export type ActivityDay = { date: string; count: number };

type Cell = { x: number; y: number; level: number };

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 近一年活跃日 → 贡献网格 cells（x=周列、y=星期行、level 0-4，与个人主页热力图同口径：周日起始） */
export function activityToCells(days: ActivityDay[], weeks = 53): Cell[] {
  const counts = new Map(days.map((d) => [d.date, d.count]));
  const todayKey = utcDayKey(new Date());
  const cursor = new Date();
  cursor.setUTCDate(cursor.getUTCDate() - weeks * 7);
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());

  const cells: Cell[] = [];
  let x = -1;
  while (utcDayKey(cursor) <= todayKey) {
    if (cursor.getUTCDay() === 0) x += 1;
    const key = utcDayKey(cursor);
    cells.push({ x, y: cursor.getUTCDay(), level: Math.min(counts.get(key) ?? 0, 4) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cells;
}

/** 生成深浅两套动画 SVG：求解一次、按 GitHub 浅色/深色调色板各渲染一次 */
export function generateSnakeSvgs(
  days: ActivityDay[],
  weeks = 53,
): { light: string; dark: string } {
  const cells = activityToCells(days, weeks);
  const grid = cellsToGrid(cells);

  const chain = getBestRoute(grid, snake4);
  if (!chain) throw new Error('贪吃蛇路径求解失败');
  chain.push(...(getPathToPose(chain[chain.length - 1], snake4) ?? []));

  const render = (theme: 'light' | 'dark'): string => {
    const palette = theme === 'dark' ? basePalettes['github-dark'] : basePalettes['github-light'];
    // colorDots 上游调色板是数组（下标=等级），转成 DrawOptions 要求的按等级取色记录
    const dots = palette.colorDots;
    const colorDots = { 1: dots[1], 2: dots[2], 3: dots[3], 4: dots[4] } as Record<Color, string>;

    return createSvg(
      grid,
      cells,
      chain,
      {
        sizeDotBorderRadius: 2,
        sizeCell: 16,
        sizeDot: 12,
        colorDots,
        colorEmpty: palette.colorEmpty,
        colorDotBorder: palette.colorDotBorder,
        colorSnake: palette.colorSnake,
      },
      { stepDurationMs: 100 },
    );
  };

  return { light: render('light'), dark: render('dark') };
}
