import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResult, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import type { SpeedracelightHostArchitecture } from '../hosts/speedracelight-host-architecture';
import { VidboxFamily } from './vidbox-family';

describe('Vidbox source family', () => {
  const source: SourceRecord = { id: 'vidbox:vidbox.test', canonicalDomain: 'vidbox.test', aliases: ['cinehd.test'], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const html = readFileSync(resolve(__dirname, '../__fixtures__/vidbox/home.html'), 'utf8');
  const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://vidbox.test/'), status: 200, headers: {}, htmlSample: html, assetPaths: ['/_next/static/chunks/common.342c06b3.js', '/_next/static/css/c9faf02fc1c6a200.css'], scriptSignatures: [], routeHints: ['/search', '/search/anime', '/watchlist'] };
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 };
  const series: MediaIdentity = { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 };

  test('requires the streaming guide identity, typed catalog routes, and client assets together', () => {
    const family = new VidboxFamily();
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: family.id, confidence: 1 });
    expect(family.classify(source, { ...snapshot, htmlSample: html.replace('Your Ultimate Streaming Guide', 'Free Movies') })).toBeNull();
    expect(family.classify(source, { ...snapshot, htmlSample: html.replace('/search?type=tv', '/tv') })).toBeNull();
    expect(family.classify(source, { ...snapshot, routeHints: ['/search'] })).toBeNull();
    expect(family.classify(source, { ...snapshot, assetPaths: ['/static/app.js'] })).toBeNull();
  });

  test('discovers exact catalog media and passes the requested later-season coordinates to the existing host', async () => {
    const streams: ExtractionResult = { type: 'streams', streams: [{ url: new URL('https://media.test/master.m3u8'), protocol: 'hls', sourceId: source.id, sourceExtractor: 'vidbox', hostExtractor: 'speedracelight-api', discoveredAt: new Date(0) }] };
    const host: SpeedracelightHostArchitecture = { discover: jest.fn(async () => streams) };
    const family = new VidboxFamily(host);
    const requests: URL[] = [];
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      requests.push(new URL(request.url));
      const fixture = request.url.pathname === '/tv/1396' ? 'series-breaking-bad.html' : request.url.searchParams.get('q') === 'Inception' ? 'suggest-inception.json' : request.url.searchParams.get('q') === 'Breaking Bad' ? 'suggest-breaking-bad.json' : 'suggest-absent.json';
      const body = readFileSync(resolve(__dirname, `../__fixtures__/vidbox/${fixture}`), 'utf8');
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const earlyEpisode = { ...series, canonicalId: 'tmdb:1396:1:1', season: 1, episode: 1 };
    for (const media of [movie, earlyEpisode, series]) await expect(family.discoverMedia(media, source, services, new AbortController().signal)).resolves.toBe(streams);
    expect(host.discover).toHaveBeenNthCalledWith(3, series, source.id, family.id, services, expect.any(AbortSignal));
    expect(requests.filter(url => url.pathname === '/tv/1396')).toHaveLength(2);
    expect(requests.every(url => url.hostname === source.canonicalDomain)).toBe(true);
    const seriesPage = readFileSync(resolve(__dirname, '../__fixtures__/vidbox/series-breaking-bad.html'), 'utf8');
    expect(seriesPage).toContain('\\"air_date\\":\\"2012-07-15\\",\\"episode_count\\":16');
    expect(seriesPage).toContain(`\\"first_air_date\\":\\"${series.year}-`);
    for (const media of [{ ...movie, title: 'FMHY Extractability Probe 7b18e49a', tmdbId: 1, year: 1874 }, { ...movie, year: 1980 }, { ...movie, tmdbId: 1359046 }, { ...movie, type: 'episode' as const, season: 1, episode: 1 }, { ...series, season: 9 }, { ...series, episode: 17 }]) await expect(family.discoverMedia(media, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).toHaveBeenCalledTimes(3);
  });

  test.each([['suggestions', 'RESPONSE_SCHEMA_CHANGED'], ['seasons', 'PAGE_STRUCTURE_CHANGED']])('preserves a typed failure for changed %s data', async (stage, code) => {
    const host: SpeedracelightHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      const body = request.url.pathname === '/tv/1396' ? '<html></html>' : stage === 'suggestions' ? '{}' : readFileSync(resolve(__dirname, '../__fixtures__/vidbox/suggest-breaking-bad.json'), 'utf8');
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    await expect(new VidboxFamily(host).discoverMedia(series, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code, stage: 'stage:discovery', sourceId: source.id, familyId: 'vidbox' } });
    expect(host.discover).not.toHaveBeenCalled();
  });
});
