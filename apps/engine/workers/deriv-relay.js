/**
 * Deriv candles relay — Cloudflare Worker.
 *
 * Le VPS de Trading OS est bloqué par Deriv (HTTP 520 sur tous les frontaux WS).
 * Ce Worker sort depuis les edge IPs Cloudflare → Deriv accepte.
 *
 * GET /candles?symbol=R_75&granularity=3600&count=300
 *   → { "candles": [{epoch, open, high, low, close}, ...] }
 *
 * Déploy : dashboard Cloudflare → Workers → Create → coller ce fichier → Deploy.
 * Mettre l'URL dans l'env de l'engine : DERIV_PROXY_URL=https://xxx.workers.dev
 * (optionnel : sécuriser avec un header partagé RELAY_SECRET)
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ ok: true });
    }

    // Auth optionnelle — si RELAY_SECRET est défini, exige le header
    if (env.RELAY_SECRET) {
      if (request.headers.get('X-Relay-Key') !== env.RELAY_SECRET) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
      }
    }

    if (url.pathname !== '/candles') {
      return Response.json({ error: 'use /candles?symbol=R_75&granularity=3600&count=300' }, { status: 404 });
    }

    const symbol = url.searchParams.get('symbol');
    const granularity = parseInt(url.searchParams.get('granularity') || '3600', 10);
    const count = Math.min(parseInt(url.searchParams.get('count') || '300', 10), 5000);
    if (!symbol) {
      return Response.json({ error: 'symbol required' }, { status: 400 });
    }

    try {
      const candles = await fetchDerivCandles(symbol, granularity, count);
      return Response.json({ candles });
    } catch (err) {
      return Response.json({ error: String(err).slice(0, 200) }, { status: 502 });
    }
  },
};

async function fetchDerivCandles(symbol, granularity, count) {
  // WebSocket sortant via fetch upgrade (supporté dans Workers)
  const resp = await fetch('https://ws.derivws.com/websockets/v3?app_id=1089', {
    headers: { Upgrade: 'websocket' },
  });
  const ws = resp.webSocket;
  if (!ws) throw new Error('ws upgrade failed');
  ws.accept();

  const result = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { try { ws.close(); } catch {} ; reject(new Error('timeout')); }, 10000);
    ws.addEventListener('message', (ev) => {
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      const data = JSON.parse(ev.data);
      if (data.error) reject(new Error(data.error.message || 'deriv error'));
      else resolve(data.candles || []);
    });
    ws.addEventListener('error', (e) => { clearTimeout(timeout); reject(e); });
    ws.send(JSON.stringify({
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: 'latest',
      granularity,
      style: 'candles',
    }));
  });
  return result;
}
