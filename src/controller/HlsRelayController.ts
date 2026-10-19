import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Request, Response, Router } from 'express';
import { type HlsMediaFormat, hlsMediaFormats, type HlsRelay, type HlsRelayResource } from '../addon/stremio-adapter/hls-relay';
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
    const resource = target.resource;
    const controller = new AbortController();
    req.once('aborted', () => controller.abort());
    res.once('close', () => controller.abort());
    const timeout = setTimeout(() => controller.abort(), 30000);
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(target.url, { method: req.method, headers: { ...target.headers, ...(resource.kind !== 'playlist' && req.headers.range && { range: req.headers.range }) }, redirect: 'follow', signal: controller.signal });
    } catch {
      if (!res.destroyed) res.status(502).send('Upstream media request failed');
      return;
    } finally {
      clearTimeout(timeout);
    }
    res.status(upstream.status);
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges'] as const) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (upstream.ok) {
      if (resource.kind === 'playlist') {
        res.status(200);
        res.removeHeader('content-length');
        res.removeHeader('content-range');
        res.removeHeader('accept-ranges');
        res.setHeader('content-type', 'application/vnd.apple.mpegurl');
      } else if (resource.kind === 'segment' || resource.kind === 'initialization') res.setHeader('content-type', hlsMediaFormats[resource.format].contentType);
      else if (resource.kind === 'key') res.setHeader('content-type', 'application/octet-stream');
    }
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const finalUrl = new URL(upstream.url);
    if (upstream.ok && (resource.kind === 'playlist' || /mpegurl/i.test(upstream.headers.get('content-type') ?? ''))) {
      const playlist = await upstream.text();
      const origin = resolveHostUrl(req);
      const lines = playlist.split(/\r?\n/);
      const mediaPlaylist = lines.some(line => /^#(?:EXTINF:|EXT-X-(?:TARGETDURATION|PART|MAP):)/.test(line));
      let format: HlsMediaFormat | undefined = resource.kind === 'playlist' ? resource.format : undefined;
      const rewritten = lines.map((line) => {
        if (!line.trim()) return line;
        const tag = line.split(':', 1)[0];
        if (tag === '#EXT-X-MAP') format = format === 'vtt' ? 'vtt' : 'fmp4';
        if (!line.startsWith('#')) {
          const url = new URL(line.trim(), finalUrl);
          const extension = url.pathname.match(/\.(aac|vtt|m4s|mp4|ts)$/i)?.[1]?.toLowerCase();
          const segmentFormat = format ?? (extension === 'aac' || extension === 'vtt' ? extension : extension === 'm4s' || extension === 'mp4' ? 'fmp4' : 'mpegts');
          return this.relay.createUrl(origin, { url, ...(target.headers && { headers: target.headers }), resource: mediaPlaylist ? { kind: 'segment', format: segmentFormat } : { kind: 'playlist', ...(format && { format }) } }).href;
        }
        return line.replace(/([:,])URI="([^"]+)"/g, (match, prefix: string, uri: string) => {
          const url = new URL(uri, finalUrl);
          if (url.protocol !== 'https:') return match;
          let child: HlsRelayResource;
          if (['#EXT-X-MEDIA', '#EXT-X-I-FRAME-STREAM-INF', '#EXT-X-IMAGE-STREAM-INF', '#EXT-X-RENDITION-REPORT'].includes(tag ?? '')) child = { kind: 'playlist', ...(/(?:^|,)TYPE=SUBTITLES(?:,|$)/.test(line.slice(line.indexOf(':') + 1)) ? { format: 'vtt' as const } : format && { format }) };
          else if (tag === '#EXT-X-KEY' || tag === '#EXT-X-SESSION-KEY') child = { kind: 'key' };
          else if (tag === '#EXT-X-MAP' || (tag === '#EXT-X-PRELOAD-HINT' && /(?:^|,)TYPE=MAP(?:,|$)/.test(line.slice(line.indexOf(':') + 1)))) child = { kind: 'initialization', format: format === 'vtt' ? 'vtt' : 'fmp4' };
          else if (tag === '#EXT-X-PART' || tag === '#EXT-X-PRELOAD-HINT') {
            const extension = url.pathname.match(/\.(aac|vtt|m4s|mp4|ts)$/i)?.[1]?.toLowerCase();
            child = { kind: 'segment', format: format ?? (extension === 'aac' || extension === 'vtt' ? extension : extension === 'm4s' || extension === 'mp4' ? 'fmp4' : 'mpegts') };
          } else child = { kind: 'file' };
          return `${prefix}URI="${this.relay.createUrl(origin, { url, ...(target.headers && { headers: target.headers }), resource: child }).href}"`;
        });
      }).join('\n');
      res.status(200);
      res.removeHeader('content-length');
      res.removeHeader('content-range');
      res.removeHeader('accept-ranges');
      res.setHeader('content-type', 'application/vnd.apple.mpegurl');
      res.setHeader('cache-control', 'private, no-store');
      res.send(rewritten);
      return;
    }
    res.setHeader('cache-control', upstream.headers.get('cache-control') ?? 'private, max-age=3600');
    if (!upstream.body) {
      res.end();
      return;
    }
    try {
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch {
      if (!res.headersSent) res.status(502).send('Upstream media transfer failed');
    }
  }
}
