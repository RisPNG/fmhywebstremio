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
import { ArrowTvFamily } from './arrowtv-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/arrowtv/${name}`), 'utf8');
const response = (url: string, body: string, contentType = 'application/json'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: new URL(url), redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });
function forbidden(url: string): never {
  throw new TransportFailure({ code: 'HTTP_FORBIDDEN', message: 'Forbidden', stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, finalUrl: url } });
}

describe('ArrowTV source family with its configured player architectures', () => {
  const source: SourceRecord = { id: 'arrowtv:arrowtv.net', canonicalDomain: 'arrowtv.net', aliases: ['neonflix.st', 'cinezo.st', 'flikhub.net'], fmhy: { section: 'Stream Aggregators', tags: ['recommended'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'arrowtv', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };

  test('recognizes the shared catalog client fingerprint', () => {
    const html = fixture('home.html');
    const $ = cheerio.load(html);
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://cinezo.st/'), status: 200, headers: {}, htmlSample: html, assetPaths: $('script[src]').map((_index, element) => $(element).attr('src')).get(), scriptSignatures: [], routeHints: [] };
    expect(new ArrowTvFamily().classify(source, snapshot)).toMatchObject({ familyId: 'arrowtv', confidence: 1, evidence: [{ fingerprint: 'arrowtv-catalog-description' }, { value: 'arrowtv-tmdb-watch-routes' }, { value: 'arrowtv-catalog-nav' }] });
  });

  test('matches exact catalog entries on the reachable mirror and forwards later-season playback identity', async () => {
    const host: VidloveHostArchitecture = { discover: jest.fn(async (media, _player, sourceId, sourceExtractor): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL(`https://media.test/${media.type === 'movie' ? 'movie' : `s${media.season}e${media.episode}`}/master.m3u8`), protocol: 'hls', sourceId, sourceExtractor, hostExtractor: 'vidlove-api', discoveredAt: new Date(0) }] })) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname === 'arrowtv.net' || request.url.hostname === 'neonflix.st') return forbidden(request.url.href);
      if (request.url.pathname === '/search') {
        if (request.url.searchParams.get('q') === 'Inception') return response(request.url.href, fixture('search-inception.html'), 'text/html');
        if (request.url.searchParams.get('q') === 'Breaking Bad') return response(request.url.href, fixture('search-breaking-bad.html'), 'text/html');
        return response(request.url.href, fixture('search-absent.html'), 'text/html');
      }
      if (request.url.pathname.startsWith('/watch/')) {
        const season = request.url.searchParams.get('season');
        const episode = request.url.searchParams.get('episode');
        const page = request.url.pathname.startsWith('/watch/movie/') ? fixture('watch-movie.html') : fixture('watch-tv.html').replaceAll('/embed/tv/1396/5/16', `/embed/tv/1396/${season}/${episode}`);
        return response(request.url.href, page, 'text/html');
      }
      if (request.url.pathname.endsWith('/tmdb-client.js')) return response(request.url.href, fixture('tmdb-client.txt'), 'text/javascript');
      if (request.url.pathname.endsWith('/other-client.js')) return response(request.url.href, 'window.addEventListener("load",()=>{})', 'text/javascript');
      if (request.url.hostname === 'api.themoviedb.org') {
        expect(request.headers?.['authorization']).toMatch(/^Bearer eyJhbGciOi/);
        return response(request.url.href, JSON.stringify({ season_number: Number(request.url.pathname.split('/').at(-1)), episodes: Array.from({ length: 16 }, (_value, index) => ({ episode_number: index + 1 })) }));
      }
      if (request.expectedContent === 'binary') return response(request.url.href, 'fixture-segment', 'video/mp2t');
      if (/\/video\.m3u8$/.test(request.url.pathname)) return response(request.url.href, '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST', 'application/vnd.apple.mpegurl');
      return response(request.url.href, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,CODECS="avc1.64001f"\nvideo.m3u8', 'application/vnd.apple.mpegurl');
    }) };
    const registry = new SourceRegistry();
    registry.set(source);
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, new ArrowTvFamily(host), { familyId: 'arrowtv', cases: [
      { id: 'movie', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'episode', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'later-season', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true } });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect(host.discover).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 1396, year: 2008, season: 5, episode: 16 }), new URL('https://player.vidlove.cc/embed/tv/1396/5/16'), source.id, 'arrowtv', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 27205, type: 'movie', year: 2010 }), new URL('https://player.vidlove.cc/embed/movie/27205'), source.id, 'arrowtv', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenCalledTimes(3);
  });

  test('falls back to the next mirror when the first player is unavailable', async () => {
    const host: VidloveHostArchitecture = { discover: jest.fn(async (_media, player, sourceId): Promise<ExtractionResult> => player.hostname === 'player.vidlove.cc'
      ? { type: 'streams', streams: [{ url: new URL('https://media.test/movie/master.m3u8'), protocol: 'hls', sourceId, sourceExtractor: 'arrowtv', hostExtractor: 'vidlove-api', discoveredAt: new Date(0) }] }
      : { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Vidlove player no longer declares its playback API and startup providers', stage: 'stage:extraction', sourceId, extractorId: 'vidlove-api', targetHost: player.hostname, observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } } }) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.pathname === '/search') return response(request.url.href, fixture('search-inception.html'), 'text/html');
      if (request.url.pathname.startsWith('/watch/')) return response(request.url.href, fixture(request.url.hostname === 'cinezo.st' ? 'watch-movie.html' : 'watch-pstream-mirror.html'), 'text/html');
      return response(request.url.href, 'unused', 'text/plain');
    }) };
    await expect(new ArrowTvFamily(host, host).discoverMedia({ canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams' });
    expect(host.discover).toHaveBeenNthCalledWith(1, expect.anything(), new URL('https://player.cinezo.live/embed/movie/27205'), expect.any(String), expect.any(String), expect.anything(), expect.anything());
    expect(host.discover).toHaveBeenLastCalledWith(expect.anything(), new URL('https://player.vidlove.cc/embed/movie/27205'), expect.any(String), expect.any(String), expect.anything(), expect.anything());
  });

  test('rejects unavailable seasons and episodes without delegating a different episode', async () => {
    const host: VidloveHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname !== 'cinezo.st' && request.url.hostname !== 'api.themoviedb.org') return forbidden(request.url.href);
      if (request.url.pathname === '/search') return response(request.url.href, fixture('search-breaking-bad.html'), 'text/html');
      if (request.url.pathname.startsWith('/watch/')) return response(request.url.href, fixture('watch-tv.html').replaceAll('/embed/tv/1396/5/16', `/embed/tv/1396/${request.url.searchParams.get('season')}/${request.url.searchParams.get('episode')}`), 'text/html');
      if (request.url.pathname.endsWith('/tmdb-client.js')) return response(request.url.href, fixture('tmdb-client.txt'), 'text/javascript');
      if (request.url.pathname.endsWith('/season/99')) throw new TransportFailure({ code: 'HTTP_NOT_FOUND', message: 'Unknown season', stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      return response(request.url.href, JSON.stringify({ season_number: 1, episodes: [{ episode_number: 1 }, { episode_number: 2 }] }));
    }) };
    for (const media of [
      { canonicalId: 'tmdb:1396:99:1', type: 'episode' as const, tmdbId: 1396, title: 'Breaking Bad', season: 99, episode: 1 },
      { canonicalId: 'tmdb:1396:1:99', type: 'episode' as const, tmdbId: 1396, title: 'Breaking Bad', season: 1, episode: 99 },
    ]) await expect(new ArrowTvFamily(host).discoverMedia(media, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test.each([
    { canonicalId: 'tmdb:27205', type: 'movie' as const, tmdbId: 27205, title: 'Inception', year: 2010 },
    { canonicalId: 'tmdb:1396:1:1', type: 'episode' as const, tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 },
    { canonicalId: 'tmdb:1396:5:16', type: 'episode' as const, tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 },
  ])('follows the canonical Cinezo player for $canonicalId', async (media) => {
    const vidlove: VidloveHostArchitecture = { discover: jest.fn() };
    const cinezo: CinezoHostArchitecture = { discover: jest.fn(async (_media, _player, sourceId, sourceExtractor): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL('https://native.test/movie.mp4'), protocol: 'http', sourceId, sourceExtractor, hostExtractor: 'cinezo-player', discoveredAt: new Date(0) }] })) };
    const path = media.type === 'movie' ? 'movie/27205' : `tv/1396/${media.season}/${media.episode}`;
    const services: RequestServices = { request: jest.fn(async request => response(request.url.href, request.url.pathname === '/search' ? fixture(media.type === 'movie' ? 'search-inception.html' : 'search-breaking-bad.html') : request.url.pathname.startsWith('/watch/') ? fixture('watch-pstream-mirror.html').replace('/embed/movie/27205', `/embed/${path}`) : request.url.hostname === 'api.themoviedb.org' ? JSON.stringify({ season_number: media.season, episodes: [{ episode_number: media.episode }] }) : fixture('tmdb-client.txt'))) };
    await expect(new ArrowTvFamily(vidlove, cinezo).discoverMedia(media, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams', streams: [{ hostExtractor: 'cinezo-player' }] });
    expect(cinezo.discover).toHaveBeenCalledWith(media, new URL(`https://player.cinezo.live/embed/${path}`), source.id, 'arrowtv', services, expect.any(AbortSignal));
    expect(vidlove.discover).not.toHaveBeenCalled();
  });

  test('surfaces the transport failure when every mirror refuses the catalog', async () => {
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => forbidden(request.url.href)) };
    await expect(new ArrowTvFamily({ discover: jest.fn() }).discoverMedia({ canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, source, services, new AbortController().signal)).rejects.toBeInstanceOf(TransportFailure);
  });
});
