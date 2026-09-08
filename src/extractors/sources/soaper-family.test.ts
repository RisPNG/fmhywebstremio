import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResult, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import type { VidsrcMeHostArchitecture } from '../hosts/vidsrcme-host-architecture';
import { SoaperFamily } from './soaper-family';

describe('Soaper source family', () => {
  const source: SourceRecord = { id: 'soapgo:soapgo.test', canonicalDomain: 'soapgo.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, title: 'The Boys', year: 2019, season: 2, episode: 1 };
  let fixtures: Record<string, string>;
  let services: RequestServices;
  let host: VidsrcMeHostArchitecture;

  beforeEach(() => {
    fixtures = Object.fromEntries(['home', 'search-inception', 'search-the-boys', 'search-absent', 'movie-inception', 'series-the-boys', 'episode-the-boys', 'player-movie', 'player-episode'].map(name => [name, readFileSync(resolve(__dirname, `../__fixtures__/soaper/${name}.html`), 'utf8')]));
    host = { discover: jest.fn(async (): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL('https://media.test/master.m3u8'), protocol: 'hls', delivery: 'relayed', sourceId: source.id, sourceExtractor: 'soaper', hostExtractor: 'vidsrcme-api', discoveredAt: new Date(0) }] })) };
    services = { request: jest.fn(async (request: ExtractionRequest) => {
      const path = request.url.pathname;
      const query = request.url.searchParams.get('key');
      const name = path === '/search'
        ? query === 'Inception' ? 'search-inception' : query === 'The Boys' ? 'search-the-boys' : 'search-absent'
        : path.startsWith('/embed/movie/') ? 'player-movie' : path.startsWith('/embed/tv/') ? 'player-episode' : path.startsWith('/movie/') ? 'movie-inception' : path.includes('/s2e1-') ? 'episode-the-boys' : 'series-the-boys';
      const body = fixtures[name] as string;
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
  });

  test('requires the shared landing structure, search form, and catalog navigation together', () => {
    const family = new SoaperFamily();
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://soapgo.test'), status: 200, headers: {}, htmlSample: fixtures['home'] as string, assetPaths: [], routeHints: [], scriptSignatures: [] };
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: 'soaper', confidence: 1 });
    for (const fragment of ['landing-search', 'home-link', '/logo.png']) expect(family.classify(source, { ...snapshot, htmlSample: (fixtures['home'] as string).replaceAll(fragment, 'other') })).toBeNull();
    expect(family.classify(source, { ...snapshot, htmlSample: '<h1>SoapGo</h1>' })).toBeNull();
  });

  test('follows the exact movie and later episode catalog entries to their configured host', async () => {
    const family = new SoaperFamily(host);
    for (const media of [movie, episode]) await expect(family.discoverMedia(media, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams' });
    expect(host.discover).toHaveBeenNthCalledWith(1, movie, source.id, 'soaper', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenNthCalledWith(2, episode, source.id, 'soaper', services, expect.any(AbortSignal));
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://soapgo.test/tv/7e9XdO6Yjg-the-boys/s2e1-the-big-ride') }), expect.any(AbortSignal));
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://soapgo.test/embed/tv/1vNAnvzQ85/2/1') }), expect.any(AbortSignal));
  });

  test('rejects nonexistent titles, wrong years, wrong media types, and unavailable episodes', async () => {
    const family = new SoaperFamily(host);
    for (const media of [{ ...movie, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, { ...movie, year: 1980 }, { ...movie, type: 'episode' as const, season: 1, episode: 1 }, { ...episode, season: 99 }, { ...episode, episode: 99 }]) await expect(family.discoverMedia(media, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test('does not confuse a season release year with the series start year', async () => {
    fixtures['search-the-boys'] = (fixtures['search-the-boys'] as string).replace('2019-07-25', '2020-09-04');
    await expect(new SoaperFamily(host).discoverMedia(episode, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams' });
    expect(host.discover).toHaveBeenCalledWith(episode, source.id, 'soaper', services, expect.any(AbortSignal));
  });

  test.each([
    { fixture: 'search-inception', original: 'movie-results-heading', replacement: 'changed', code: 'PAGE_STRUCTURE_CHANGED' },
    { fixture: 'movie-inception', original: 'stream-embed-frame', replacement: 'changed', code: 'EMBED_NOT_FOUND' },
    { fixture: 'player-movie', original: 'https://vidsrcme.ru/embed/movie', replacement: 'https://different.test/embed/movie', code: 'PAGE_STRUCTURE_CHANGED' },
    { fixture: 'player-movie', original: '27205', replacement: '999', code: 'RESULT_MAPPING_FAILED' },
    { fixture: 'player-episode', original: '"episode":1', replacement: '"episode":2', code: 'RESULT_MAPPING_FAILED' },
  ])('preserves $code for a changed $fixture', async ({ fixture, original, replacement, code }) => {
    fixtures[fixture] = (fixtures[fixture] as string).replaceAll(original, replacement);
    await expect(new SoaperFamily(host).discoverMedia(fixture === 'player-episode' ? episode : movie, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code, sourceId: source.id, familyId: 'soaper' } });
    expect(host.discover).not.toHaveBeenCalled();
  });
});
