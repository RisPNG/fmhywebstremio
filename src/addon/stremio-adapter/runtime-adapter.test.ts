import { RuntimeStreamEngine, type MediaIdentity, type NormalizedStream, type RequestServices, type SourceRecord, type StreamEngine } from '../../engine/core';
import { DirectMediaInspector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { deploymentSourceRegistry } from '../../engine/registry/deployment-registry.generated';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import type { Context } from '../../types';
import { HlsRelay } from './hls-relay';
import { normalizedStreamToStremio, RuntimeStremioAdapter } from './runtime-adapter';

describe('RuntimeStremioAdapter', () => {
  const media: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const stream: NormalizedStream = { url: new URL('https://media.test/movie.mp4'), protocol: 'http', validation: 'validated', sourceId: 'source', sourceExtractor: 'family' };

  test.each([
    ['bilibili:bilibili.com', 'BiliBili', 'bilibili.tv', 'bilibili-ugc'],
    ['cinefork:cinefork.net', 'Cinefork', 'cinefork.net', 'vidfast-api'],
    ['cineruv:cineruv.website', 'cineruv', 'cineruv.website', undefined],
    ['greybox:greyboxtv.pages.dev', 'GreyBox', 'greyboxtv.pages.dev', 'vidora-player'],
    ['milkbox:milkbox.zapto.org', 'MilkBox', 'milkbox.zapto.org', 'vidspark-api'],
    ['movienerds:movienerds.site', 'MovieNerds', 'movienerds.site', undefined],
    ['pressplay:pressplayx.to', 'PressPlay', 'pressplayx.to', 'vidspark-api'],
  ])('formats the two label lines and description for deployed source %s', (id, brand, domain, hostExtractor) => {
    const source = deploymentSourceRegistry.records.find(record => record.id === id);
    expect(source).toBeDefined();
    expect(normalizedStreamToStremio({ ...stream, sourceId: id as string, ...(hostExtractor && { hostExtractor }), language: 'eng', resolution: { width: 1920, height: 1080 } }, source)).toMatchObject({ name: `${brand} 1080p\nEnglish`, title: `https://${domain}/ . ${hostExtractor ?? 'N/A'}` });
  });

  test('keeps every missing component as N/A without omitting its position', () => {
    expect(normalizedStreamToStremio(stream)).toMatchObject({ name: 'N/A N/A\nN/A', title: 'N/A . N/A' });
    const source: SourceRecord = { id: 'source:old.test', canonicalDomain: 'active.test', aliases: ['old.test'], fmhy: { name: '  Source\n Brand  ', firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'supported' };
    expect(normalizedStreamToStremio({ ...stream, language: 'und', hostExtractor: 'cinepro-api' }, source)).toMatchObject({ name: 'Source Brand N/A\nN/A', title: 'https://active.test/ . cinepro-api' });
    expect(normalizedStreamToStremio({ ...stream, language: 'es', resolution: { width: 1280, height: 720 }, hostExtractor: ' ' }, { ...source, fmhy: { ...source.fmhy, name: ' ' } })).toMatchObject({ name: 'N/A 720p\nSpanish', title: 'https://active.test/ . N/A' });
  });

  test.each([undefined, 'auto', 'und', '  '])('uses declared audio tracks when stream language is %s', (language) => {
    const formatted = normalizedStreamToStremio({ ...stream, ...(language && { language }), audioLanguages: ['eng', 'spa', 'eng', 'und'] });
    expect(formatted).toMatchObject({ name: 'N/A N/A\nEnglish, Spanish', title: 'N/A . N/A' });
  });

  test('keeps the raw player identifier in the description', () => {
    expect(normalizedStreamToStremio({ ...stream, hostExtractor: 'unknown-player' }).title).toBe('N/A . unknown-player');
  });

  test('carries active source metadata through the real engine', async () => {
    const sources = new SourceRegistry();
    const source: SourceRecord = { id: 'source:old.test', canonicalDomain: 'active.test', aliases: ['old.test'], fmhy: { name: 'Source Brand', firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'fixture', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'supported' };
    sources.set(source);
    sources.recordHealth({ sourceId: source.id, lastOutcome: 'healthy', recentSuccesses: 1, recentFailures: 0 });
    const resolver = { resolve: jest.fn(async () => ({ ...media, title: 'Canonical Title' })) };
    const services: RequestServices = { request: jest.fn(async request => ({ status: 200, headers: { 'content-type': 'video/mp4' }, finalUrl: request.url, redirectChain: [], body: new Uint8Array(), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } })) };
    const family = { id: 'fixture', classify: () => null, discoverMedia: jest.fn(async () => ({ type: 'streams' as const, streams: [{ url: stream.url, protocol: 'http' as const, sourceId: source.id, sourceExtractor: 'fixture', hostExtractor: 'vidspark-api', language: 'es', declaredResolution: { width: 1280, height: 720 }, discoveredAt: new Date(0) }] })) };
    const engine = new RuntimeStreamEngine(resolver, sources, new Map([['fixture', family]]), new ExtractionResolver(new StaticExtractorLookup([]), services), services);
    const result = await new RuntimeStremioAdapter(engine, sources).findStreams({ hostUrl: new URL('https://addon.test/'), id: 'fixture', config: {} }, 'movie', 'tt1375666');
    expect(result.streams).toHaveLength(1);
    expect(result.streams[0]).toMatchObject({ name: 'Source Brand 720p\nSpanish', title: 'https://active.test/ . vidspark-api', url: stream.url.href });
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(family.discoverMedia).toHaveBeenCalledWith(expect.objectContaining({ title: 'Canonical Title' }), source, services, expect.any(AbortSignal));
    expect(services.request).toHaveBeenCalledTimes(1);
  });

  test('relays only streams from IP-bound host architectures', async () => {
    const target = new URL('https://media.example/movie/master.m3u8?token=fixture');
    const engine: StreamEngine = { findStreams: jest.fn(async () => ({ streams: [{ url: target, protocol: 'hls' as const, validation: 'validated' as const, resolution: { width: 1920, height: 800 }, delivery: 'relayed' as const, sourceId: 'cinego:cinego.test', sourceExtractor: 'cinego', hostExtractor: 'vidsrcme-api' }], failures: [], unverified: [], deadline: { budgetMs: 1, elapsedMs: 1, exceeded: false, sourcesAttempted: 1, sourcesCompleted: 1, sourcesCancelled: 0 } })) };
    const sources = new SourceRegistry();
    sources.set({ id: 'cinego:cinego.test', canonicalDomain: 'cinego.test', aliases: [], fmhy: { name: 'CineGo', firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'supported' });
    const relay = new HlsRelay();
    const context: Context = { hostUrl: new URL('https://addon.example/'), id: 'fixture', config: {} };
    const result = await new RuntimeStremioAdapter(engine, sources, relay).findStreams(context, 'movie', 'tt1375666');
    const url = new URL(result.streams[0]?.url as string);
    const [, signature, payload] = url.pathname.match(/^\/hls-relay\/([^/]+)\/([^/]+)\/playlist\.m3u8$/) ?? [];
    expect(url.origin).toBe(context.hostUrl.origin);
    expect(relay.resolveTarget(signature as string, payload as string)).toEqual({ url: target, resource: { kind: 'playlist' } });
    expect(result.streams[0]).toMatchObject({ name: 'CineGo 800p\nN/A', title: 'https://cinego.test/ . vidsrcme-api' });
  });

  test.each(['hls', 'dash', 'http'] as const)('signs root resource semantics from %s rather than its opaque URL', async (protocol) => {
    const target = new URL('https://media.test/opaque-image.png');
    const engine: StreamEngine = { findStreams: jest.fn(async () => ({ streams: [{ url: target, protocol, validation: 'validated' as const, delivery: 'relayed' as const, headers: { referer: 'https://player.test/' }, sourceId: 'source', sourceExtractor: 'source' }], failures: [], unverified: [], deadline: { budgetMs: 1, elapsedMs: 1, exceeded: false, sourcesAttempted: 1, sourcesCompleted: 1, sourcesCancelled: 0 } })) };
    const relay = new HlsRelay();
    const result = await new RuntimeStremioAdapter(engine, new SourceRegistry(), relay).findStreams({ hostUrl: new URL('https://addon.test/'), id: 'fixture', config: {} }, 'movie', 'tmdb:27205');
    const url = new URL(result.streams[0]?.url as string);
    const parts = url.pathname.split('/');
    expect(parts.at(-1)).toBe(protocol === 'hls' ? 'playlist.m3u8' : protocol === 'dash' ? 'manifest.mpd' : 'media.bin');
    expect(relay.resolveTarget(parts.at(-3) as string, parts.at(-2) as string)).toEqual({ url: target, headers: { referer: 'https://player.test/' }, resource: protocol === 'hls' ? { kind: 'playlist' } : protocol === 'dash' ? { kind: 'file', format: 'dash' } : { kind: 'file' } });
  });
});

test('preserves external subtitles through protocol validation and Stremio serialization', async () => {
  const stream = await new DirectMediaInspector().inspect({ url: new URL('https://media.test/video.mp4'), protocol: 'http', sourceId: 'anicine:catalog.test', sourceExtractor: 'anicine', discoveredAt: new Date(0), subtitles: [{ url: new URL('https://subtitles.test/english.vtt'), label: 'English', format: 'vtt' }] }, { request: jest.fn(async () => ({ status: 200, headers: { 'content-type': 'video/mp4' }, finalUrl: new URL('https://media.test/video.mp4'), redirectChain: [], body: new Uint8Array([1]), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } })) }, new AbortController().signal);
  expect(normalizedStreamToStremio(stream).subtitles).toEqual([{ id: 'https://subtitles.test/english.vtt', url: 'https://subtitles.test/english.vtt', lang: 'English' }]);
});
