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
  let relayUrl: URL;
  const target = new URL('https://media.test/movie.mp4?token=fixture');

  beforeEach(async () => {
    const relay = new HlsRelay();
    const app = express();
    app.use(new HlsRelayController(relay).router);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    relayUrl = relay.createUrl(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`), target, { referer: 'https://player.test/' });
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
