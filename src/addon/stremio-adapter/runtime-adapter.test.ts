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
    ['67movies:67movies.st', '67Movies', '67movies.st', 'cinezo-player', 'Cinezo'],
    ['anicine:anicine.sbs', 'AniCine', 'anicine.sbs', 'xpass-player', 'Xpass'],
    ['arrowtv:arrowtv.net', 'ArrowTV', 'arrowtv.net', 'vidlove-api', 'Vidlove'],
    ['bilibili:bilibili.com', 'BiliBili', 'bilibili.tv', 'bilibili-ugc', 'BiliBili'],
    ['cineruv:cineruv.website', 'cineruv', 'cineruv.website', undefined, 'N/A'],
    ['milkbox:milkbox.zapto.org', 'MilkBox', 'milkbox.zapto.org', 'vidspark-api', 'VidSpark'],
    ['movienerds:movienerds.site', 'MovieNerds', 'movienerds.site', undefined, 'N/A'],
    ['pressplay:pressplayx.to', 'PressPlay', 'pressplayx.to', 'vidspark-api', 'VidSpark'],
  ])('formats all three lines for deployed source %s', (id, brand, domain, hostExtractor, player) => {
    const source = deploymentSourceRegistry.records.find(record => record.id === id);
    expect(source).toBeDefined();
    expect(normalizedStreamToStremio({ ...stream, sourceId: id as string, ...(hostExtractor && { hostExtractor }), language: 'eng', resolution: { width: 1920, height: 1080 } }, media, source)).toMatchObject({ name: brand, title: `${brand} Inception\nEnglish 1080p\nhttps://${domain}/ ${player}` });
  });

  test('keeps every missing component as N/A without substituting technical identifiers', () => {
    expect(normalizedStreamToStremio({ ...stream, hostExtractor: 'unknown-player' })).toMatchObject({ name: 'N/A', title: 'N/A N/A\nN/A N/A\nN/A N/A' });
    const source: SourceRecord = { id: 'source:old.test', canonicalDomain: 'active.test', aliases: ['old.test'], fmhy: { name: '  Source\n Brand  ', firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'supported' };
    expect(normalizedStreamToStremio({ ...stream, language: 'und', hostExtractor: 'cinepro-api' }, { ...media, title: ' ' }, source)).toMatchObject({ name: 'Source Brand', title: 'Source Brand N/A\nN/A N/A\nhttps://active.test/ CinePro' });
    expect(normalizedStreamToStremio({ ...stream, language: 'es', resolution: { width: 1280, height: 720 } }, { ...media, title: '  A\n Movie  ' }, { ...source, fmhy: { ...source.fmhy, name: ' ' } }).title).toBe('N/A A Movie\nSpanish 720p\nhttps://active.test/ N/A');
  });

  test.each([undefined, 'auto', 'und', '  '])('uses declared audio tracks when stream language is %s', (language) => {
    const formatted = normalizedStreamToStremio({ ...stream, ...(language && { language }), audioLanguages: ['eng', 'spa', 'eng', 'und'] }, media);
    expect(formatted.title).toBe('N/A Inception\nEnglish, Spanish N/A\nN/A N/A');
  });

  test('uses the installed provider library names for its embedded players', () => {
    expect(normalizedStreamToStremio({ ...stream, hostExtractor: 'filemoon' }, media).title).toBe('N/A Inception\nN/A N/A\nN/A Filemoon');
  });

  test('carries resolved media and active source metadata through the real engine', async () => {
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
    expect(result.streams[0]).toMatchObject({ name: 'Source Brand', title: 'Source Brand Canonical Title\nSpanish 720p\nhttps://active.test/ VidSpark', url: stream.url.href });
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(family.discoverMedia).toHaveBeenCalledWith(expect.objectContaining({ title: 'Canonical Title' }), source, services, expect.any(AbortSignal));
    expect(services.request).toHaveBeenCalledTimes(1);
  });

  test('relays only streams from IP-bound host architectures', async () => {
    const target = new URL('https://media.example/movie/master.m3u8?token=fixture');
    const engine: StreamEngine = { findStreams: jest.fn(async () => ({ media, streams: [{ url: target, protocol: 'hls' as const, validation: 'validated' as const, resolution: { width: 1920, height: 800 }, delivery: 'relayed' as const, sourceId: 'cinego:cinego.test', sourceExtractor: 'cinego', hostExtractor: 'vidsrcme-api' }], failures: [], unverified: [], deadline: { budgetMs: 1, elapsedMs: 1, exceeded: false, sourcesAttempted: 1, sourcesCompleted: 1, sourcesCancelled: 0 } })) };
    const sources = new SourceRegistry();
    sources.set({ id: 'cinego:cinego.test', canonicalDomain: 'cinego.test', aliases: [], fmhy: { name: 'CineGo', firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'supported' });
    const relay = new HlsRelay();
    const context: Context = { hostUrl: new URL('https://addon.example/'), id: 'fixture', config: {} };
    const result = await new RuntimeStremioAdapter(engine, sources, relay).findStreams(context, 'movie', 'tt1375666');
    const url = new URL(result.streams[0]?.url as string);
    const [, signature, payload] = url.pathname.match(/^\/hls-relay\/([^/]+)\/([^/]+)\/playlist\.m3u8$/) ?? [];
    expect(url.origin).toBe(context.hostUrl.origin);
    expect(relay.resolveTarget(signature as string, payload as string)).toEqual({ url: target, resource: { kind: 'playlist' } });
    expect(result.streams[0]).toMatchObject({ name: 'CineGo', title: 'CineGo Inception\nN/A 800p\nhttps://cinego.test/ VidsrcMe' });
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
