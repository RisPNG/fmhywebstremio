import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HlsRelay } from '../../addon/stremio-adapter/hls-relay';
import { RuntimeStremioAdapter } from '../../addon/stremio-adapter/runtime-adapter';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices, StreamEngine } from '../../engine/core/models';
import { StreamSelector } from '../../engine/protocols';
import type { Context } from '../../types';
import { VidloveApiHostArchitecture } from './vidlove-host-architecture';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/vidlove/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('Vidlove host architecture', () => {
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 };

  test.each([movie, episode])('keeps every native quality and relays the required player referrer for $canonicalId', async (media) => {
    const player = new URL(media.type === 'movie' ? 'https://player.vidlove.test/embed/movie/27205' : 'https://player.vidlove.test/embed/tv/1396/1/1');
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname === player.hostname) return response(request.url, fixture('player.html'));
      if (request.url.hostname === 'api.vidlove.test') return response(request.url, request.url.searchParams.get('sources') === 'moviebox' ? fixture(media.type === 'movie' ? 'movie.json' : 'episode.json') : '{"meta":{},"subtitles":[],"source":null}');
      expect(request.method).toBe('HEAD');
      expect(request.headers).toEqual({ referer: 'https://player.vidlove.test/' });
      return { ...response(request.url, ''), headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes', 'content-length': '2414667149' } };
    }) };
    const signal = new AbortController().signal;
    const result = await new VidloveApiHostArchitecture().discover(media, player, '67movies:catalog.test', 'sixty-seven-movies', services, signal);
    if (result.type !== 'streams') throw new Error('Expected Vidlove streams');
    expect(result.streams).toHaveLength(media.type === 'movie' ? 2 : 5);
    expect(result.streams.every(stream => stream.protocol === 'http' && stream.delivery === 'relayed' && stream.headers?.['referer'] === 'https://player.vidlove.test/')).toBe(true);
    if (media.type === 'episode') expect(result.streams.map(stream => stream.declaredResolution?.height)).toEqual([undefined, 1080, 720, 480, 360]);
    const apiRequests = (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request).filter(request => request.url.hostname === 'api.vidlove.test');
    expect(apiRequests.map(request => request.url.searchParams.get('sources'))).toEqual(['dcloud', 'moviebox2', 'moviebox']);
    for (const request of apiRequests) {
      expect(request.url.searchParams.get('id')).toBe(String(media.tmdbId));
      expect(request.url.searchParams.get('mode')).toBe('json');
      if (media.type === 'episode') expect([request.url.searchParams.get('season'), request.url.searchParams.get('episode')]).toEqual(['1', '1']);
    }
    const validated = await new StreamSelector(services).validate(result.streams, { concurrency: 3 }, signal);
    expect(validated.failures).toEqual([]);
    expect(validated.streams).toHaveLength(result.streams.length);
    const relay = new HlsRelay();
    const engine: StreamEngine = { findStreams: jest.fn(async () => ({ streams: validated.streams, failures: [], unverified: [], deadline: { budgetMs: 1, elapsedMs: 1, exceeded: false, sourcesAttempted: 1, sourcesCompleted: 1, sourcesCancelled: 0 } })) };
    const exposed = await new RuntimeStremioAdapter(engine, relay).findStreams({ config: {}, hostUrl: new URL('https://addon.test/') } as Context, media.type === 'movie' ? 'movie' : 'series', media.type === 'movie' ? 'tmdb:27205' : 'tmdb:1396:1:1');
    const relayUrl = new URL(exposed.streams[0]?.url as string);
    const parts = relayUrl.pathname.split('/');
    expect(relay.resolveTarget(parts.at(-3) as string, parts.at(-2) as string)).toEqual({ url: validated.streams[0]?.url, headers: { referer: 'https://player.vidlove.test/' } });
  });

  test('keeps working providers when another startup source fails', async () => {
    const services: RequestServices = { request: jest.fn(async (request) => {
      if (request.url.hostname === 'player.vidlove.test') return response(request.url, fixture('player.html'));
      if (request.url.searchParams.get('sources') === 'dcloud') throw new Error('Provider unavailable');
      return response(request.url, request.url.searchParams.get('sources') === 'moviebox' ? fixture('movie.json') : '{"source":null}');
    }) };
    await expect(new VidloveApiHostArchitecture().discover(movie, new URL('https://player.vidlove.test/embed/movie/27205'), 'source', 'family', services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams' });
  });

  test('preserves a mixed-case API referrer without combining it with the player default', async () => {
    const payload = JSON.parse(fixture('movie.json')) as { source: { headers?: Record<string, string> } };
    payload.source.headers = { 'Referer': 'https://upstream.test/', 'User-Agent': 'player-agent' };
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.hostname === 'player.vidlove.test' ? fixture('player.html') : JSON.stringify(payload))) };
    const result = await new VidloveApiHostArchitecture().discover(movie, new URL('https://player.vidlove.test/embed/movie/27205'), 'source', 'family', services, new AbortController().signal);
    if (result.type !== 'streams') throw new Error('Expected Vidlove streams');
    for (const stream of result.streams) {
      expect(stream.headers).toEqual({ 'referer': 'https://upstream.test/', 'user-agent': 'player-agent' });
      expect(new Headers(stream.headers).get('referer')).toBe('https://upstream.test/');
    }
  });

  test.each([
    { media: movie, meta: { id: 999 } },
    { media: episode, meta: { id: 62085, season_number: 2, episode_number: 1 } },
    { media: episode, meta: { id: 62085, season_number: 1, episode_number: 2 } },
  ])('rejects a different movie or episode in the playback response', async ({ media, meta }) => {
    const player = new URL(media.type === 'movie' ? 'https://player.vidlove.test/embed/movie/27205' : 'https://player.vidlove.test/embed/tv/1396/1/1');
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.hostname === player.hostname ? fixture('player.html') : JSON.stringify({ meta, source: { url: 'https://media.test/wrong.mp4' } }))) };
    await expect(new VidloveApiHostArchitecture().discover(media, player, 'source', 'family', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED' } });
  });

  test('does not invent startup sources when the player no longer declares them', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, fixture('player.html').replaceAll('preFor(', 'other('))) };
    await expect(new VidloveApiHostArchitecture().discover(movie, new URL('https://player.vidlove.test/embed/movie/27205'), 'source', 'family', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED' } });
    expect(services.request).toHaveBeenCalledTimes(1);
  });
});
