import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server as HttpServer } from 'http';
import { WebSocket as WsClient, WebSocketServer } from 'ws';

/**
 * Proxy WebSocket interne : relaie /ws/prices et /ws/signals depuis l'engine
 * (accessible uniquement en interne, jamais exposé publiquement) vers les
 * clients frontend connectés à l'API NestJS (seul point d'entrée public).
 *
 * Une seule connexion upstream par canal est maintenue vers l'engine et
 * partagée (broadcast) entre tous les clients frontend — évite de multiplier
 * les connexions vers l'engine.
 */
type Channel = 'prices' | 'signals';

class ChannelProxy {
  private wss?: WebSocketServer;
  private upstream?: WsClient;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectDelay = 2000;
  private stopped = false;
  private lastMessage: string | null = null;

  constructor(
    private readonly channel: Channel,
    private readonly upstreamUrl: string,
    private readonly allowedOrigins: string[],
    private readonly logger: Logger,
  ) {}

  attach(httpServer: HttpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: `/ws/${this.channel}`, perMessageDeflate: false });
    this.wss.on('connection', (client, req) => {
      const origin = req.headers.origin;
      if (origin && this.allowedOrigins.length > 0 && !this.allowedOrigins.includes(origin)) {
        client.close(1008, 'origin not allowed');
        return;
      }
      if (this.lastMessage) {
        try { client.send(this.lastMessage); } catch { /* client already gone */ }
      }
      client.on('error', () => client.terminate());
    });
    this.connectUpstream();
  }

  private connectUpstream() {
    if (this.stopped) return;
    try {
      this.upstream = new WsClient(this.upstreamUrl, { perMessageDeflate: false });
      this.upstream.on('open', () => {
        this.logger.log(`prices_proxy_upstream_connected channel=${this.channel}`);
        this.reconnectDelay = 2000;
      });
      this.upstream.on('message', (data) => {
        const text = data.toString();
        this.lastMessage = text;
        this.broadcast(text);
      });
      this.upstream.on('close', () => this.scheduleReconnect());
      this.upstream.on('error', (err: Error) => {
        this.logger.warn(`prices_proxy_upstream_error channel=${this.channel} — ${err.message}`);
        this.upstream?.terminate();
      });
    } catch (err: any) {
      this.logger.warn(`prices_proxy_connect_failed channel=${this.channel} — ${err?.message}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connectUpstream(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30_000);
  }

  private broadcast(text: string) {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) {
        try { client.send(text); } catch { /* ignore broken client */ }
      }
    }
  }

  destroy() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.upstream?.terminate();
    this.wss?.close();
  }
}

@Injectable()
export class PricesProxyService implements OnModuleDestroy {
  private readonly logger = new Logger(PricesProxyService.name);
  private channels: ChannelProxy[] = [];

  constructor(private config: ConfigService) {}

  attach(httpServer: HttpServer) {
    const engineUrl = this.config.get<string>('ENGINE_URL', 'http://localhost:8000');
    const wsBase = engineUrl.replace(/^http/, 'ws');
    const allowedOrigins = (this.config.get<string>('ALLOWED_ORIGINS') || '')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean);

    this.channels = [
      new ChannelProxy('prices', `${wsBase}/ws/prices`, allowedOrigins, this.logger),
      new ChannelProxy('signals', `${wsBase}/ws/signals`, allowedOrigins, this.logger),
    ];
    for (const channel of this.channels) channel.attach(httpServer);
  }

  onModuleDestroy() {
    for (const channel of this.channels) channel.destroy();
  }
}
