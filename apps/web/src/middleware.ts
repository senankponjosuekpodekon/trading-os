import { NextRequest, NextResponse } from 'next/server';

// Content-Security-Policy appliquée en middleware.
//
// NB : une CSP stricte basée sur nonce (script-src 'nonce-xxx' 'strict-dynamic')
// a été testée puis écartée — Next.js 14 (App Router) n'injecte pas le nonce sur
// les pages statiquement pré-rendues (la majorité des routes de cette app), et
// des bugs connus/non résolus dans Next.js font que certains chunks de script ne
// reçoivent pas non plus le nonce même sur les pages dynamiques
// (cf. vercel/next.js#93903, #66871). Une CSP nonce mal appliquée aurait bloqué
// le rendu de l'app. On garde donc `'unsafe-inline'` sur script-src : la
// protection réelle contre le XSS ici vient de l'échappement automatique de
// React (aucun `dangerouslySetInnerHTML` dans le code, vérifié) — cette CSP
// sert de défense en profondeur complémentaire (bloque le chargement de scripts
// externes non listés, le clickjacking, l'exfiltration vers des origines non
// whitelistées, l'injection d'<object>/<embed>).
export function middleware(request: NextRequest) {
  // Origines externes auxquelles le navigateur a besoin de se connecter
  // (fetch/XHR/WebSocket) — dérivées des mêmes variables d'env que le reste de l'app.
  const WIDGET_ORIGIN = 'https://bot-int-git-dev-senankponjosuekpodekons-projects.vercel.app';

  const connectSrc = [
    "'self'",
    process.env.NEXT_PUBLIC_API_URL,
    process.env.NEXT_PUBLIC_ENGINE_URL,
    process.env.NEXT_PUBLIC_WS_URL,
    process.env.NEXT_PUBLIC_ENGINE_WS_URL,
    'https://api.binance.com',
    'https://*.sentry.io',
    'https://*.ingest.sentry.io',
    'https://*.ingest.us.sentry.io',
    WIDGET_ORIGIN,
  ]
    .filter(Boolean)
    .join(' ');

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' ${WIDGET_ORIGIN};
    style-src 'self' 'unsafe-inline' ${WIDGET_ORIGIN};
    img-src 'self' data: blob: ${WIDGET_ORIGIN};
    font-src 'self' data: ${WIDGET_ORIGIN};
    connect-src ${connectSrc};
    frame-src 'self' ${WIDGET_ORIGIN};
    worker-src 'self';
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
  `;
  const contentSecurityPolicyHeaderValue = cspHeader.replace(/\s{2,}/g, ' ').trim();

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', contentSecurityPolicyHeaderValue);

  return response;
}

export const config = {
  matcher: [
    // Exclut les assets statiques et les routes API internes (JSON, pas de HTML à protéger)
    '/((?!_next/static|_next/image|favicon\\.ico|manifest\\.json|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
