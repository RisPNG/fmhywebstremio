import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HlsRelay } from '../../addon/stremio-adapter/hls-relay';
import type { ExtractionRequest, ExtractionResponse, RequestServices, SourceRecord } from '../../engine/core/models';
import { defaultFamilyHealthCorpora, FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import { TransportFailure } from '../../engine/transport/transport-director';
import { KkPhimFamily } from './kkphim-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/kkphim/${name}`), 'utf8');
const response = (url: URL, body: string, contentType = 'application/json'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('KKPhim native TMDB catalog and HLS episodes', () => {
  const source: SourceRecord = { id: 'kkphim:kkphim.com', canonicalDomain: 'kkphim.com', aliases: [], fmhy: { name: 'kkphim', section: '▷ Streaming / Phát trực tuyến', tags: [], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'kkphim', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };
  const episode = { canonicalId: 'tmdb:310817', type: 'episode' as const, tmdbId: 310817, title: 'Kisah Bawah Tanah', season: 1, episode: 1 };

  test('recognizes its actual brand, documented API, catalog routes, and client asset together', () => {
    const html = fixture('home.html');
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://kkphim.com/'), status: 200, headers: {}, htmlSample: html, assetPaths: ['/js/main.js'], scriptSignatures: [], routeHints: ['/api-document'] };
    expect(new KkPhimFamily().classify(source, snapshot)).toMatchObject({ familyId: 'kkphim', confidence: 1 });
    expect(new KkPhimFamily().classify(source, { ...snapshot, htmlSample: html.replaceAll('/api-document', '/unrelated') })).toBeNull();
  });

  test.each([1, 2, 26])('selects only requested native episode %s using verified IDs and season', async (number) => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, fixture('kisah-bawah-tanah.json'))) };
    const result = await new KkPhimFamily().discoverMedia({ ...episode, episode: number, title: 'A different localized display title' }, source, services, new AbortController().signal);
    expect(result).toMatchObject({ type: 'streams', streams: [{ url: new URL(`https://media.test/kbt/0/${number}/index.m3u8`), protocol: 'hls', delivery: 'relayed', label: expect.stringContaining(`S01E${String(number).padStart(2, '0')}`), sourceId: source.id, sourceExtractor: 'kkphim', hostExtractor: 'phimapi' }] });
    if (result.type === 'streams') {
      expect(result.streams).toHaveLength(1);
      expect(result.streams[0]?.language).toBeUndefined();
    }
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://phimapi.com/tmdb/tv/310817') }), expect.any(AbortSignal));
  });

  test('keeps every declared movie server without presenting subtitle labels as audio languages', async () => {
    const services: RequestServices = { request: async request => response(request.url, fixture('lightyear.json')) };
    const result = await new KkPhimFamily().discoverMedia({ canonicalId: 'tmdb:718789', type: 'movie', tmdbId: 718789, title: 'Lightyear' }, source, services, new AbortController().signal);
    expect(result).toMatchObject({ type: 'streams', streams: [{ label: expect.stringContaining('Vietsub'), url: new URL('https://media.test/lightyear/0/1/index.m3u8') }, { label: expect.stringContaining('Lồng Tiếng'), url: new URL('https://media.test/lightyear/1/1/index.m3u8') }] });
    if (result.type === 'streams') {
      expect(result.streams.map(stream => stream.language)).toEqual([undefined, undefined]);
      expect(new Set(result.streams.map(stream => stream.url.href)).size).toBe(2);
      expect(result.streams.every(stream => stream.providerContentId === undefined)).toBe(true);
    }
  });

  test('retains distinct playable URLs when a native server repeats its descriptive filename', async () => {
    const data = JSON.parse(fixture('lightyear.json')) as { episodes: { server_name: string; server_data: { name: string; filename: string; link_m3u8: string }[] }[] };
    const server = data.episodes[0];
    const first = server?.server_data[0];
    if (!server || !first) throw new Error('Expected native movie server');
    data.episodes = [{ ...server, server_data: [first, { ...first, link_m3u8: 'https://backup.test/movie/index.m3u8' }] }];
    const services: RequestServices = { request: async request => request.url.hostname === 'phimapi.com'
      ? response(request.url, JSON.stringify(data))
      : response(request.url, request.expectedContent === 'manifest' ? '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n' : 'G actual media bytes', request.expectedContent === 'manifest' ? 'application/vnd.apple.mpegurl' : 'video/mp2t') };
    const discovered = await new KkPhimFamily().discoverMedia({ canonicalId: 'tmdb:718789', type: 'movie', tmdbId: 718789, title: 'Lightyear' }, source, services, new AbortController().signal);
    if (discovered.type !== 'streams') throw new Error('Expected native movie candidates');
    const selected = await new StreamSelector(services).validate(discovered.streams, { concurrency: 2 }, new AbortController().signal);
    expect(selected.streams).toHaveLength(2);
    expect(selected.streams.every(stream => stream.validation === 'validated')).toBe(true);
  });

  test.each(['https://player.phimapi.com', 'https://configured-player.test'])('preserves the native embed request context through HLS media inspection and relay signing: %s', async (origin) => {
    const body = fixture('kisah-bawah-tanah.json').replaceAll('https://player.phimapi.com', origin);
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname === 'phimapi.com') return response(request.url, body);
      if (request.url.pathname.endsWith('/index.m3u8')) return response(request.url, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1920x1080\n3500kb/hls/media.m3u8\n', 'application/vnd.apple.mpegurl');
      if (request.url.pathname.endsWith('/media.m3u8')) return response(request.url, '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nfirst.ts\n#EXTINF:6,\nmiddle.ts\n#EXTINF:6,\nlast.ts\n#EXT-X-ENDLIST\n', 'application/vnd.apple.mpegurl');
      return response(request.url, 'G actual media bytes', 'video/mp2t');
    }) };
    const discovered = await new KkPhimFamily().discoverMedia(episode, source, services, new AbortController().signal);
    if (discovered.type !== 'streams') throw new Error('Expected native episode stream');
    const selected = await new StreamSelector(services).validate(discovered.streams, { concurrency: 2 }, new AbortController().signal);
    const stream = selected.streams[0];
    if (!stream?.headers) throw new Error('Expected validated episode stream with native context');
    const headers = { origin, referer: `${origin}/` };
    expect(stream).toMatchObject({ validation: 'validated', headers });
    const mediaRequests = (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request).filter(request => request.url.hostname === 'media.test');
    expect(mediaRequests).toHaveLength(5);
    expect(mediaRequests.every(request => JSON.stringify(request.headers) === JSON.stringify(headers))).toBe(true);
    expect(mediaRequests.map(request => request.url.pathname)).toEqual(expect.arrayContaining(['/kbt/0/1/3500kb/hls/media.m3u8', '/kbt/0/1/3500kb/hls/first.ts', '/kbt/0/1/3500kb/hls/middle.ts', '/kbt/0/1/3500kb/hls/last.ts']));
    const relay = new HlsRelay();
    const signed = relay.createUrl(new URL('https://addon.test/'), { url: stream.url, headers: stream.headers, resource: { kind: 'playlist' } });
    const parts = signed.pathname.split('/');
    expect(relay.resolveTarget(parts.at(-3) as string, parts.at(-2) as string)).toMatchObject({ url: stream.url, headers, resource: { kind: 'playlist' } });
  });

  test.each([
    { id: '256695', type: 'tv', season: 1 },
    { id: '310817', type: 'movie', season: null },
    { id: '310817', type: 'tv', season: 5 },
  ])('rejects nearby IDs, media types, and a native record for another season: %j', async (tmdb) => {
    const data = JSON.parse(fixture('kisah-bawah-tanah.json')) as { movie: { tmdb: unknown } };
    data.movie.tmdb = tmdb;
    const services: RequestServices = { request: async request => response(request.url, JSON.stringify(data)) };
    await expect(new KkPhimFamily().discoverMedia(episode, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
  });

  test('does not substitute episode one for an absent episode or another season', async () => {
    const services: RequestServices = { request: async request => response(request.url, fixture('kisah-bawah-tanah.json')) };
    await expect(new KkPhimFamily().discoverMedia({ ...episode, episode: 27 }, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'empty' });
    await expect(new KkPhimFamily().discoverMedia({ ...episode, season: 2 }, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
  });

  test('does not serve the native latest The Boys season five record for a season two request', async () => {
    const services: RequestServices = { request: async request => response(request.url, fixture('the-boys-season5.json')) };
    await expect(new KkPhimFamily().discoverMedia({ canonicalId: 'tmdb:76479', type: 'episode', tmdbId: 76479, title: 'The Boys', season: 2, episode: 1 }, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    await expect(new KkPhimFamily().discoverMedia({ canonicalId: 'tmdb:76479', type: 'episode', tmdbId: 76479, title: 'The Boys', season: 5, episode: 1 }, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams' });
  });

  test('treats a native not-found response as absence and reports changed response shapes', async () => {
    const services: RequestServices = { request: async () => {
      throw new TransportFailure({ code: 'HTTP_NOT_FOUND', message: 'Not found', stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
    } };
    await expect(new KkPhimFamily().discoverMedia(episode, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    await expect(new KkPhimFamily().discoverMedia(episode, source, { request: async request => response(request.url, fixture('absent.json')) }, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    await expect(new KkPhimFamily().discoverMedia(episode, source, { request: async request => response(request.url, '{"status":true,"movie":{}}') }, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED' } });
  });

  test('validates its real movie, three-episode, and absent health corpus before making the source eligible', async () => {
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname === 'phimapi.com') return response(request.url, fixture(request.url.pathname.endsWith('/310817') ? 'kisah-bawah-tanah.json' : request.url.pathname.endsWith('/718789') ? 'lightyear.json' : 'absent.json'));
      if (request.url.pathname.endsWith('.m3u8')) return response(request.url, '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nfirst.ts\n#EXTINF:6,\nmiddle.ts\n#EXTINF:6,\nlast.ts\n#EXT-X-ENDLIST\n', 'application/vnd.apple.mpegurl');
      return response(request.url, 'G media bytes', 'video/mp2t');
    }) };
    const registry = new SourceRegistry();
    registry.set(source);
    const corpus = defaultFamilyHealthCorpora.get('kkphim');
    if (!corpus) throw new Error('Expected KKPhim health corpus');
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, new KkPhimFamily(), corpus, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, staleCases: [], anomalies: [] });
    expect(outcome.cases.filter(test => test.expected === 'discoverable').every(test => test.stages.validation)).toBe(true);
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect((services.request as jest.Mock).mock.calls.filter(([request]: [ExtractionRequest]) => request.expectedContent === 'binary').length).toBeGreaterThanOrEqual(12);
  });
});
