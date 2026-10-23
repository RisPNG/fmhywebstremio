import type { ExtractionResponse, NormalizedStream, RequestServices, StreamCandidate } from '../core/models';
import { TransportFailure } from '../transport';
import { StreamSelector } from './stream-selector';

describe('source-fair stream validation', () => {
  test.each(['master', 'media'])('preserves different language renditions and backup URLs with matching HLS %s profiles', async (playlist) => {
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
      const body = request.expectedContent === 'binary' ? 'media' : playlist === 'master' && request.url.pathname.endsWith('/master.m3u8') ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,CODECS="avc1,mp4a"\n1080.m3u8' : '#EXTM3U\n#EXTINF:4,\nsegment.ts';
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: new TextEncoder().encode(body), text: () => body, json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const candidates = ([['a-french', 'French'], ['b-english', 'English'], ['c-english-backup', 'English']] as const).map(([path, language]): StreamCandidate => ({ url: new URL(`https://media.test/${path}/master.m3u8`), language, protocol: 'hls', sourceId: 'anicine', sourceExtractor: 'anicine', hostExtractor: 'vidbolt-player', discoveredAt: new Date(0) }));
    const result = await new StreamSelector(services).validate(candidates, { concurrency: 2 }, new AbortController().signal);
    expect(result.streams.map(stream => [stream.url.pathname, stream.language])).toEqual([['/a-french/master.m3u8', 'French'], ['/b-english/master.m3u8', 'English'], ['/c-english-backup/master.m3u8', 'English']]);
    expect(new Set(result.streams.map(stream => stream.structuralFingerprint)).size).toBe(1);
    expect(result.streams.every(stream => stream.validation === 'validated')).toBe(true);
  });

  test('deduplicates the same endpoint while preserving its different audio and subtitle renditions', () => {
    const selector = new StreamSelector({ request: jest.fn() } as unknown as RequestServices);
    const stream: NormalizedStream = { url: new URL('https://media.test/master.m3u8'), protocol: 'hls', validation: 'validated', sourceId: 'source', sourceExtractor: 'fixture', language: 'English', audioLanguages: ['en'], subtitles: [{ url: new URL('https://media.test/en.vtt'), language: 'en' }] };
    expect(selector.deduplicate([
      stream,
      { ...stream, url: new URL('https://media.test/master.m3u8#duplicate') },
      { ...stream, language: 'French' },
      { ...stream, audioLanguages: ['ja'] },
      { ...stream, subtitles: [{ url: new URL('https://media.test/fr.vtt'), language: 'fr' }] },
    ])).toEqual([stream, { ...stream, language: 'French' }, { ...stream, audioLanguages: ['ja'] }, { ...stream, subtitles: [{ url: new URL('https://media.test/fr.vtt'), language: 'fr' }] }]);
  });

  test('preserves the declared provider identity within its host and source', () => {
    const selector = new StreamSelector({ request: jest.fn() } as unknown as RequestServices);
    const stream: NormalizedStream = { url: new URL('https://media.test/first.m3u8'), protocol: 'hls', validation: 'validated', sourceId: 'source', sourceExtractor: 'fixture', hostExtractor: 'player-a', providerContentId: 'video-42', language: 'English' };
    const otherHost = { ...stream, hostExtractor: 'player-b' };
    const otherSource = { ...stream, sourceId: 'other-source' };
    const otherLanguage = { ...stream, language: 'French' };
    expect(selector.deduplicate([stream, { ...stream, url: new URL('https://media.test/second.m3u8') }, otherHost, otherSource, otherLanguage])).toEqual([stream, otherHost, otherSource, otherLanguage]);
  });

  test('keeps validated evidence over an earlier unverified copy of the same stream', () => {
    const selector = new StreamSelector({ request: jest.fn() } as unknown as RequestServices);
    const stream: NormalizedStream = { url: new URL('https://media.test/master.m3u8'), protocol: 'hls', validation: 'validated', sourceId: 'source', sourceExtractor: 'fixture', language: 'English' };
    const backup: NormalizedStream = { ...stream, url: new URL('https://backup.test/master.m3u8'), validation: 'unverified' };
    expect(selector.deduplicate([{ ...stream, validation: 'unverified' }, backup, stream])).toEqual([stream, backup]);
  });

  test('returns a validated identity once when its duplicate remains unverified after the validation goal', async () => {
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => ({ status: 200, headers: { 'content-type': 'video/mp4' }, finalUrl: request.url, redirectChain: [], body: new Uint8Array(), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } })) };
    const candidate: StreamCandidate = { url: new URL('https://media.test/video.mp4'), protocol: 'http', sourceId: 'source', sourceExtractor: 'fixture', language: 'English', discoveredAt: new Date(0) };
    const result = await new StreamSelector(services).validate([candidate, { ...candidate, url: new URL('https://media.test/video.mp4#duplicate') }], { concurrency: 1, goal: 'first-validated' }, new AbortController().signal);
    expect(result.streams).toMatchObject([{ validation: 'validated', language: 'English' }]);
    expect(result.streams).toHaveLength(1);
    expect(result.unverified).toHaveLength(1);
    expect(services.request).toHaveBeenCalledTimes(1);
  });

  test('deduplicates inferred Japanese HLS audio and its cancelled metadata-absent duplicate', async () => {
    const services: RequestServices = { request: jest.fn(async (request, signal): Promise<ExtractionResponse> => {
      if (request.url.hash === '#duplicate') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      const body = request.expectedContent === 'binary' ? 'media' : request.url.pathname === '/master.m3u8' ? '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="original",NAME="Japanese",LANGUAGE="ja",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="original"\nvideo.m3u8' : '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST';
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: new TextEncoder().encode(body), text: () => body, json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const candidate: StreamCandidate = { url: new URL('https://media.test/master.m3u8'), protocol: 'hls', sourceId: 'source', sourceExtractor: 'fixture', discoveredAt: new Date(0) };
    const result = await new StreamSelector(services).validate([candidate, { ...candidate, url: new URL('https://media.test/master.m3u8#duplicate') }], { concurrency: 2, goal: 'first-validated' }, new AbortController().signal);
    expect(result.streams).toMatchObject([{ validation: 'validated', language: 'ja', audioLanguages: ['ja'] }]);
    expect(result.streams).toHaveLength(1);
    expect(result.unverified).toHaveLength(1);
    expect(result.unverified[0]?.language).toBeUndefined();
    expect(result.failures).toEqual([]);
  });

  test.each(['validated', 'unverified'] as const)('preserves conflicting known renditions after enriching an initially unknown %s identity', (validation) => {
    const selector = new StreamSelector({ request: jest.fn() } as unknown as RequestServices);
    const unknown: NormalizedStream = { url: new URL('https://media.test/master.m3u8'), protocol: 'hls', validation: 'validated', sourceId: 'source', sourceExtractor: 'fixture' };
    const english = { ...unknown, validation, language: 'English', audioLanguages: ['en'], subtitles: [{ url: new URL('https://media.test/en.vtt'), language: 'en' }] };
    const french = { ...unknown, validation, language: 'French', audioLanguages: ['fr'], subtitles: [{ url: new URL('https://media.test/fr.vtt'), language: 'fr' }] };
    const result = selector.deduplicate([unknown, english, french, { ...unknown, validation: 'unverified' }]);
    expect(result).toEqual([{ ...english, validation: 'validated' }, french]);
    expect(unknown.language).toBeUndefined();
    expect(unknown.audioLanguages).toBeUndefined();
    expect(unknown.subtitles).toBeUndefined();
  });

  test('validates CineGo despite six forbidden advertised variants and three AniCine candidates', async () => {
    const candidates: StreamCandidate[] = [
      ...['cinemaos', 'movies-to-watch'].flatMap(sourceId => [1080, 720, 480].map(height => ({ url: new URL(`https://${sourceId}.test/${height}.mp4`), protocol: 'http' as const, sourceId, sourceExtractor: 'fixture', declaredResolution: { width: height * 16 / 9, height }, discoveredAt: new Date(0) }))),
      ...['one', 'two', 'three'].map(id => ({ url: new URL(`https://anicine.test/${id}.mp4`), protocol: 'http' as const, sourceId: 'anicine', sourceExtractor: 'fixture', discoveredAt: new Date(0) })),
      { url: new URL('https://cinego.test/episode.mp4'), protocol: 'http', sourceId: 'cinego', sourceExtractor: 'fixture', discoveredAt: new Date(0) },
    ];
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
      if (request.url.hostname === 'cinemaos.test' || request.url.hostname === 'movies-to-watch.test') throw new TransportFailure({ code: 'HTTP_FORBIDDEN', message: 'Unavailable media', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: new Uint8Array(), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const result = await new StreamSelector(services).validate(candidates, { concurrency: 8 }, new AbortController().signal);
    expect(result.streams.map(stream => stream.sourceId)).toEqual(['anicine', 'anicine', 'anicine', 'cinego']);
    expect(result.streams.every(stream => stream.validation === 'validated')).toBe(true);
    expect(result.failures).toHaveLength(6);
    expect(result.failures.every(failure => failure.code === 'HTTP_FORBIDDEN')).toBe(true);
    expect(services.request).toHaveBeenCalledTimes(10);
    expect((services.request as jest.Mock).mock.calls.slice(0, 4).map(([request]) => request.url.hostname)).toEqual(['cinemaos.test', 'movies-to-watch.test', 'anicine.test', 'cinego.test']);
  });

  test.each([undefined, 'all'] as const)('returns every working stream with validation goal %s while bounding active checks', async (goal) => {
    let active = 0;
    let peak = 0;
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve => setImmediate(resolve));
      active--;
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: new Uint8Array(), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const candidates = Array.from({ length: 12 }, (_value, index): StreamCandidate => ({ url: new URL(`https://source.test/${index}.mp4`), protocol: 'http', sourceId: 'source', sourceExtractor: 'fixture', discoveredAt: new Date(0) }));
    const result = await new StreamSelector(services).validate(candidates, { concurrency: 2, ...(goal && { goal }) }, new AbortController().signal);
    expect(result.streams).toHaveLength(12);
    expect(result.unverified).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(peak).toBe(2);
    expect(services.request).toHaveBeenCalledTimes(12);
  });

  test('continues after a failed candidate until the first validated stream satisfies the goal', async () => {
    const controller = new AbortController();
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
      if (request.url.pathname === '/0-failed.mp4') throw new TransportFailure({ code: 'HTTP_FORBIDDEN', message: 'Unavailable media', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      return { status: 200, headers: { 'content-type': 'video/mp4' }, finalUrl: request.url, redirectChain: [], body: new Uint8Array(), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const candidates = ['0-failed', '1-working', '2-unchecked'].map((name): StreamCandidate => ({ url: new URL(`https://source.test/${name}.mp4`), protocol: 'http', sourceId: 'source', sourceExtractor: 'fixture', discoveredAt: new Date(0) }));
    const result = await new StreamSelector(services).validate(candidates, { concurrency: 1, goal: 'first-validated' }, controller.signal);
    expect(result.streams.filter(stream => stream.validation === 'validated').map(stream => stream.url.pathname)).toEqual(['/1-working.mp4']);
    expect(result.failures).toMatchObject([{ code: 'HTTP_FORBIDDEN' }]);
    expect(result.unverified.map(stream => stream.url.pathname)).toEqual(['/2-unchecked.mp4']);
    expect(services.request).toHaveBeenCalledTimes(2);
    expect(controller.signal.aborted).toBe(false);
  });

  test('cancels pending checks and skips queued checks after the first validated stream', async () => {
    const controller = new AbortController();
    let pendingCancelled = false;
    const services: RequestServices = { request: jest.fn(async (request, signal): Promise<ExtractionResponse> => {
      if (request.url.pathname === '/0-pending.mp4') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        pendingCancelled = true;
        reject(new TransportFailure({ code: 'TIMEOUT', message: 'Cancelled', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } }));
      }, { once: true }));
      await new Promise<void>(resolve => setImmediate(resolve));
      return { status: 200, headers: { 'content-type': 'video/mp4' }, finalUrl: request.url, redirectChain: [], body: new Uint8Array(), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const candidates = ['0-pending', '1-working', '2-unchecked'].map((name): StreamCandidate => ({ url: new URL(`https://source.test/${name}.mp4`), protocol: 'http', audioLanguages: ['eng'], sourceId: 'source', sourceExtractor: 'fixture', discoveredAt: new Date(0) }));
    const result = await new StreamSelector(services).validate(candidates, { concurrency: 2, goal: 'first-validated' }, controller.signal);
    expect(result.streams.filter(stream => stream.validation === 'validated').map(stream => stream.url.pathname)).toEqual(['/1-working.mp4']);
    expect(result.failures).toEqual([]);
    expect(result.unverified.map(stream => stream.url.pathname)).toEqual(['/0-pending.mp4', '/2-unchecked.mp4']);
    expect(result.streams).toMatchObject([{ validation: 'validated', audioLanguages: ['eng'] }, { validation: 'unverified', audioLanguages: ['eng'] }, { validation: 'unverified', audioLanguages: ['eng'] }]);
    expect(pendingCancelled).toBe(true);
    expect(services.request).toHaveBeenCalledTimes(2);
    expect(controller.signal.aborted).toBe(false);
  });

  test('does not start queued network checks after cancellation or mark them validated', async () => {
    const controller = new AbortController();
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
      controller.abort();
      throw new TransportFailure({ code: 'TIMEOUT', message: 'Cancelled', targetHost: request.url.hostname, observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
    }) };
    const candidates = Array.from({ length: 12 }, (_value, index): StreamCandidate => ({ url: new URL(`https://source.test/${index}.mp4`), protocol: 'http', sourceId: 'source', sourceExtractor: 'fixture', discoveredAt: new Date(0) }));
    const result = await new StreamSelector(services).validate(candidates, { concurrency: 1 }, controller.signal);
    expect(services.request).toHaveBeenCalledTimes(1);
    expect(result.failures).toMatchObject([{ code: 'TIMEOUT' }]);
    expect(result.unverified).toHaveLength(11);
    expect(result.streams.every(stream => stream.validation === 'unverified')).toBe(true);
  });
});
