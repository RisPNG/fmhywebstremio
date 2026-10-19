import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, MediaIdentity, RequestServices } from '../../engine/core/models';
import { TransportFailure } from '../../engine/transport/transport-director';
import { XpassPlayerHostArchitecture } from './xpass-host-architecture';

describe('Xpass player architecture', () => {
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:1429:2:1', type: 'episode', tmdbId: 1429, title: 'Attack on Titan', year: 2013, season: 2, episode: 1 };
  let fixtures: Record<string, string>;
  let services: RequestServices;

  beforeEach(() => {
    fixtures = Object.fromEntries(['player-movie.html', 'player-episode.html', 'loader.txt', 'client.txt', 'servers-movie.txt', 'servers-episode.txt', 'playlist-hls.json', 'playlist-mp4.json'].map(name => [name, readFileSync(resolve(__dirname, '../__fixtures__/xpass', name), 'utf8')]));
    services = { request: jest.fn(async (request: ExtractionRequest) => {
      const path = request.url.pathname;
      if (path === '/mdata/missing/0/playlist.json') throw new TransportFailure({ code: 'HTTP_NOT_FOUND', message: 'Unavailable native server', stage: 'stage:transport', targetHost: 'player.test', observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      const name = path.startsWith('/e/')
        ? `player-${path.includes('/movie/') ? 'movie' : 'episode'}.html`
        : path.startsWith('/data/')
          ? `servers-${path.includes('/movie/') ? 'movie' : 'episode'}.txt`
          : path === '/static/mainmini.js'
            ? 'loader.txt'
            : path.startsWith('/static/')
              ? 'client.txt'
              : path.includes('/progressive/') ? 'playlist-mp4.json' : 'playlist-hls.json';
      const body = fixtures[name] as string;
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
  });

  test.each([movie, episode])('authenticates the requested media envelope and publishes the native servers for $canonicalId', async (media) => {
    const player = new URL(media.type === 'movie' ? 'https://player.test/e/movie/27205' : 'https://player.test/e/tv/1429/2/1');
    const result = await new XpassPlayerHostArchitecture().discover(media, player, 'anicine:catalog.test', 'anicine', services, new AbortController().signal);
    expect(result).toMatchObject({ type: 'streams', streams: [
      { url: new URL('https://cdn.test/master.m3u8'), protocol: 'hls', delivery: 'relayed', headers: { referer: 'https://player.test/' }, sourceId: 'anicine:catalog.test', sourceExtractor: 'anicine', hostExtractor: 'xpass-player', subtitles: [{ url: new URL('https://subs.test/english.vtt'), label: 'English', language: 'en' }] },
      { url: new URL('https://cdn.test/video.mp4'), protocol: 'http', delivery: 'relayed' },
    ] });
    if (result.type === 'streams') expect(result.streams[0]?.subtitles).toHaveLength(1);
    const requests = (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request);
    expect(requests.map(request => request.url.pathname)).toContain('/static/MwkxhpxZvl.js');
    expect(requests.filter(request => request.url.pathname.startsWith('/mdata/'))).toHaveLength(3);
    expect(requests.slice(1).every(request => request.referrer?.href === player.href)).toBe(true);
  });

  test.each([
    ['player-movie.html', (body: string) => body.replace('/data/movie/27205', '/data/movie/1'), 'RESULT_MAPPING_FAILED'],
    ['player-movie.html', (body: string) => body.replace('/static/mainmini.js', '/static/changed.js'), 'PAGE_STRUCTURE_CHANGED'],
    ['loader.txt', () => 'unrelated loader', 'PAGE_STRUCTURE_CHANGED'],
    ['client.txt', () => 'unrelated player', 'PAGE_STRUCTURE_CHANGED'],
    ['servers-movie.txt', (body: string) => body.slice(0, -6), 'RESPONSE_SCHEMA_CHANGED'],
    ['servers-movie.txt', () => 'invalid envelope', 'RESPONSE_SCHEMA_CHANGED'],
  ] as const)('rejects a changed or mismatched %s', async (fixture, transform, code) => {
    fixtures[fixture] = transform(fixtures[fixture] as string);
    await expect(new XpassPlayerHostArchitecture().discover(movie, new URL('https://player.test/e/movie/27205'), 'anicine:catalog.test', 'anicine', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code } });
    expect((services.request as jest.Mock).mock.calls.some(([request]: [ExtractionRequest]) => request.url.pathname.startsWith('/mdata/'))).toBe(false);
  });

  test('does not publish an empty or changed native server playlist', async () => {
    fixtures['playlist-hls.json'] = '{}';
    fixtures['playlist-mp4.json'] = '[]';
    await expect(new XpassPlayerHostArchitecture().discover(movie, new URL('https://player.test/e/movie/27205'), 'anicine:catalog.test', 'anicine', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', diagnostic: { parserPath: 'playlist' } } });
  });

  test('preserves the player no-referrer policy for its declared media host', async () => {
    fixtures['playlist-hls.json'] = (fixtures['playlist-hls.json'] as string).replaceAll('cdn.test', 'bcdn.hakunaymatata.com');
    const result = await new XpassPlayerHostArchitecture().discover(movie, new URL('https://player.test/e/movie/27205'), 'anicine:catalog.test', 'anicine', services, new AbortController().signal);
    expect(result.type).toBe('streams');
    if (result.type === 'streams') {
      expect(result.streams[0]?.headers).toBeUndefined();
      expect(result.streams[1]?.headers).toEqual({ referer: 'https://player.test/' });
    }
  });
});
