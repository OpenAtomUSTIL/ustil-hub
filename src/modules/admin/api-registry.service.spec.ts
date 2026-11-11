import 'reflect-metadata';
import { Controller, Get, Post } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Role, Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ApiRegistryService } from './api-registry.service';

@Controller('demo')
class DemoController {
  @Get()
  list() {
    return [];
  }

  @Get(':id')
  detail() {
    return null;
  }
}

@Controller('open')
class OpenController {
  @Public()
  @Get('health')
  health() {
    return { ok: true };
  }

  @Post()
  @Roles(Role.WHEEL, Role.ADMIN)
  create() {
    return null;
  }
}

describe('ApiRegistryService', () => {
  let service: ApiRegistryService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [DemoController, OpenController],
      providers: [ApiRegistryService, DiscoveryService],
    }).compile();
    service = moduleRef.get(ApiRegistryService);
  });

  it('运行时枚举路由与 @Public()/@Roles() 元数据（smoke）', () => {
    const items = service.list({ id: 'admin-1', role: Role.ADMIN });

    const paths = items.map((item) => `${item.method} ${item.path}`);
    expect(paths).toContain('GET /api/v1/demo');
    expect(paths).toContain('GET /api/v1/demo/:id');
    expect(paths).toContain('GET /api/v1/open/health');
    expect(paths).toContain('POST /api/v1/open');

    const health = items.find((item) => item.path === '/api/v1/open/health');
    expect(health).toMatchObject({
      isPublic: true,
      roles: [],
      controller: 'OpenController',
      handler: 'health',
    });

    const create = items.find((item) => item.method === 'POST');
    expect(create).toMatchObject({
      isPublic: false,
      roles: [Role.WHEEL, Role.ADMIN],
    });

    const detail = items.find((item) => item.path === '/api/v1/demo/:id');
    expect(detail).toMatchObject({ isPublic: false, roles: [], handler: 'detail' });

    // 排序：按 path 升序
    const sortedPaths = items.map((item) => item.path);
    expect(sortedPaths).toEqual([...sortedPaths].sort());
  });

  it('MEMBER 查询返回 403', () => {
    expect(() => service.list({ id: 'm-1', role: Role.MEMBER })).toThrow(
      '无权访问该资源',
    );
  });
});
