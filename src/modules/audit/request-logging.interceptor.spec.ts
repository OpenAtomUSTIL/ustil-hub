import { of } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

function fakeContext(url: string, method = 'GET') {
  const listeners: Record<string, () => void> = {};
  const req = {
    originalUrl: url,
    url,
    method,
    headers: { 'user-agent': 'jest' },
    ip: '127.0.0.1',
    user: { id: 'u-1', role: 'MEMBER', email: 'a@example.com' },
  };
  const res = {
    statusCode: 200,
    on: (event: string, cb: () => void) => {
      listeners[event] = cb;
    },
  };
  return {
    context: {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as never,
    finish: () => listeners['finish']?.(),
  };
}

describe('RequestLoggingInterceptor', () => {
  const requestLogsRepository = { insert: jest.fn(), list: jest.fn() };
  const interceptor = new RequestLoggingInterceptor(requestLogsRepository);

  beforeEach(() => {
    jest.clearAllMocks();
    requestLogsRepository.insert.mockResolvedValue(undefined);
  });

  it('记录全部 /api/v1/** 请求（含 GET）', () => {
    const { context, finish } = fakeContext('/api/v1/articles?page=1', 'GET');

    interceptor.intercept(context, { handle: () => of(undefined) }).subscribe();
    finish();

    expect(requestLogsRepository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/v1/articles',
        userId: 'u-1',
      }),
    );
  });

  it('非 /api/v1 路径不记录', () => {
    const { context, finish } = fakeContext('/health', 'GET');

    interceptor.intercept(context, { handle: () => of(undefined) }).subscribe();
    finish();

    expect(requestLogsRepository.insert).not.toHaveBeenCalled();
  });

  it('写库失败静默', async () => {
    requestLogsRepository.insert.mockRejectedValue(new Error('db down'));
    const { context, finish } = fakeContext('/api/v1/auth/login', 'POST');

    interceptor.intercept(context, { handle: () => of(undefined) }).subscribe();
    expect(() => finish()).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
