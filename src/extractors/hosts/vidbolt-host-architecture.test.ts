import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices } from '../../engine/core/models';
import { StreamSelector } from '../../engine/protocols';
import { TransportFailure } from '../../engine/transport/transport-director';
import { VidBoltPlayerHostArchitecture } from './vidbolt-host-architecture';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/vidbolt/${name}`), 'utf8');
const response = (url: URL, body: string, contentType = 'text/html'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('VidBolt native player architecture', () => {
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 };
  const anime: MediaIdentity = { canonicalId: 'tmdb:1429:1:1', type: 'episode', tmdbId: 1429, title: 'Attack on Titan', year: 2013, season: 1, episode: 1 };

  test.each([{ media: movie, page: 'movie-player.html' }, { media: episode, page: 'episode-player.html' }])('follows the configured resolver for $media.canonicalId', async ({ media, page }) => {
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.pathname === '/api/resolve') {
        expect(request.url.searchParams.get('type')).toBe(media.type === 'movie' ? 'movie' : 'tv');
        expect(request.url.searchParams.get('id')).toBe(String(media.tmdbId));
        if (media.type === 'episode') expect(request.url.searchParams.get('season')).toBe('5');
        expect(request.referrer?.hostname).toBe('player.test');
        return response(request.url, request.url.searchParams.get('only') === 'orion' ? fixture('movie.json') : '{"stream":null}', 'application/json');
      }
      return response(request.url, fixture(page));
    }) };
    const result = await new VidBoltPlayerHostArchitecture().discover(media, new URL('https://player.test/advertised-player'), 'source', 'family', services, new AbortController().signal);
    expect(result).toMatchObject({ type: 'streams', streams: [{ protocol: 'hls', delivery: 'relayed', hostExtractor: 'vidbolt-player', headers: { referer: 'https://player.test/' } }] });
    expect((services.request as jest.Mock).mock.calls.slice(1).map(([request]: [ExtractionRequest]) => request.url.searchParams.get('only'))).toEqual(['orion', 'callisto']);
  });

  test('offers native server alternatives when the default source has no audio', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname === '/api/resolve' ? fixture(request.url.searchParams.get('only') === 'orion' ? 'movie.json' : 'movie-alternative.json') : fixture('movie-player.html'))) };
    const result = await new VidBoltPlayerHostArchitecture().discover(movie, new URL('https://player.test/movie/27205'), 'source', 'family', services, new AbortController().signal);
    expect(result).toMatchObject({ type: 'streams', streams: [{ protocol: 'hls' }, { protocol: 'hls', language: 'English', declaredResolution: { height: 1080 } }, { protocol: 'http', language: 'Russian' }] });
    if (result.type !== 'streams') throw new Error('Expected VidBolt server choices');
    expect(result.streams.map(stream => stream.url.hostname)).toEqual(['media.test', 'bridge.test', 'proxy.test']);
  });

  test('preserves resolved server choices when a sibling reaches the discovery deadline', async () => {
    const controller = new AbortController();
    const services: RequestServices = { request: jest.fn(async (request, signal) => {
      if (request.url.searchParams.get('only') === 'callisto') return new Promise<ExtractionResponse>((_resolve, reject) => signal.addEventListener('abort', () => reject(new TransportFailure({ code: 'TIMEOUT', message: 'Discovery deadline', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } })), { once: true }));
      return response(request.url, request.url.pathname === '/api/resolve' ? fixture('movie.json') : fixture('movie-player.html'));
    }) };
    const pending = new VidBoltPlayerHostArchitecture().discover(movie, new URL('https://player.test/movie/27205'), 'source', 'family', services, controller.signal);
    const timer = setTimeout(() => controller.abort(), 10);
    try {
      await expect(pending).resolves.toMatchObject({ type: 'streams', streams: [{ url: new URL('https://media.test/movie/master.m3u8') }] });
    } finally {
      clearTimeout(timer);
    }
  });

  test('preserves every declared source so a broken first anime variant does not suppress playable media', async () => {
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname === 'player.test') return response(request.url, request.url.pathname === '/api/resolve' ? request.url.searchParams.get('only') === 'callisto' ? fixture('anime.json') : '{"stream":null}' : fixture('anime-player.html'));
      if (request.url.hostname === 'dead.test') throw new TransportFailure({ code: 'HTTP_NOT_FOUND', message: 'Missing variant', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      if (request.method === 'HEAD') return response(request.url, '', 'video/mp4');
      if (request.expectedContent === 'binary') return response(request.url, 'fixture-segment', 'video/mp2t');
      return response(request.url, '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST', 'application/vnd.apple.mpegurl');
    }) };
    const signal = new AbortController().signal;
    const result = await new VidBoltPlayerHostArchitecture().discover(anime, new URL('https://player.test/tv/1429/1/1'), 'source', 'family', services, signal);
    if (result.type !== 'streams') throw new Error('Expected VidBolt streams');
    expect(result.streams).toHaveLength(3);
    expect(result.streams.map(stream => [stream.protocol, stream.language])).toEqual([['hls', 'Tamil'], ['hls', 'Japanese'], ['http', 'Russian']]);
    const validation = await new StreamSelector(services).validate(result.streams, { concurrency: 2 }, signal);
    expect(validation.streams).toHaveLength(2);
    expect(validation.streams).toEqual(expect.arrayContaining([expect.objectContaining({ protocol: 'hls', language: 'Japanese', validation: 'validated' }), expect.objectContaining({ protocol: 'http', validation: 'validated' })]));
    expect(validation.failures).toMatchObject([{ code: 'HTTP_NOT_FOUND' }]);
  });

  test.each([
    { media: { ...movie, tmdbId: 1 }, page: 'movie-player.html' },
    { media: { ...movie, year: 2009 }, page: 'movie-player.html' },
    { media: { ...movie, title: 'Interstellar' }, page: 'movie-player.html' },
    { media: { ...episode, season: 1 }, page: 'episode-player.html' },
    { media: { ...episode, episode: 15 }, page: 'episode-player.html' },
  ])('does not resolve a player with a different identity', async ({ media, page }) => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, fixture(page))) };
    await expect(new VidBoltPlayerHostArchitecture().discover(media, new URL('https://player.test/'), 'source', 'family', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED' } });
    expect(services.request).toHaveBeenCalledTimes(1);
  });

  test('checks the declared resolver query separately from the page identity', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, fixture('movie-player.html').replace('var q="type=movie&id=27205"', 'var q="type=movie&id=1"'))) };
    await expect(new VidBoltPlayerHostArchitecture().discover(movie, new URL('https://player.test/'), 'source', 'family', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED' } });
    expect(services.request).toHaveBeenCalledTimes(1);
  });

  test.each([{ stream: null }, { stream: { server: 'orion', sources: [] } }])('reports a native unavailable stream as empty', async (payload) => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname === '/api/resolve' ? JSON.stringify(request.url.searchParams.get('only') === 'orion' ? payload : { stream: null }) : fixture('movie-player.html'))) };
    await expect(new VidBoltPlayerHostArchitecture().discover(movie, new URL('https://player.test/movie/27205'), 'source', 'family', services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
  });

  test('rejects a response that does not honor the selected native server', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname === '/api/resolve' ? JSON.stringify({ stream: { server: 'unadvertised', sources: [{ url: 'https://media.test/wrong.m3u8', kind: 'hls' }] } }) : fixture('movie-player.html'))) };
    await expect(new VidBoltPlayerHostArchitecture().discover(movie, new URL('https://player.test/movie/27205'), 'source', 'family', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED' } });
  });

  test('does not advertise protocols unsupported by its header-bound delivery', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname === '/api/resolve' ? JSON.stringify({ stream: { server: request.url.searchParams.get('only'), sources: [{ url: 'https://media.test/manifest.mpd', kind: 'dash' }] } }) : fixture('movie-player.html'))) };
    await expect(new VidBoltPlayerHostArchitecture().discover(movie, new URL('https://player.test/movie/27205'), 'source', 'family', services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
  });
});
