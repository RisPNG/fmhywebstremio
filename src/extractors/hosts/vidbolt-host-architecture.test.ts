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
        return response(request.url, fixture('movie.json'), 'application/json');
      }
      return response(request.url, fixture(page));
    }) };
    const result = await new VidBoltPlayerHostArchitecture().discover(media, new URL('https://player.test/advertised-player'), 'source', 'family', services, new AbortController().signal);
    expect(result).toMatchObject({ type: 'streams', streams: [{ protocol: 'hls', delivery: 'relayed', hostExtractor: 'vidbolt-player', headers: { referer: 'https://player.test/' } }] });
  });

  test('preserves every declared source so a broken first anime variant does not suppress playable media', async () => {
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname === 'player.test') return response(request.url, request.url.pathname === '/api/resolve' ? fixture('anime.json') : fixture('anime-player.html'));
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
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname === '/api/resolve' ? JSON.stringify(payload) : fixture('movie-player.html'))) };
    await expect(new VidBoltPlayerHostArchitecture().discover(movie, new URL('https://player.test/movie/27205'), 'source', 'family', services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
  });
});
