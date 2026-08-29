import { Readable } from 'node:stream';
import { Request, Response, Router } from 'express';
import type { HlsRelay } from '../addon/stremio-adapter/hls-relay';
import { resolveHostUrl } from '../utils/context';

export class HlsRelayController {
  public readonly router: Router;

  public constructor(private readonly relay: HlsRelay) {
    this.router = Router();
    this.router.get('/hls-relay/:signature/:payload/:filename', this.relayRequest.bind(this));
  }

  private async relayRequest(req: Request, res: Response): Promise<void> {
    const signature = String(req.params['signature'] ?? '');
    const payload = String(req.params['payload'] ?? '');
    const target = this.relay.resolveTarget(signature, payload);
    if (!target) {
      res.status(403).send('Invalid relay URL');
      return;
    }
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(target, { headers: { ...(req.headers.range && { range: req.headers.range }) }, redirect: 'follow', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
    } catch {
      res.status(502).send('Upstream media request failed');
      return;
    }
    res.status(upstream.status);
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    const finalUrl = new URL(upstream.url);
    if (/mpegurl/i.test(upstream.headers.get('content-type') ?? '') || /\.m3u8$/i.test(finalUrl.pathname)) {
      const playlist = await upstream.text();
      const origin = resolveHostUrl(req);
      const rewritten = playlist.split(/\r?\n/).map((line) => {
        if (!line) return line;
        if (!line.startsWith('#')) return this.relay.createUrl(origin, new URL(line, finalUrl)).href;
        return line.replace(/URI="([^"]+)"/g, (_match, uri: string) => `URI="${this.relay.createUrl(origin, new URL(uri, finalUrl)).href}"`);
      }).join('\n');
      res.removeHeader('content-length');
      res.setHeader('cache-control', 'private, no-store');
      res.send(rewritten);
      return;
    }
    if (/\/page-\d+\.html$/i.test(finalUrl.pathname)) res.setHeader('content-type', 'video/mp2t');
    res.setHeader('cache-control', upstream.headers.get('cache-control') ?? 'private, max-age=3600');
    if (!upstream.body) {
      res.end();
      return;
    }
    Readable.fromWeb(upstream.body).pipe(res);
  }
}
