import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';
import type { ExtractionRequest, ExtractionResponse, ExtractionResult, RequestServices, SourceRecord } from '../../engine/core/models';
import { FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import { TransportFailure } from '../../engine/transport/transport-director';
import type { CinezoHostArchitecture } from '../hosts/cinezo-host-architecture';
import type { VidloveHostArchitecture } from '../hosts/vidlove-host-architecture';
import { SixtySevenMoviesFamily } from './sixty-seven-movies-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/sixty-seven-movies/${name}`), 'utf8');
const response = (url: string, body: string, contentType = 'application/json'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: new URL(url), redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('67Movies source family with its configured player architectures', () => {
  const source: SourceRecord = { id: '67movies:67movies.net', canonicalDomain: '67movies.st', aliases: ['67movies.net', 'phantomflix.net', 'ravenflix.net', 'shows.st'], fmhy: { section: 'Stream Aggregators', tags: ['recommended'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'sixty-seven-movies', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };

  test('recognizes the shared catalog client fingerprint', () => {
    const html = fixture('home.html').replaceAll('67movies.net', '67movies.st');
    const $ = cheerio.load(html);
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://67movies.nl/'), status: 200, headers: {}, htmlSample: html, assetPaths: $('script[src]').map((_index, element) => $(element).attr('src')).get(), scriptSignatures: [], routeHints: [] };
    expect(new SixtySevenMoviesFamily().classify(source, snapshot)).toMatchObject({ familyId: 'sixty-seven-movies', confidence: 1, evidence: [{ fingerprint: 'sixty-seven-movies-brand' }, { value: 'sixty-seven-movies-catalog' }, { value: 'sixty-seven-movies-next-client' }] });
  });

  test('matches exact movie and series catalog entries and forwards later-season playback identity', async () => {
    const host: VidloveHostArchitecture = { discover: jest.fn(async (media, _player, sourceId, sourceExtractor): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL(`https://media.test/${media.type === 'movie' ? 'movie' : `s${media.season}e${media.episode}`}/master.m3u8`), protocol: 'hls', sourceId, sourceExtractor, hostExtractor: 'vidlove-api', discoveredAt: new Date(0) }] })) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.pathname === '/api/semantic-search') {
        if (request.url.searchParams.get('q') === 'Inception') return response(request.url.href, fixture('search-inception.json'));
        if (request.url.searchParams.get('q') === 'Breaking Bad') return response(request.url.href, fixture('search-breaking-bad.json'));
        return response(request.url.href, fixture('search-absent.json'));
      }
      if (request.url.pathname.startsWith('/watch/')) return response(request.url.href, fixture('watch.html'), 'text/html');
      if (request.url.pathname.endsWith('/page-fixture.js')) return response(request.url.href, fixture('watch-client.txt'), 'text/javascript');
      if (request.url.hostname === 'api.themoviedb.org') return response(request.url.href, JSON.stringify({ season_number: Number(request.url.pathname.split('/').at(-1)), episodes: Array.from({ length: 16 }, (_value, index) => ({ episode_number: index + 1 })) }));
      if (request.expectedContent === 'binary') return response(request.url.href, 'fixture-segment', 'video/mp2t');
      if (/\/video\.m3u8$/.test(request.url.pathname)) return response(request.url.href, '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST', 'application/vnd.apple.mpegurl');
      return response(request.url.href, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,CODECS="avc1.64001f"\nvideo.m3u8', 'application/vnd.apple.mpegurl');
    }) };
    const registry = new SourceRegistry();
    registry.set(source);
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, new SixtySevenMoviesFamily(host), { familyId: 'sixty-seven-movies', cases: [
      { id: 'movie', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'episode', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'later-season', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true } });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect(host.discover).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 1396, year: 2008, season: 5, episode: 16 }), new URL('https://vidlove.test/embed/tv/1396/5/16'), source.id, 'sixty-seven-movies', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenCalledTimes(3);
  });

  test('rejects unavailable seasons and episodes without delegating a different episode', async () => {
    const host: VidloveHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async (request) => {
      if (request.url.pathname === '/api/semantic-search') return response(request.url.href, fixture('search-breaking-bad.json'));
      if (request.url.pathname.startsWith('/watch/')) return response(request.url.href, fixture('watch.html'), 'text/html');
      if (request.url.pathname.endsWith('/page-fixture.js')) return response(request.url.href, fixture('watch-client.txt'), 'text/javascript');
      if (request.url.pathname.endsWith('/season/99')) throw new TransportFailure({ code: 'HTTP_NOT_FOUND', message: 'Unknown season', stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      return response(request.url.href, JSON.stringify({ season_number: 1, episodes: [{ episode_number: 1 }, { episode_number: 2 }] }));
    }) };
    for (const media of [
      { canonicalId: 'tmdb:1396:99:1', type: 'episode' as const, tmdbId: 1396, title: 'Breaking Bad', season: 99, episode: 1 },
      { canonicalId: 'tmdb:1396:1:99', type: 'episode' as const, tmdbId: 1396, title: 'Breaking Bad', season: 1, episode: 99 },
    ]) await expect(new SixtySevenMoviesFamily(host).discoverMedia(media, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test.each([
    { canonicalId: 'tmdb:27205', type: 'movie' as const, tmdbId: 27205, title: 'Inception', year: 2010 },
    { canonicalId: 'tmdb:1396:1:1', type: 'episode' as const, tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 },
    { canonicalId: 'tmdb:1396:5:16', type: 'episode' as const, tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 },
  ])('uses the advertised Cinezo player when Vidlove has no streams for $canonicalId', async (media) => {
    const vidlove: VidloveHostArchitecture = { discover: jest.fn(async (): Promise<ExtractionResult> => ({ type: 'empty', reason: 'no-streams' })) };
    const cinezo: CinezoHostArchitecture = { discover: jest.fn(async (_media, _player, sourceId, sourceExtractor): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL('https://native.test/movie.mp4'), protocol: 'http', sourceId, sourceExtractor, hostExtractor: 'cinezo-player', discoveredAt: new Date(0) }] })) };
    const services: RequestServices = { request: jest.fn(async request => response(request.url.href, request.url.pathname === '/api/semantic-search' ? fixture(media.type === 'movie' ? 'search-inception.json' : 'search-breaking-bad.json') : request.url.pathname.startsWith('/watch/') ? fixture('watch.html') : request.url.hostname === 'api.themoviedb.org' ? JSON.stringify({ season_number: media.season, episodes: [{ episode_number: media.episode }] }) : fixture('watch-client-cinezo.txt'))) };
    await expect(new SixtySevenMoviesFamily(vidlove, cinezo).discoverMedia(media, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams', streams: [{ hostExtractor: 'cinezo-player' }] });
    const path = media.type === 'movie' ? 'movie/27205' : `tv/1396/${media.season}/${media.episode}`;
    expect(cinezo.discover).toHaveBeenCalledWith(media, new URL(`https://api.cinezo.test/${path}`), source.id, 'sixty-seven-movies', services, expect.any(AbortSignal));
    expect(vidlove.discover).toHaveBeenCalledTimes(1);
  });

  test('does not delegate absent catalog entries to either supported player', async () => {
    const vidlove: VidloveHostArchitecture = { discover: jest.fn() };
    const cinezo: CinezoHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async request => response(request.url.href, fixture('search-absent.json'))) };
    await expect(new SixtySevenMoviesFamily(vidlove, cinezo).discoverMedia({ canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(vidlove.discover).not.toHaveBeenCalled();
    expect(cinezo.discover).not.toHaveBeenCalled();
  });

  test('does not use a dormant Vidlove switch when the provider is absent from the active list', async () => {
    const host: VidloveHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async request => response(request.url.href, request.url.pathname === '/api/semantic-search' ? fixture('search-inception.json') : request.url.pathname.startsWith('/watch/') ? fixture('watch.html') : fixture('watch-client.txt').replace('{key:"vidlove",label:"Vidlove"}', '{key:"other",label:"Other"}'))) };
    await expect(new SixtySevenMoviesFamily(host).discoverMedia({ canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'EMBED_NOT_FOUND' } });
    expect(host.discover).not.toHaveBeenCalled();
  });
});
