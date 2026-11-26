import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { AtlanticFamily } from './atlantic-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/atlantic/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), durationMs: 0 } } as unknown as ExtractionResponse);
const failure = (code: 'HTTP_NOT_FOUND' | 'HTTP_SERVER_ERROR', url: URL) => new TransportFailure({ code, message: code, stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, finalUrl: url.href } } as never);

describe('Atlantic source family', () => {
  const source: SourceRecord = { id: 'atlantic:atlantic.bz', canonicalDomain: 'atlantic.bz', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 };
  const signal = new AbortController().signal;
  const servicesFor = (overrides: Readonly<Record<string, string | TransportFailure>> = {}): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => {
    const endpoint = `${request.url.hostname}${request.url.pathname}`;
    const media = request.url.searchParams.get('type') === 'tv' ? 'episode' : 'movie';
    const defaults: Readonly<Record<string, string>> = {
      'db.hls.lol/3/movie/27205': fixture('movie-inception.json'),
      'db.hls.lol/3/tv/1396': fixture('tv-breaking-bad.json'),
      'db.hls.lol/3/tv/1396/season/1': fixture('season-breaking-bad-1.json'),
      'stream.hls.lol/vidbox': fixture(`vidbox-${media}.json`),
      ...(media === 'episode' && { 'stream.hls.lol/play4u': fixture('play4u-episode.json') }),
      ...(media === 'movie' && { 'stream.hls.lol/q62': fixture('q62-movie.json') }),
      'shegu.hls.lol/resolve/movie/27205': fixture('shegu-movie.json'),
      'shegu.hls.lol/resolve/tv/1/1/1396': fixture('shegu-episode.json'),
      'it.hls.lol/resolve': fixture(`vixsrc-${media}.json`),
      'pal.hls.lol/resolve': fixture(`dizipal-${media}.json`),
    };
    const body = overrides[endpoint] ?? defaults[endpoint] ?? failure('HTTP_NOT_FOUND', request.url);
    if (body instanceof TransportFailure) throw body;
    return response(request.url, body);
  }) });
  const requested = (services: RequestServices) => (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request);

  test('requires the declared Atlantic identity and Vite client assets', () => {
    const family = new AtlanticFamily();
    const html = fixture('home.html');
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://atlantic.bz/'), status: 200, headers: {}, htmlSample: html, assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: 'atlantic', confidence: 1 });
    for (const altered of [html.replace('content="Atlantic"', 'content="Other"'), html.replace('<title>Atlantic', '<title>Other'), html.replace('/assets/index-', '/static/')]) expect(family.classify(source, { ...snapshot, htmlSample: altered })).toBeNull();
  });

  test('relays the playlist of every provider that answers for a movie', async () => {
    const services = servicesFor();
    const result = await new AtlanticFamily().discoverMedia(movie, source, services, signal);
    if (result.type !== 'streams') throw new Error('Expected Atlantic streams');
    expect(result.streams.map(stream => stream.hostExtractor)).toEqual(['vidbox-api', 'q62-api', 'shegu-api', 'vixsrc-api', 'dizipal-api']);
    expect(result.streams.every(stream => stream.protocol === 'hls' && stream.delivery === 'relayed' && stream.sourceId === source.id && stream.sourceExtractor === 'atlantic')).toBe(true);
    expect(result.streams.map(stream => stream.url.hostname)).toEqual(['edge-02.transcode.cfd', 'proxy.7movie.ws', 'shegu.hls.lol', 'route.transcode.cfd', 'route.transcode.cfd']);
    expect(result.streams[0]?.headers).toEqual({ origin: 'https://atlantic.bz', referer: 'https://atlantic.bz/' });
    expect(requested(services).map(request => `${request.url.hostname}${request.url.pathname}`)).toEqual(['db.hls.lol/3/movie/27205', 'stream.hls.lol/vidbox', 'stream.hls.lol/play4u', 'stream.hls.lol/q62', 'shegu.hls.lol/resolve/movie/27205', 'it.hls.lol/resolve', 'pal.hls.lol/resolve']);
    expect(Object.fromEntries(requested(services).at(-1)?.url.searchParams ?? [])).toEqual({ tmdbId: '27205', type: 'movie', title: 'Inception', year: '2010' });
  });

  test('checks the requested season and episode against the catalog before asking providers', async () => {
    const services = servicesFor();
    const result = await new AtlanticFamily().discoverMedia(episode, source, services, signal);
    if (result.type !== 'streams') throw new Error('Expected Atlantic episode streams');
    expect(result.streams.map(stream => stream.hostExtractor)).toEqual(['vidbox-api', 'play4u-api', 'shegu-api', 'vixsrc-api', 'dizipal-api']);
    expect(result.streams[1]?.url.hostname).toBe('totallyacdn.cc');
    const calls = requested(services);
    expect(calls.slice(0, 2).map(request => request.url.pathname)).toEqual(['/3/tv/1396', '/3/tv/1396/season/1']);
    expect(calls.map(request => request.url.pathname)).toContain('/resolve/tv/1/1/1396');
    expect(Object.fromEntries(calls.at(-1)?.url.searchParams ?? [])).toEqual({ tmdbId: '1396', type: 'tv', seasonId: '1', episodeId: '1', title: 'Breaking Bad', year: '2008' });
  });

  test('keeps absent or mismatched titles and episodes from reaching the providers', async () => {
    for (const media of [{ ...movie, title: 'Another Title' }, { ...movie, year: 1999 }, { ...movie, tmdbId: 2147483647 }, { ...episode, episode: 99 }, { ...episode, season: 2 }, { ...episode, season: 0 }]) {
      const services = servicesFor();
      await expect(new AtlanticFamily().discoverMedia(media, source, services, signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
      expect(requested(services).every(request => request.url.hostname === 'db.hls.lol')).toBe(true);
    }
  });

  test('uses the providers that answer when another fails', async () => {
    const services = servicesFor({ 'stream.hls.lol/q62': failure('HTTP_SERVER_ERROR', new URL('https://stream.hls.lol/q62')), 'shegu.hls.lol/resolve/movie/27205': failure('HTTP_NOT_FOUND', new URL('https://shegu.hls.lol/resolve/movie/27205')) });
    const result = await new AtlanticFamily().discoverMedia(movie, source, services, signal);
    if (result.type !== 'streams') throw new Error('Expected Atlantic streams');
    expect(result.streams.map(stream => stream.hostExtractor)).toEqual(['vidbox-api', 'vixsrc-api', 'dizipal-api']);
  });

  test('reports no streams when no provider declares a playlist', async () => {
    await expect(new AtlanticFamily().discoverMedia(movie, source, servicesFor({ 'stream.hls.lol/vidbox': '{"sources":{}}', 'stream.hls.lol/q62': '{"releases":[]}', 'shegu.hls.lol/resolve/movie/27205': '{"found":false}', 'it.hls.lol/resolve': '{"found":false}', 'pal.hls.lol/resolve': '{"found":false}' }), signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
  });
});
