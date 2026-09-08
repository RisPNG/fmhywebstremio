import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResult, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import type { CineproHostArchitecture } from '../hosts/cinepro-host-architecture';
import { AnicineFamily } from './anicine-family';

describe('AniCine source family', () => {
  const source: SourceRecord = { id: 'anicine:catalog.test', canonicalDomain: 'catalog.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, title: 'The Boys', year: 2019, season: 2, episode: 1 };
  const anime: MediaIdentity = { canonicalId: 'tmdb:1429:2:1', type: 'episode', tmdbId: 1429, title: 'Attack on Titan', year: 2013, season: 2, episode: 1 };
  let fixtures: Record<string, string>;
  let host: CineproHostArchitecture;
  let services: RequestServices;

  beforeEach(() => {
    fixtures = Object.fromEntries(['home.html', 'watch.html', 'players.txt', 'search-movie.json', 'search-series.json', 'search-anime.json', 'search-absent.json', 'series.json', 'anime.json'].map(name => [name, readFileSync(resolve(__dirname, '../__fixtures__/anicine', name), 'utf8')]));
    host = { discover: jest.fn(async (): Promise<ExtractionResult> => ({ type: 'empty', reason: 'no-streams' })) };
    services = { request: jest.fn(async (request: ExtractionRequest) => {
      const path = request.url.searchParams.get('path');
      const query = request.url.searchParams.get('query');
      const name = path === '/search/multi'
        ? query === 'Inception' ? 'search-movie.json' : query === 'The Boys' ? 'search-series.json' : query === 'Attack on Titan' ? 'search-anime.json' : 'search-absent.json'
        : path === '/tv/76479' ? 'series.json' : path === '/tv/1429' ? 'anime.json' : request.url.pathname === '/' ? 'home.html' : request.url.pathname.startsWith('/watch/') ? 'watch.html' : 'players.txt';
      const body = fixtures[name] as string;
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
  });

  test('requires the catalog brand, navigation, and watch application together', () => {
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://catalog.test'), status: 200, headers: {}, htmlSample: fixtures['home.html'] as string, assetPaths: [], routeHints: [], scriptSignatures: [] };
    const family = new AnicineFamily();
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: 'anicine', confidence: 1 });
    for (const part of ['AniCine', '/anime', '/watch/movie/']) expect(family.classify(source, { ...snapshot, htmlSample: (fixtures['home.html'] as string).replaceAll(part, 'changed') })).toBeNull();
    expect(family.classify(source, { ...snapshot, htmlSample: '<title>AniCine</title>' })).toBeNull();
  });

  test('maps movie, later-season television, and anime to the current configured player', async () => {
    const family = new AnicineFamily(host);
    for (const media of [movie, episode, anime]) await family.discoverMedia(media, source, services, new AbortController().signal);
    expect(host.discover).toHaveBeenNthCalledWith(1, movie, new URL('https://aniwish.anasvercel3.workers.dev/movie/27205'), source.id, 'anicine', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenNthCalledWith(2, episode, new URL('https://aniwish.vohai6360.workers.dev/tv/76479/2/1'), source.id, 'anicine', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenNthCalledWith(3, anime, new URL('https://aniwish.vohai6360.workers.dev/tv/1429/2/1'), source.id, 'anicine', services, expect.any(AbortSignal));
    expect((services.request as jest.Mock).mock.calls.some(([request]: [ExtractionRequest]) => request.url.pathname.includes('main-app'))).toBe(false);
  });

  test('rejects absent titles, wrong identities and years, and unavailable seasons or episodes before host requests', async () => {
    const family = new AnicineFamily(host);
    for (const media of [{ ...movie, title: 'FMHY Extractability Probe 7b18e49a' }, { ...movie, tmdbId: 1 }, { ...movie, year: 1980 }, { ...movie, type: 'episode' as const, season: 1, episode: 1 }, { ...anime, season: 99 }, { ...anime, episode: 99 }]) await expect(family.discoverMedia(media, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test('accepts a season released after the series began', async () => {
    expect(fixtures['anime.json']).toContain('2017-04-01');
    await new AnicineFamily(host).discoverMedia(anime, source, services, new AbortController().signal);
    expect(host.discover).toHaveBeenCalled();
  });

  test('uses changed player origins from the live configuration', async () => {
    fixtures['players.txt'] = (fixtures['players.txt'] as string).replaceAll('aniwish.anasvercel3.workers.dev', 'new-player.test');
    await new AnicineFamily(host).discoverMedia(movie, source, services, new AbortController().signal);
    expect(host.discover).toHaveBeenCalledWith(movie, new URL('https://new-player.test/movie/27205'), source.id, 'anicine', services, expect.any(AbortSignal));
  });

  test.each([
    ['search-movie.json', '{}', 'RESPONSE_SCHEMA_CHANGED'],
    ['series.json', '{"id":76479}', 'RESPONSE_SCHEMA_CHANGED'],
    ['players.txt', 'unrelated player', 'EMBED_NOT_FOUND'],
    ['watch.html', '<html></html>', 'EMBED_NOT_FOUND'],
  ])('reports changed %s without claiming playback', async (fixture, body, code) => {
    fixtures[fixture] = body;
    await expect(new AnicineFamily(host).discoverMedia(fixture === 'series.json' ? episode : movie, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code } });
    expect(host.discover).not.toHaveBeenCalled();
  });
});
