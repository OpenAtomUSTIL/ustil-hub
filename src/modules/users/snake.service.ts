import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { v5 as uuidv5 } from 'uuid';
import { FileStorage, STORAGE_SERVICE } from '../storage/storage.types';
import { generateSnakeSvgs } from './snake/generate-snake-svg';
import { mergeActivityParts } from './users.service';
import { UsersRepository } from './users.repository';

export type SnakeTheme = 'light' | 'dark';

/** v5 命名空间：固定字符串即可，保证 key 跨进程确定 */
const SNAKE_KEY_NAMESPACE = '6f9e2c1a-5b3d-4e7f-8a2c-1d4e6b8f0a3c';

/** 存储 key 用确定性 uuid（符合 STORAGE_KEY_PATTERN 的 uuid.ext 形态，免建映射表） */
function snakeStorageKey(userId: string, theme: SnakeTheme): string {
  return `${uuidv5(`snake:${userId}:${theme}`, SNAKE_KEY_NAMESPACE)}.svg`;
}

/** 个人主页 README 贡献贪吃蛇：定时预生成（@platane/snk 同款），公开按用户名供给 */
@Injectable()
export class SnakeService {
  constructor(
    private readonly usersRepository: UsersRepository,
    @Inject(STORAGE_SERVICE) private readonly storage: FileStorage,
  ) {}

  /** 生成并存储某用户深浅两套贪吃蛇 SVG（幂等覆盖） */
  async generateForUser(userId: string): Promise<void> {
    const since = new Date();
    since.setFullYear(since.getFullYear() - 1);
    const parts = await this.usersRepository.getActivityParts(userId, since);
    const days = mergeActivityParts(parts);
    const svgs = generateSnakeSvgs(days);
    await this.storage.put(
      snakeStorageKey(userId, 'light'),
      Buffer.from(svgs.light, 'utf8'),
      'image/svg+xml',
    );
    await this.storage.put(
      snakeStorageKey(userId, 'dark'),
      Buffer.from(svgs.dark, 'utf8'),
      'image/svg+xml',
    );
  }

  /** 每日批量刷新全员贪吃蛇 */
  async refreshAll(): Promise<number> {
    const ids = await this.usersRepository.listActiveUserIds();
    for (const id of ids) {
      await this.generateForUser(id);
    }
    return ids.length;
  }

  /** README 引用：按用户名取预生成 SVG */
  async getSnakeSvg(username: string, theme: SnakeTheme): Promise<string> {
    const row = await this.usersRepository.findByUsername(username);
    if (!row) {
      throw new NotFoundException('用户不存在');
    }
    try {
      const { data } = await this.storage.get(snakeStorageKey(row.id, theme));
      return data.toString('utf8');
    } catch {
      throw new NotFoundException('贪吃蛇尚未生成');
    }
  }
}
