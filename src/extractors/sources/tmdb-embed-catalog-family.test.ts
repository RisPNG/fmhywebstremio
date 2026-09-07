import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResult, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import type { SpeedracelightHostArchitecture } from '../hosts/speedracelight-host-architecture';
import { TmdbEmbedCatalogFamily } from './tmdb-embed-catalog-family';

describe('TMDB embed catalog source family', () => {
  const source: SourceRecord = { id: 'movies-to-watch:moviestowatch.test', canonicalDomain: 'moviestowatch.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const html = readFileSync(resolve(__dirname, '../__fixtures__/tmdb-embed-catalog/home.html'), 'utf8');
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 };
  const series: MediaIdentity = { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 };

  test('requires the catalog, season UI, and configured movie and episode player together', () => {
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://moviestowatch.test/'), status: 200, headers: {}, htmlSample: html, assetPaths: [], scriptSignatures: [], routeHints: [] };
    const family = new TmdbEmbedCatalogFamily();
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: family.id, confidence: 1 });
    for (const signature of ['TMDB_KEY', 'loadTVSeasons', 'player.videasy.net/tv/']) expect(family.classify(source, { ...snapshot, htmlSample: html.replaceAll(signature, 'removed') })).toBeNull();
  });

  test('discovers exact catalog media and passes the requested later-season coordinates to the existing host', async () => {
    const streams: ExtractionResult = { type: 'streams', streams: [{ url: new URL('https://media.test/master.m3u8'), protocol: 'hls', sourceId: source.id, sourceExtractor: 'tmdb-embed-catalog', hostExtractor: 'speedracelight-api', discoveredAt: new Date(0) }] };
    const host: SpeedracelightHostArchitecture = { discover: jest.fn(async () => streams) };
    const family = new TmdbEmbedCatalogFamily(host);
    const requests: URL[] = [];
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      requests.push(new URL(request.url));
      const fixture = request.url.pathname === '/' ? 'home.html' : request.url.pathname === '/3/tv/1396' ? 'series-breaking-bad.json' : request.url.searchParams.get('query') === 'Inception' ? 'search-inception.json' : request.url.searchParams.get('query') === 'Breaking Bad' ? 'search-breaking-bad.json' : 'search-absent.json';
      const body = readFileSync(resolve(__dirname, `../__fixtures__/tmdb-embed-catalog/${fixture}`), 'utf8');
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const earlyEpisode = { ...series, canonicalId: 'tmdb:1396:1:1', season: 1, episode: 1 };
    for (const media of [movie, earlyEpisode, series]) await expect(family.discoverMedia(media, source, services, new AbortController().signal)).resolves.toBe(streams);
    expect(host.discover).toHaveBeenNthCalledWith(3, series, source.id, family.id, services, expect.any(AbortSignal));
    expect(requests.filter(url => url.pathname === '/3/tv/1396')).toHaveLength(2);
    expect(requests.find(url => url.pathname === '/3/search/multi')?.searchParams.get('api_key')).toBe('fixturekey');
    const seasons = JSON.parse(readFileSync(resolve(__dirname, '../__fixtures__/tmdb-embed-catalog/series-breaking-bad.json'), 'utf8')) as { seasons: { season_number: number; air_date: string }[] };
    expect(seasons.seasons.find(season => season.season_number === 5)?.air_date.slice(0, 4)).not.toBe(String(series.year));
    for (const media of [{ ...movie, title: 'FMHY Extractability Probe 7b18e49a', tmdbId: 1, year: 1874 }, { ...movie, year: 1980 }, { ...movie, tmdbId: 99 }, { ...movie, type: 'episode' as const, season: 1, episode: 1 }, { ...series, season: 99 }, { ...series, episode: 17 }]) await expect(family.discoverMedia(media, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).toHaveBeenCalledTimes(3);
  });

  test.each(['page', 'search', 'seasons'])('preserves a typed failure for changed %s data', async (stage) => {
    const host: SpeedracelightHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      const body = request.url.pathname === '/' ? stage === 'page' ? '<html></html>' : html : request.url.pathname === '/3/tv/1396' || stage === 'search' ? '{}' : readFileSync(resolve(__dirname, '../__fixtures__/tmdb-embed-catalog/search-breaking-bad.json'), 'utf8');
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    await expect(new TmdbEmbedCatalogFamily(host).discoverMedia(series, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: stage === 'page' ? 'PAGE_STRUCTURE_CHANGED' : 'RESPONSE_SCHEMA_CHANGED', stage: 'stage:discovery', sourceId: source.id } });
    expect(host.discover).not.toHaveBeenCalled();
  });
});
