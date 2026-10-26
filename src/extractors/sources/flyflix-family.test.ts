import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, ExtractionResult, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import type { CinezoHostArchitecture } from '../hosts/cinezo-host-architecture';
import type { VidBoltHostArchitecture } from '../hosts/vidbolt-host-architecture';
import type { VidloveHostArchitecture } from '../hosts/vidlove-host-architecture';
import { FlyflixFamily } from './flyflix-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/flyflix/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('Flyflix source family', () => {
  const source: SourceRecord = { id: 'flyflix:flyflix.cc', canonicalDomain: 'flyflix.cc', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 };
  const signal = new AbortController().signal;
  const empty = async (): Promise<ExtractionResult> => ({ type: 'empty', reason: 'no-streams' });
  const hostsFor = (vidbolt: VidBoltHostArchitecture['discover'] = jest.fn(async (_media, _player, sourceId, sourceExtractor): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL('https://media.test/master.m3u8'), protocol: 'hls', sourceId, sourceExtractor, hostExtractor: 'vidbolt-player', discoveredAt: new Date(0) }] }))) => ({
    vidlove: { discover: jest.fn(empty) } as VidloveHostArchitecture,
    cinezo: { discover: jest.fn(empty) } as CinezoHostArchitecture,
    vidbolt: { discover: vidbolt } as VidBoltHostArchitecture,
  });
  const servicesFor = (overrides: Readonly<Record<string, string>> = {}): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => {
    const path = request.url.pathname;
    let name: string;
    if (request.url.hostname === 'flyflix.cc' && path === '/') name = 'home.html';
    else if (request.url.hostname === 'flyflix.cc' && path.startsWith('/assets/')) name = 'client.txt';
    else if (path === '/3/search/multi') name = request.url.searchParams.get('query') === 'Inception' ? 'search-inception.json' : request.url.searchParams.get('query') === 'Breaking Bad' ? 'search-breaking-bad.json' : 'search-absent.json';
    else if (path.startsWith('/3/tv/1396/season/')) {
      if (path.endsWith('/99')) throw new TransportFailure({ code: 'HTTP_NOT_FOUND', message: 'Unknown season', stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      name = `season-breaking-bad-${path.split('/').at(-1)}.json`;
    } else throw new Error(`Unexpected Flyflix request: ${request.url.href}`);
    return response(request.url, overrides[name] ?? fixture(name));
  }) });

  test('requires the declared Flyflix identity and application assets', () => {
    const family = new FlyflixFamily();
    const html = fixture('home.html');
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://flyflix.cc/'), status: 200, headers: {}, htmlSample: html, assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: 'flyflix', confidence: 1 });
    for (const altered of [html.replace('<title>Flyflix', '<title>Other'), html.replace('property="og:site_name" content="Flyflix"', 'property="og:site_name" content="Other"'), html.replace('id="root"', 'id="app"')]) expect(family.classify(source, { ...snapshot, htmlSample: altered })).toBeNull();
  });

  test('matches the exact catalog entry and follows the movie URL declared by its application', async () => {
    const hosts = hostsFor();
    const services = servicesFor();
    const result = await new FlyflixFamily(hosts.vidlove, hosts.cinezo, hosts.vidbolt).discoverMedia(movie, source, services, signal);
    expect(result).toMatchObject({ type: 'streams', streams: [{ hostExtractor: 'vidbolt-player', sourceId: source.id, sourceExtractor: 'flyflix' }] });
    const requests = (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request);
    expect(requests.map(request => request.url.pathname)).toEqual(['/', '/assets/index-DoTJAeIv.js', '/3/search/multi']);
    expect(requests.at(-1)?.headers).toEqual({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJmaXh0dXJlIn0.fixture' });
    expect(hosts.vidbolt.discover).toHaveBeenCalledWith(movie, new URL('https://vidbolt.test/movie/27205'), source.id, 'flyflix', services, expect.any(AbortSignal));
    expect(hosts.cinezo.discover).toHaveBeenCalledWith(movie, new URL('https://player.cinezo.test/embed/movie/27205'), source.id, 'flyflix', services, expect.any(AbortSignal));
    expect(hosts.vidlove.discover).toHaveBeenCalledWith(movie, new URL('https://player.vidlove.test/embed/movie/27205'), source.id, 'flyflix', services, expect.any(AbortSignal));
  });

  test('verifies the requested later-season episode without comparing its release year with the premiere', async () => {
    const hosts = hostsFor();
    const services = servicesFor();
    await expect(new FlyflixFamily(hosts.vidlove, hosts.cinezo, hosts.vidbolt).discoverMedia({ ...episode, year: 2013 }, source, services, signal)).resolves.toMatchObject({ type: 'streams' });
    const requests = (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request);
    expect(requests.at(-1)?.url.href).toBe('https://api.themoviedb.org/3/tv/1396/season/5?language=en-US');
    expect(hosts.vidbolt.discover).toHaveBeenCalledWith(expect.objectContaining({ season: 5, episode: 16 }), new URL('https://vidbolt.test/tv/1396/5/16'), source.id, 'flyflix', services, expect.any(AbortSignal));
  });

  test.each([{ ...episode, season: 99 }, { ...episode, episode: 99 }])('does not delegate an unavailable episode (season $season, episode $episode)', async (media) => {
    const hosts = hostsFor();
    await expect(new FlyflixFamily(hosts.vidlove, hosts.cinezo, hosts.vidbolt).discoverMedia(media, source, servicesFor(), signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(hosts.vidbolt.discover).not.toHaveBeenCalled();
  });

  test.each([
    { ...movie, title: 'FMHY Extractability Probe 7b18e49a', tmdbId: 2147483647, year: 1874 },
    { ...movie, tmdbId: 1 },
    { ...movie, year: 1980 },
    { ...movie, type: 'episode' as const, season: 1, episode: 1 },
  ])('does not delegate when the catalog identifies a different title, ID, type, or movie year', async (media) => {
    const hosts = hostsFor();
    await expect(new FlyflixFamily(hosts.vidlove, hosts.cinezo, hosts.vidbolt).discoverMedia(media, source, servicesFor(), signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(hosts.vidbolt.discover).not.toHaveBeenCalled();
  });

  test('keeps the available streams when another configured player has none', async () => {
    const hosts = hostsFor(jest.fn(empty));
    (hosts.cinezo.discover as jest.Mock).mockImplementation(async (_media, _player, sourceId: string, sourceExtractor: string): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL('https://native.test/movie.mp4'), protocol: 'http', sourceId, sourceExtractor, hostExtractor: 'cinezo-player', discoveredAt: new Date(0) }] }));
    await expect(new FlyflixFamily(hosts.vidlove, hosts.cinezo, hosts.vidbolt).discoverMedia(movie, source, servicesFor(), signal)).resolves.toMatchObject({ type: 'streams', streams: [{ hostExtractor: 'cinezo-player' }] });
  });

  test('rethrows a player transport failure when no player returns streams', async () => {
    const failure = new TransportFailure({ code: 'HTTP_FORBIDDEN', message: 'Forbidden', stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
    const hosts = hostsFor(jest.fn(async () => { throw failure; }));
    await expect(new FlyflixFamily(hosts.vidlove, hosts.cinezo, hosts.vidbolt).discoverMedia(movie, source, servicesFor(), signal)).rejects.toBe(failure);
  });

  test('ignores a player whose URL is declared but absent from the application server list', async () => {
    const hosts = hostsFor();
    const client = fixture('client.txt').replace('{id:"vidbolt"},', '');
    await expect(new FlyflixFamily(hosts.vidlove, hosts.cinezo, hosts.vidbolt).discoverMedia(movie, source, servicesFor({ 'client.txt': client }), signal)).resolves.toMatchObject({ type: 'empty', reason: 'no-streams' });
    expect(hosts.vidbolt.discover).not.toHaveBeenCalled();
  });

  test('reports a changed application when its catalog or players are no longer declared', async () => {
    const hosts = hostsFor();
    await expect(new FlyflixFamily(hosts.vidlove, hosts.cinezo, hosts.vidbolt).discoverMedia(movie, source, servicesFor({ 'client.txt': 'const nothing = 1;' }), signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', familyId: 'flyflix' } });
    expect(hosts.vidbolt.discover).not.toHaveBeenCalled();
  });
});
