import { UserThrottlerGuard } from './user-throttler.guard';

describe('UserThrottlerGuard', () => {
  // Le constructeur de ThrottlerGuard requiert des dépendances DI (options,
  // storage, reflector) sans intérêt pour tester la logique de tracking pure.
  // On instancie via le prototype pour isoler getTracker()/_extractToken().
  const createGuard = (): UserThrottlerGuard =>
    Object.create(UserThrottlerGuard.prototype) as UserThrottlerGuard;

  const buildRequest = (overrides: Record<string, any> = {}) => ({
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  });

  const base64UrlEncode = (obj: unknown): string =>
    Buffer.from(JSON.stringify(obj)).toString('base64');

  const getTracker = (guard: UserThrottlerGuard, req: any): Promise<string> =>
    (guard as any).getTracker(req);

  it('returns a user-scoped tracker when a valid Bearer JWT with sub is provided', async () => {
    const guard = createGuard();
    const payload = base64UrlEncode({ sub: 'user-42' });
    const req = buildRequest({ headers: { authorization: `Bearer header.${payload}.sig` } });

    const tracker = await getTracker(guard, req);

    expect(tracker).toBe('user:user-42');
  });

  it('falls back to IP tracking when Authorization header is missing', async () => {
    const guard = createGuard();
    const req = buildRequest();

    const tracker = await getTracker(guard, req);

    expect(tracker).toBe('ip:127.0.0.1');
  });

  it('falls back to IP tracking when Authorization scheme is not Bearer', async () => {
    const guard = createGuard();
    const req = buildRequest({ headers: { authorization: 'Basic abc123' } });

    const tracker = await getTracker(guard, req);

    expect(tracker).toBe('ip:127.0.0.1');
  });

  it('falls back to IP tracking when the token payload is malformed', async () => {
    const guard = createGuard();
    const req = buildRequest({ headers: { authorization: 'Bearer not.a.validtoken!!!' } });

    const tracker = await getTracker(guard, req);

    expect(tracker).toBe('ip:127.0.0.1');
  });

  it('falls back to IP tracking when the token payload has no sub claim', async () => {
    const guard = createGuard();
    const payload = base64UrlEncode({ foo: 'bar' });
    const req = buildRequest({ headers: { authorization: `Bearer header.${payload}.sig` } });

    const tracker = await getTracker(guard, req);

    expect(tracker).toBe('ip:127.0.0.1');
  });

  it('falls back to socket.remoteAddress when req.ip is unavailable', async () => {
    const guard = createGuard();
    const req = buildRequest({ ip: undefined, socket: { remoteAddress: '10.0.0.5' } });

    const tracker = await getTracker(guard, req);

    expect(tracker).toBe('ip:10.0.0.5');
  });

  it('falls back to "unknown" when neither ip nor remoteAddress are available', async () => {
    const guard = createGuard();
    const req = buildRequest({ ip: undefined, socket: {} });

    const tracker = await getTracker(guard, req);

    expect(tracker).toBe('ip:unknown');
  });
});
