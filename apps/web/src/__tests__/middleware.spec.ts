/**
 * @jest-environment node
 */
// next/server's NextRequest relies on the Fetch API globals (Request/Response/Headers)
// which the jsdom test environment does not provide — the node environment does.
import { NextRequest } from 'next/server';
import { middleware, config } from '../middleware';

describe('middleware (CSP)', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  const buildRequest = (path = '/dashboard') => new NextRequest(new URL(`http://localhost${path}`));

  it('sets a Content-Security-Policy header with the core directives', () => {
    const response = middleware(buildRequest());
    const csp = response.headers.get('Content-Security-Policy');

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self' data:");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('always whitelists Binance and Sentry origins in connect-src', () => {
    const response = middleware(buildRequest());
    const csp = response.headers.get('Content-Security-Policy')!;

    expect(csp).toContain('https://api.binance.com');
    expect(csp).toContain('https://*.sentry.io');
    expect(csp).toContain('https://*.ingest.sentry.io');
    expect(csp).toContain('https://*.ingest.us.sentry.io');
  });

  it('includes configured API/engine/WS origins in connect-src when set', () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';
    process.env.NEXT_PUBLIC_ENGINE_URL = 'https://engine.example.com';
    process.env.NEXT_PUBLIC_WS_URL = 'wss://ws.example.com';
    process.env.NEXT_PUBLIC_ENGINE_WS_URL = 'wss://engine-ws.example.com';

    const response = middleware(buildRequest());
    const csp = response.headers.get('Content-Security-Policy')!;

    expect(csp).toContain('https://api.example.com');
    expect(csp).toContain('https://engine.example.com');
    expect(csp).toContain('wss://ws.example.com');
    expect(csp).toContain('wss://engine-ws.example.com');
  });

  it('never leaks the literal "undefined" into connect-src when origin env vars are unset', () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_ENGINE_URL;
    delete process.env.NEXT_PUBLIC_WS_URL;
    delete process.env.NEXT_PUBLIC_ENGINE_WS_URL;

    const response = middleware(buildRequest());
    const csp = response.headers.get('Content-Security-Policy')!;

    expect(csp).not.toContain('undefined');
  });

  it('collapses the policy into a single-line header without extraneous whitespace', () => {
    const response = middleware(buildRequest());
    const csp = response.headers.get('Content-Security-Policy')!;

    expect(csp).not.toMatch(/\n/);
    expect(csp).not.toMatch(/ {2,}/);
    expect(csp.startsWith(' ')).toBe(false);
    expect(csp.endsWith(' ')).toBe(false);
  });

  it('forwards the request via NextResponse.next() (headers are additive, not a redirect)', () => {
    const response = middleware(buildRequest('/signals'));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Security-Policy')).toBeTruthy();
  });

  it('exports a matcher config excluding Next internals and static assets', () => {
    expect(config.matcher).toHaveLength(1);
    const pattern = config.matcher[0];

    expect(pattern).toContain('_next/static');
    expect(pattern).toContain('_next/image');
    expect(pattern).toContain('favicon');
    expect(pattern).toContain('manifest\\.json');
    expect(pattern).toContain('sw\\.js');
  });
});
