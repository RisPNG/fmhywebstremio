import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResult, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import { FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import type { VidriftHostArchitecture } from '../hosts/vidrift-host-architecture';
import { CinriftFamily } from './cinrift-family';

describe('Cinrift source family', () => {
  const source: SourceRecord = { id: '7movies:7movies.test', canonicalDomain: '7movies.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cinrift/${name}`), 'utf8');
  const html = fixture('home.html');
  const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://7movies.test/'), status: 200, headers: {}, htmlSample: html, assetPaths: ['/_next/static/chunks/webpack-7a0e0bf4bf330bd6.js'], scriptSignatures: [], routeHints: ['/'] };
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 };
  const series: MediaIdentity = { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2020, season: 2, episode: 1 };
  const respond = (body: string, url: URL, contentType = 'application/json') => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });
  const services = (requests: ExtractionRequest[] = []): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => {
    requests.push(request);
    const query = request.url.searchParams.get('q');
    if (request.url.pathname === '/') return respond(fixture('home.html'), request.url, 'text/html');
    if (request.url.pathname === '/api/search') return respond(fixture(query === 'Inception' ? 'search-inception.json' : query === 'The Boys' ? 'search-the-boys.json' : 'search-absent.json'), request.url);
    if (request.url.pathname === '/api/tv/76479/season/2') return respond(fixture('season-the-boys-2.json'), request.url);
    if (request.url.pathname.startsWith('/api/tv/')) return respond('{"episodes":[]}', request.url);
    if (request.url.pathname === '/movie/27205/watch') return respond(fixture('watch-movie.html'), request.url, 'text/html');
    if (request.url.pathname === '/tv/76479/watch') return respond(fixture('watch-episode.html'), request.url, 'text/html');
    if (request.url.pathname === '/api/playback-token') return respond(fixture('playback-token.json'), request.url);
    if (request.url.pathname === '/_next/static/chunks/3733-player.js') return respond(fixture('player.txt'), request.url, 'application/javascript');
    if (request.url.pathname.endsWith('/page.js')) return respond('(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[3733],{}]);', request.url, 'application/javascript');
    if (request.url.pathname.startsWith('/api/boot/')) return respond(fixture('boot.json'), request.url);
    if (request.url.pathname === '/api/source/movie/27205') return respond(fixture('source-movie.json'), request.url);
    if (request.url.searchParams.get('url')?.endsWith('/master.m3u8')) return respond(fixture('master.m3u8'), request.url, 'application/vnd.apple.mpegurl');
    if (request.url.searchParams.get('url')?.endsWith('/index.m3u8')) return respond(fixture('media.m3u8'), request.url, 'application/vnd.apple.mpegurl');
    return respond('G', request.url, 'video/mp2t');
  }) });

  test('requires the Cinrift application, client storage, and TMDB media cards without a player preconnect', () => {
    const family = new CinriftFamily();
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: family.id, confidence: 1, evidence: [{ fingerprint: 'cinrift-next-application' }, { fingerprint: 'cinrift-client' }, { value: '/movie|tv/{tmdbId}' }] });
    expect(html).not.toContain('embed.vidrift.net');
    expect(family.classify(source, { ...snapshot, htmlSample: html.replaceAll('/_next/static/chunks/', '/assets/') })).toBeNull();
    expect(family.classify(source, { ...snapshot, htmlSample: html.replace('cinrift_ad_free', 'other_ad_free') })).toBeNull();
    expect(family.classify(source, { ...snapshot, htmlSample: html.replaceAll('data-navigation-href="/tv/', 'data-navigation-href="/show/') })).toBeNull();
  });

  test('matches the exact catalog entry and grants the requested later season to the declared player architecture', async () => {
    const streams: ExtractionResult = { type: 'streams', streams: [{ url: new URL('https://relay.test/master.m3u8'), protocol: 'hls', delivery: 'relayed', sourceId: source.id, sourceExtractor: 'cinrift', hostExtractor: 'vidrift-api', discoveredAt: new Date(0) }] };
    const host: VidriftHostArchitecture = { discover: jest.fn(async () => streams) };
    const family = new CinriftFamily(host);
    const requests: ExtractionRequest[] = [];
    const fixtures = services(requests);
    for (const media of [movie, series]) await expect(family.discoverMedia(media, source, fixtures, new AbortController().signal)).resolves.toBe(streams);
    expect(host.discover).toHaveBeenNthCalledWith(1, movie, new URL('https://embed.vidrift.net'), 'fixture-token', new URL('https://7movies.test/movie/27205/watch'), source.id, family.id, fixtures, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenNthCalledWith(2, series, new URL('https://embed.vidrift.net'), 'fixture-token', new URL('https://7movies.test/tv/76479/watch?season=2&episode=1'), source.id, family.id, fixtures, expect.any(AbortSignal));
    const grants = requests.filter(request => request.url.pathname === '/api/playback-token');
    expect(grants).toMatchObject([{ method: 'POST', headers: { 'content-type': 'application/json', 'origin': 'https://7movies.test' } }, { method: 'POST', headers: { origin: 'https://7movies.test' } }]);
    expect(grants.map(request => JSON.parse(String(request.body)) as unknown)).toEqual([{ tmdbId: 27205, type: 'movie', season: 1, episode: 1 }, { tmdbId: 76479, type: 'tv', season: 2, episode: 1 }]);
    expect(requests.map(request => request.url.href)).toEqual(expect.arrayContaining(['https://7movies.test/api/tv/76479/season/2', 'https://7movies.test/movie/27205/watch', 'https://7movies.test/tv/76479/watch?season=2&episode=1']));
    expect(requests.some(request => request.url.pathname.includes('webpack-'))).toBe(false);
    const catalog = JSON.parse(fixture('search-the-boys.json')) as { results: { year: string }[] };
    expect(Number(catalog.results[0]?.year)).not.toBe(series.year);
    for (const media of [{ ...movie, title: 'FMHY Extractability Probe 7b18e49a', tmdbId: 1, year: 1874 }, { ...movie, year: 1980 }, { ...movie, tmdbId: 1359046 }, { ...movie, type: 'episode' as const, season: 1, episode: 1 }, { ...series, season: 9 }, { ...series, episode: 9 }, { ...series, type: 'movie' as const }]) await expect(family.discoverMedia(media, source, fixtures, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).toHaveBeenCalledTimes(2);
  });

  test('preserves typed failures for changed catalog, player, and grant responses', async () => {
    const host: VidriftHostArchitecture = { discover: jest.fn() };
    const changed = (pathname: string, body: string): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => request.url.pathname === pathname ? respond(body, request.url) : services().request(request, new AbortController().signal)) });
    await expect(new CinriftFamily(host).discoverMedia(movie, source, changed('/api/search', '{}'), new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', stage: 'stage:discovery', sourceId: source.id, familyId: 'cinrift', diagnostic: { parserPath: 'results' } } });
    await expect(new CinriftFamily(host).discoverMedia(series, source, changed('/api/tv/76479/season/2', '{}'), new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', stage: 'stage:discovery', diagnostic: { parserPath: 'episodes' } } });
    await expect(new CinriftFamily(host).discoverMedia(movie, source, changed('/movie/27205/watch', '<html><head><link rel="preconnect" href="https://embed.vidrift.net"/></head></html>'), new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'EMBED_NOT_FOUND', stage: 'stage:extraction', diagnostic: { parserPath: 'watch-player-assets' } } });
    await expect(new CinriftFamily(host).discoverMedia(movie, source, changed('/_next/static/chunks/3733-player.js', fixture('player.txt').replaceAll('embed.vidrift.net', 'embed.example.net')), new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'EMBED_NOT_FOUND', stage: 'stage:extraction', diagnostic: { parserPath: 'watch-player-assets' } } });
    await expect(new CinriftFamily(host).discoverMedia(movie, source, changed('/api/playback-token', '{"error":"Invalid playback request."}'), new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', stage: 'stage:extraction', diagnostic: { parserPath: 'token' } } });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test('freshly validates the relayed Vidrift stream and becomes runtime eligible', async () => {
    const fixtures = services();
    const registry = new SourceRegistry();
    registry.set(source);
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), fixtures), new StreamSelector(fixtures), fixtures, registry).run(source, new CinriftFamily(), { familyId: 'cinrift', cases: [{ id: 'inception-2010', media: movie, expected: 'discoverable' }, { id: 'known-absent', media: { ...movie, title: 'FMHY Extractability Probe 7b18e49a', tmdbId: 1, year: 1874 }, expected: 'absent' }] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, anomalies: [], stages: { discovery: true, extraction: true, validation: true } });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
  });
});
