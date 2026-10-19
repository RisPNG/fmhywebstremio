import { once } from 'node:events';
import { type IncomingHttpHeaders, type IncomingMessage, request, type RequestOptions, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { HlsRelay } from '../addon/stremio-adapter/hls-relay';
import { HlsRelayController } from './HlsRelayController';

function requestRelay(url: URL, options: RequestOptions): Promise<{ status: number | undefined; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const client = request(url, options, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.once('error', reject);
    });
    client.once('error', reject);
    client.end();
  });
}

describe('media relay controller', () => {
  let server: Server;
  let relay: HlsRelay;
  let origin: URL;
  let relayUrl: URL;
  const target = new URL('https://media.test/movie.mp4?token=fixture');

  beforeEach(async () => {
    relay = new HlsRelay();
    const app = express();
    app.use(new HlsRelayController(relay).router);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    relayUrl = relay.createUrl(origin, { url: target, headers: { referer: 'https://player.test/' }, resource: { kind: 'file' } });
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test.each(['video/mp4', 'application/vnd.apple.mpegurl'])('forwards HEAD for %s without reading its body', async (contentType) => {
    const pull = jest.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(Buffer.from('data'));
      controller.close();
    });
    const upstream = new Response(new ReadableStream({ pull }, { highWaterMark: 0 }), { status: 200, headers: { 'content-type': contentType, 'content-length': '4', 'accept-ranges': 'bytes' } });
    Object.defineProperty(upstream, 'url', { value: target.href });
    const fetchUpstream = jest.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);
    const result = await requestRelay(relayUrl, { method: 'HEAD' });
    expect(fetchUpstream).toHaveBeenCalledWith(target, expect.objectContaining({ method: 'HEAD', headers: { referer: 'https://player.test/' } }));
    expect(result).toMatchObject({ status: 200, headers: { 'content-type': contentType, 'content-length': '4', 'accept-ranges': 'bytes' } });
    expect(result.body.byteLength).toBe(0);
    expect(pull).not.toHaveBeenCalled();
  });

  test('forwards a byte range and preserves partial-response status, headers, and media', async () => {
    const upstream = new Response(Buffer.from('part'), { status: 206, headers: { 'content-type': 'video/mp4', 'content-length': '4', 'content-range': 'bytes 10-13/100', 'accept-ranges': 'bytes' } });
    Object.defineProperty(upstream, 'url', { value: target.href });
    const fetchUpstream = jest.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);
    const result = await requestRelay(relayUrl, { method: 'GET', headers: { range: 'bytes=10-13' } });
    expect(fetchUpstream).toHaveBeenCalledWith(target, expect.objectContaining({ method: 'GET', headers: { referer: 'https://player.test/', range: 'bytes=10-13' } }));
    expect(result).toMatchObject({ status: 206, headers: { 'content-type': 'video/mp4', 'content-length': '4', 'content-range': 'bytes 10-13/100', 'accept-ranges': 'bytes' } });
    expect(result.body.toString()).toBe('part');
  });

  test('rewrites opaque master variants, alternate renditions, and I-frame references as playlists', async () => {
    const playlist = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",URI="captions.jpg"\n#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="iframe.png"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,AUDIO="audio",SUBTITLES="subs"\nvariant.png\n';
    const upstream = new Response(playlist, { headers: { 'content-type': 'text/plain', 'content-length': String(Buffer.byteLength(playlist)) } });
    Object.defineProperty(upstream, 'url', { value: 'https://cdn.test/catalog/root' });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);
    const result = await requestRelay(relay.createUrl(origin, { url: new URL('https://cdn.test/opaque'), resource: { kind: 'playlist' }, headers: { referer: 'https://player.test/' } }), { method: 'GET' });
    expect(result.headers['content-type']).toContain('application/vnd.apple.mpegurl');
    const rewritten = result.body.toString();
    const urls = [...rewritten.matchAll(/URI="([^"]+)"/g)].map(match => new URL(match[1] as string));
    urls.push(new URL(rewritten.trim().split('\n').at(-1) as string));
    expect(urls).toHaveLength(4);
    expect(urls.every(url => url.pathname.endsWith('/playlist.m3u8'))).toBe(true);
    expect(urls.map((url) => {
      const parts = url.pathname.split('/');
      return relay.resolveTarget(parts.at(-3) as string, parts.at(-2) as string);
    })).toEqual([
      { url: new URL('https://cdn.test/catalog/audio'), headers: { referer: 'https://player.test/' }, resource: { kind: 'playlist' } },
      { url: new URL('https://cdn.test/catalog/captions.jpg'), headers: { referer: 'https://player.test/' }, resource: { kind: 'playlist', format: 'vtt' } },
      { url: new URL('https://cdn.test/catalog/iframe.png'), headers: { referer: 'https://player.test/' }, resource: { kind: 'playlist' } },
      { url: new URL('https://cdn.test/catalog/variant.png'), headers: { referer: 'https://player.test/' }, resource: { kind: 'playlist' } },
    ]);
  });

  test('returns a complete transformed playlist when a player requests an upstream byte range', async () => {
    const playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nfirst.png\n#EXTINF:6,\nsecond.png\n#EXT-X-ENDLIST\n';
    const length = Buffer.byteLength(playlist);
    const upstream = new Response(playlist, { status: 206, headers: { 'content-type': 'application/vnd.apple.mpegurl', 'content-length': String(length), 'content-range': `bytes 0-${length - 1}/${length}`, 'accept-ranges': 'bytes' } });
    Object.defineProperty(upstream, 'url', { value: 'https://cdn.test/root' });
    const fetchUpstream = jest.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);
    const result = await requestRelay(relay.createUrl(origin, { url: new URL('https://cdn.test/root'), resource: { kind: 'playlist' }, headers: { referer: 'https://player.test/' } }), { method: 'GET', headers: { range: 'bytes=0-' } });
    expect(fetchUpstream).toHaveBeenCalledWith(new URL('https://cdn.test/root'), expect.objectContaining({ headers: { referer: 'https://player.test/' } }));
    expect(result.status).toBe(200);
    expect(result.headers['content-range']).toBeUndefined();
    expect(result.headers['accept-ranges']).toBeUndefined();
    expect(Number(result.headers['content-length'])).toBe(result.body.byteLength);
    expect(result.body.byteLength).toBeGreaterThan(length);
    expect(result.body.toString().endsWith('#EXT-X-ENDLIST\n')).toBe(true);
    const segments = result.body.toString().split('\n').filter(line => line && !line.startsWith('#')).map(line => new URL(line));
    expect(segments).toHaveLength(2);
    for (const segment of segments) {
      const parts = segment.pathname.split('/');
      expect(relay.resolveTarget(parts.at(-3) as string, parts.at(-2) as string)).toMatchObject({ resource: { kind: 'segment', format: 'mpegts' } });
    }
  });

  test('does not advertise original playlist byte ranges or length for HEAD', async () => {
    const pull = jest.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(Buffer.from('data'));
      controller.close();
    });
    const upstream = new Response(new ReadableStream({ pull }, { highWaterMark: 0 }), { status: 206, headers: { 'content-type': 'text/plain', 'content-length': '4', 'content-range': 'bytes 0-3/4', 'accept-ranges': 'bytes' } });
    Object.defineProperty(upstream, 'url', { value: 'https://cdn.test/root' });
    const fetchUpstream = jest.spyOn(globalThis, 'fetch').mockResolvedValue(upstream);
    const result = await requestRelay(relay.createUrl(origin, { url: new URL('https://cdn.test/root'), resource: { kind: 'playlist' } }), { method: 'HEAD', headers: { range: 'bytes=0-' } });
    expect(fetchUpstream).toHaveBeenCalledWith(new URL('https://cdn.test/root'), expect.objectContaining({ method: 'HEAD', headers: {} }));
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toBe('application/vnd.apple.mpegurl');
    expect(result.headers['content-range']).toBeUndefined();
    expect(result.headers['content-length']).toBeUndefined();
    expect(result.headers['accept-ranges']).toBeUndefined();
    expect(result.body.byteLength).toBe(0);
    expect(pull).not.toHaveBeenCalled();
  });

  test('serves transport stream bytes hidden behind image and extensionless URLs with native TS names and MIME', async () => {
    const playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="key.png"\n#EXTINF:6,\nfirst.png\n#EXTINF:6,\nsecond.jpg\n#EXTINF:6,\nthird\n#EXT-X-ENDLIST\n';
    const fetchUpstream = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input as URL;
      const response = new Response(url.pathname.endsWith('/root') ? playlist : url.pathname.endsWith('/key.png') ? Buffer.alloc(16, 7) : Buffer.from([0x47, 0x40, 0x11, 0x10]), { headers: { 'content-type': 'image/png' } });
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    });
    const result = await requestRelay(relay.createUrl(origin, { url: new URL('https://cdn.test/root'), resource: { kind: 'playlist' }, headers: { referer: 'https://player.test/' } }), { method: 'GET' });
    const lines = result.body.toString().trim().split('\n');
    const segments = lines.filter(line => !line.startsWith('#')).map(line => new URL(line));
    expect(segments).toHaveLength(3);
    expect(segments.every(url => url.pathname.endsWith('/segment.ts'))).toBe(true);
    for (const segment of segments) {
      const media = await requestRelay(segment, { method: 'GET' });
      expect(media.headers['content-type']).toBe('video/mp2t');
      expect(media.body).toEqual(Buffer.from([0x47, 0x40, 0x11, 0x10]));
    }
    const key = new URL(lines.find(line => line.startsWith('#EXT-X-KEY:'))?.match(/URI="([^"]+)"/)?.[1] as string);
    expect(key.pathname.endsWith('/key.key')).toBe(true);
    const secret = await requestRelay(key, { method: 'GET' });
    expect(secret.headers['content-type']).toBe('application/octet-stream');
    expect(secret.body).toEqual(Buffer.alloc(16, 7));
    expect(fetchUpstream.mock.calls.every(([, options]) => (options?.headers as Record<string, string>)['referer'] === 'https://player.test/')).toBe(true);
  });

  test('keeps initialization data and fMP4 fragments distinct, including partial and preload resources', async () => {
    const playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="init.png",BYTERANGE="32@0"\n#EXT-X-PART:DURATION=0.5,URI="part.jpg"\n#EXT-X-PRELOAD-HINT:TYPE=PART,URI="next-part"\n#EXT-X-PRELOAD-HINT:TYPE=MAP,URI="next-init"\n#EXTINF:6,\nfragment\n#EXT-X-ENDLIST\n';
    const fetchUpstream = jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, options) => {
      const url = input as URL;
      const ranged = (options?.headers as Record<string, string>)['range'];
      const response = new Response(url.pathname.endsWith('/root') ? playlist : Buffer.from('ftyp'), { status: ranged ? 206 : 200, headers: { 'content-type': 'image/jpeg', ...(ranged && { 'content-range': 'bytes 0-3/32', 'content-length': '4', 'accept-ranges': 'bytes' }) } });
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    });
    const result = await requestRelay(relay.createUrl(origin, { url: new URL('https://cdn.test/root'), resource: { kind: 'playlist' } }), { method: 'GET' });
    const lines = result.body.toString().trim().split('\n');
    const resources = [...result.body.toString().matchAll(/URI="([^"]+)"/g)].map(match => new URL(match[1] as string));
    resources.push(new URL(lines.at(-2) as string));
    expect(resources.map(url => url.pathname.split('/').at(-1))).toEqual(['init.mp4', 'segment.m4s', 'segment.m4s', 'init.mp4', 'segment.m4s']);
    for (const url of resources) {
      const parts = url.pathname.split('/');
      const target = relay.resolveTarget(parts.at(-3) as string, parts.at(-2) as string);
      expect(target?.resource).toEqual({ kind: url.pathname.endsWith('/init.mp4') ? 'initialization' : 'segment', format: 'fmp4' });
    }
    const initialization = await requestRelay(resources[0] as URL, { method: 'GET', headers: { range: 'bytes=0-3' } });
    expect(initialization).toMatchObject({ status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/32', 'content-length': '4', 'accept-ranges': 'bytes' } });
    expect(initialization.body.toString()).toBe('ftyp');
    expect(fetchUpstream).toHaveBeenLastCalledWith(new URL('https://cdn.test/init.png'), expect.objectContaining({ headers: { range: 'bytes=0-3' } }));
  });

  test.each([{ uri: 'audio.aac', format: undefined, filename: 'segment.aac', contentType: 'audio/aac' }, { uri: 'caption.png', format: 'vtt' as const, filename: 'segment.vtt', contentType: 'text/vtt' }])('preserves native rendition format for $filename', async ({ uri, format, filename, contentType }) => {
    const playlist = `#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n${uri}\n#EXT-X-ENDLIST\n`;
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = input as URL;
      const response = new Response(url.pathname.endsWith('/root') ? playlist : 'rendition-media', { headers: { 'content-type': 'application/octet-stream' } });
      Object.defineProperty(response, 'url', { value: url.href });
      return response;
    });
    const result = await requestRelay(relay.createUrl(origin, { url: new URL('https://cdn.test/root'), resource: { kind: 'playlist', ...(format && { format }) } }), { method: 'GET' });
    const child = new URL(result.body.toString().split('\n').find(line => line && !line.startsWith('#')) as string);
    expect(child.pathname.endsWith(`/${filename}`)).toBe(true);
    const media = await requestRelay(child, { method: 'GET' });
    expect(media.headers['content-type']).toBe(contentType);
    expect(media.body.toString()).toBe('rendition-media');
  });

  test('continues an active media transfer beyond the response deadline', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'performance', 'hrtime'] });
    jest.spyOn(AbortSignal, 'timeout').mockImplementation((delay) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('Response deadline expired')), delay);
      return controller.signal;
    });
    let upstreamReady: (value: { body: ReadableStreamDefaultController<Uint8Array>; signal: AbortSignal }) => void;
    const ready = new Promise<{ body: ReadableStreamDefaultController<Uint8Array>; signal: AbortSignal }>((resolve) => {
      upstreamReady = resolve;
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const signal = options?.signal as AbortSignal;
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        upstreamReady({ body: controller, signal });
      } });
      const upstream = new Response(stream, { headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' } });
      Object.defineProperty(upstream, 'url', { value: target.href });
      return upstream;
    });
    const incoming = new Promise<IncomingMessage>((resolve, reject) => {
      const client = request(relayUrl, { method: 'GET' }, resolve);
      client.once('error', reject);
      client.end();
    });
    const { body, signal } = await ready;
    body.enqueue(Buffer.from('first'));
    const response = await incoming;
    const chunks: Buffer[] = [];
    const firstChunk = new Promise<void>((resolve) => {
      response.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        resolve();
      });
    });
    const completed = once(response, 'end');
    void completed.catch(() => undefined);
    await firstChunk;
    await jest.advanceTimersByTimeAsync(31000);
    expect(signal.aborted).toBe(false);
    body.enqueue(Buffer.from('second'));
    body.close();
    await completed;
    expect(Buffer.concat(chunks).toString()).toBe('firstsecond');
  });

  test('cancels an upstream media transfer when the client closes its response', async () => {
    let aborted: () => void;
    const cancelled = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, options) => {
      const signal = options?.signal as AbortSignal;
      const stream = new ReadableStream<Uint8Array>({ start(controller) {
        controller.enqueue(Buffer.from('first'));
        signal.addEventListener('abort', () => {
          controller.error(signal.reason);
          aborted();
        }, { once: true });
      } });
      const upstream = new Response(stream, { headers: { 'content-type': 'video/mp4' } });
      Object.defineProperty(upstream, 'url', { value: target.href });
      return upstream;
    });
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const client = request(relayUrl, { method: 'GET' }, resolve);
      client.once('error', reject);
      client.end();
    });
    await once(response, 'data');
    response.destroy();
    await cancelled;
  });
});
