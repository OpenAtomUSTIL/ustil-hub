import type { Response } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 3600;

const REFRESH_COOKIE_PATH = '/api/v1/auth';

/** cookie 域（v11.0）：设置后主站会话对子域（如 docs.）可见，供文档站试调携带；缺省 host-only（本地开发不受影响）。
    每次调用惰性读取——模块加载期早于 ConfigModule 注入 .env。 */
function cookieDomain(): string | undefined {
  return process.env.COOKIE_DOMAIN?.trim() || undefined;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export function setAuthCookies(res: Response, tokens: AuthTokens): void {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    domain: cookieDomain(),
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: REFRESH_COOKIE_PATH,
    domain: cookieDomain(),
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    domain: cookieDomain(),
  });
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: REFRESH_COOKIE_PATH,
    domain: cookieDomain(),
  });
}
