import type { ExtractionResponse, RequestServices } from '../core/models';
import { TransportFailure } from '../transport';
import { StreamSelector } from './stream-selector';

test.each(['application/vnd.apple.mpegurl; charset=utf-8', 'audio/x-mpegurl'])('inspects extensionless HLS media declared as %s before publishing it', async (contentType) => {
  const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
    const body = request.url.pathname === '/play' ? '#EXTM3U\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST' : 'media bytes';
    return { status: 200, headers: { 'content-type': request.url.pathname === '/play' ? contentType : 'video/mp2t' }, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
  }) };
  const result = await new StreamSelector(services).validate([{ url: new URL('https://cdn.test/play'), protocol: 'http', delivery: 'relayed', headers: { referer: 'https://player.test/' }, sourceId: 'source', sourceExtractor: 'family', discoveredAt: new Date(0) }], { concurrency: 1 }, new AbortController().signal);
  expect(result).toMatchObject({ streams: [{ protocol: 'hls', validation: 'validated', delivery: 'relayed', headers: { referer: 'https://player.test/' } }], failures: [] });
  expect((services.request as jest.Mock).mock.calls.map(([request]) => [request.method ?? 'GET', request.url.pathname, request.headers])).toEqual([
    ['HEAD', '/play', { referer: 'https://player.test/' }],
    ['GET', '/play', { referer: 'https://player.test/' }],
    ['GET', '/segment.ts', { referer: 'https://player.test/' }],
  ]);
});

test('rejects an extensionless HLS stream whose media fails despite a successful HEAD response', async () => {
  const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
    if (request.url.pathname === '/segment.ts') throw new TransportFailure({ code: 'HTTP_FORBIDDEN', message: 'Media unavailable', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
    const body = '#EXTM3U\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST';
    return { status: 200, headers: { 'content-type': 'application/vnd.apple.mpegurl' }, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
  }) };
  const result = await new StreamSelector(services).validate([{ url: new URL('https://cdn.test/play'), protocol: 'http', sourceId: 'source', sourceExtractor: 'family', discoveredAt: new Date(0) }], { concurrency: 1 }, new AbortController().signal);
  expect(result).toMatchObject({ streams: [], failures: [{ code: 'HTTP_FORBIDDEN', stage: 'stage:protocol' }] });
});

test('inspects extensionless DASH manifests using their response media type', async () => {
  const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
    const body = '<MPD><Period><AdaptationSet><Representation width="1920" height="1080" bandwidth="3000000" /></AdaptationSet></Period></MPD>';
    return { status: 200, headers: { 'content-type': 'application/dash+xml' }, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
  }) };
  const result = await new StreamSelector(services).validate([{ url: new URL('https://cdn.test/play'), protocol: 'http', sourceId: 'source', sourceExtractor: 'family', discoveredAt: new Date(0) }], { concurrency: 1 }, new AbortController().signal);
  expect(result).toMatchObject({ streams: [{ protocol: 'dash', validation: 'validated', resolution: { width: 1920, height: 1080 } }], failures: [] });
  expect((services.request as jest.Mock).mock.calls.map(([request]) => request.method ?? 'GET')).toEqual(['HEAD', 'GET']);
});

test('validates a responsive HLS stream before the query deadline despite media request latency', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 9000);
  const services: RequestServices = { request: jest.fn(async (request, signal): Promise<ExtractionResponse> => {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new TransportFailure({ code: 'TIMEOUT', message: 'Query deadline exceeded', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } }));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, request.expectedContent === 'binary' ? 4000 : 2000);
      signal.addEventListener('abort', onAbort, { once: true });
    });
    const body = request.url.pathname === '/master.m3u8'
      ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080\nmedia.m3u8'
      : '#EXTM3U\n#EXTINF:6,\nfirst.ts\n#EXTINF:6,\nmiddle.ts\n#EXTINF:6,\nlast.ts\n#EXT-X-ENDLIST';
    return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
  }) };
  try {
    const checking = new StreamSelector(services).validate([{ url: new URL('https://cdn.test/master.m3u8'), protocol: 'hls', sourceId: 'source', sourceExtractor: 'family', discoveredAt: new Date(0) }], { concurrency: 1 }, controller.signal);
    await jest.advanceTimersByTimeAsync(9000);
    expect(await checking).toMatchObject({ streams: [{ validation: 'validated', resolution: { width: 1920, height: 1080 } }], failures: [], unverified: [] });
    expect((services.request as jest.Mock).mock.calls.map(([request]) => request.url.pathname)).toEqual(['/master.m3u8', '/media.m3u8', '/first.ts', '/middle.ts', '/last.ts']);
  } finally {
    clearTimeout(deadline);
    jest.useRealTimers();
  }
});

test.each(['/key.bin', '/init.mp4', '/middle.ts', 'http://'])('waits for every HLS resource check before reporting a failure at %s', async (failedPath) => {
  jest.useFakeTimers();
  let active = 0;
  let settled = false;
  const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
    if (request.expectedContent === 'binary') {
      active++;
      await new Promise<void>(resolve => setTimeout(resolve, request.url.pathname === failedPath ? 1 : 50));
      active--;
      if (request.url.pathname === failedPath) throw new TransportFailure({ code: 'HTTP_FORBIDDEN', message: 'Unavailable HLS resource', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
    }
    const body = `#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXT-X-MAP:URI="${failedPath === 'http://' ? failedPath : 'init.mp4'}"\n#EXTINF:6,\nfirst.ts\n#EXTINF:6,\nmiddle.ts\n#EXTINF:6,\nlast.ts\n#EXT-X-ENDLIST`;
    return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
  }) };
  try {
    const checking = new StreamSelector(services).validate([{ url: new URL('https://cdn.test/media.m3u8'), protocol: 'hls', sourceId: 'source', sourceExtractor: 'family', discoveredAt: new Date(0) }], { concurrency: 1 }, new AbortController().signal).then((result) => {
      settled = true;
      return result;
    });
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);
    expect(active).toBe(4);
    await jest.advanceTimersByTimeAsync(50);
    expect(await checking).toMatchObject({ streams: [], failures: [{ code: failedPath === 'http://' ? 'MANIFEST_FETCH_FAILED' : 'HTTP_FORBIDDEN', stage: 'stage:protocol' }] });
    expect(active).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
