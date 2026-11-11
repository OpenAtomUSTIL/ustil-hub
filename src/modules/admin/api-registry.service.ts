import { Injectable, RequestMethod } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { DiscoveryService } from '@nestjs/core';
import { CurrentAuthUser } from '../../common/decorators/current-user.decorator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ROLES_KEY, Role } from '../../common/decorators/roles.decorator';
import { requireRole } from '../../common/permissions';

export interface ApiRegistryItem {
  method: string;
  path: string;
  isPublic: boolean;
  roles: Role[];
  controller: string;
  handler: string;
}

const API_PREFIX = '/api/v1';

// 反射目标：控制器类 / 处理器函数（装饰器元数据挂在上面）
interface NamedTarget {
  name: string;
  prototype?: object;
}

function toPathList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === 'string') {
    return [value];
  }
  return [''];
}

function joinPath(...segments: string[]): string {
  const parts = segments
    .flatMap((segment) => segment.split('/'))
    .filter((segment) => segment.length > 0);
  return `/${parts.join('/')}`;
}

function readPublic(target: NamedTarget, parent: NamedTarget): boolean {
  return (
    (Reflect.getMetadata(IS_PUBLIC_KEY, target) as boolean | undefined) ??
    (Reflect.getMetadata(IS_PUBLIC_KEY, parent) as boolean | undefined) ??
    false
  );
}

function readRoles(target: NamedTarget, parent: NamedTarget): Role[] {
  return (
    (Reflect.getMetadata(ROLES_KEY, target) as Role[] | undefined) ??
    (Reflect.getMetadata(ROLES_KEY, parent) as Role[] | undefined) ??
    []
  );
}

/** 全站接口清单：运行时反射路由 + @Public()/@Roles() 元数据 */
@Injectable()
export class ApiRegistryService {
  constructor(private readonly discovery: DiscoveryService) {}

  list(actor: CurrentAuthUser): ApiRegistryItem[] {
    requireRole(actor, Role.WHEEL, Role.ADMIN);
    const items: ApiRegistryItem[] = [];
    for (const wrapper of this.discovery.getControllers()) {
      const controllerClass = wrapper.metatype as unknown as NamedTarget | undefined;
      if (!controllerClass || !controllerClass.prototype) {
        continue;
      }
      const controllerPaths = toPathList(
        Reflect.getMetadata(PATH_METADATA, controllerClass) as unknown,
      );

      for (const [name, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(controllerClass.prototype),
      )) {
        if (name === 'constructor' || typeof descriptor.value !== 'function') {
          continue;
        }
        const handler = descriptor.value as unknown as NamedTarget;
        const handlerPaths = toPathList(Reflect.getMetadata(PATH_METADATA, handler) as unknown);
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (verb === undefined) {
          continue;
        }
        for (const controllerPath of controllerPaths) {
          for (const handlerPath of handlerPaths) {
            items.push({
              method: RequestMethod[verb],
              path: joinPath(API_PREFIX, controllerPath, handlerPath),
              isPublic: readPublic(handler, controllerClass),
              roles: readRoles(handler, controllerClass),
              controller: controllerClass.name,
              handler: name,
            });
          }
        }
      }
    }
    return items.sort(
      (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
    );
  }
}
