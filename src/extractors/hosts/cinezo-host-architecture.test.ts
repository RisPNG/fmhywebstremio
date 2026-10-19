import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HlsRelay } from '../../addon/stremio-adapter/hls-relay';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices } from '../../engine/core/models';
import { StreamSelector } from '../../engine/protocols';
import { TransportFailure } from '../../engine/transport/transport-director';
import { CinezoPlayerHostArchitecture } from './cinezo-host-architecture';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cinezo/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('Cinezo native player architecture', () => {
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 };
  const laterEpisode: MediaIdentity = { ...episode, canonicalId: 'tmdb:1396:5:16', season: 5, episode: 16 };

  test.each([{ media: movie, name: 'movie.json' }, { media: episode, name: 'episode.json' }, { media: laterEpisode, name: 'later-episode.json' }])('follows the declared native endpoint and relays the player referrer for $media.canonicalId', async ({ media, name }) => {
    const mediaPath = media.type === 'movie' ? `movie/${media.tmdbId}` : `tv/${media.tmdbId}/${media.season}/${media.episode}`;
    const player = new URL(`/embed/${mediaPath}`, 'https://player.cinezo.test/');
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.pathname.startsWith('/embed/')) return response(request.url, fixture('player.html'));
      if (request.url.pathname.endsWith('.js')) return response(request.url, fixture('player-client.txt'));
      if (request.url.pathname.endsWith('.json')) {
        expect(request.url).toEqual(new URL(`https://native.cinezo.test/${mediaPath}.json`));
        expect(request.referrer).toEqual(player);
        return response(request.url, fixture(name));
      }
      expect(request.method).toBe('HEAD');
      expect(request.headers).toEqual({ referer: 'https://player.cinezo.test/' });
      return { ...response(request.url, ''), headers: { 'content-type': 'video/quicktime', 'accept-ranges': 'bytes' } };
    }) };
    const signal = new AbortController().signal;
    const result = await new CinezoPlayerHostArchitecture().discover(media, player, 'source', 'family', services, signal);
    expect(result).toMatchObject({ type: 'streams', streams: [{ protocol: 'http', delivery: 'relayed', declaredResolution: { width: 1920, height: 1080 }, headers: { referer: 'https://player.cinezo.test/' }, hostExtractor: 'cinezo-player' }] });
    if (result.type !== 'streams') throw new Error('Expected Cinezo streams');
    const validation = await new StreamSelector(services).validate(result.streams, { concurrency: 1 }, signal);
    expect(validation.streams).toMatchObject([{ validation: 'validated', resolution: { width: 1920, height: 1080 } }]);
    expect(validation.failures).toEqual([]);
    const relay = new HlsRelay();
    const stream = result.streams[0];
    if (!stream) throw new Error('Expected Cinezo stream');
    const url = relay.createUrl(new URL('https://addon.test/'), stream.url, stream.headers);
    const parts = url.pathname.split('/');
    expect(relay.resolveTarget(parts.at(-3) as string, parts.at(-2) as string)).toEqual({ url: stream.url, headers: { referer: 'https://player.cinezo.test/' } });
  });

  test('uses the native HLS stream when the original container cannot play directly', async () => {
    const payload = JSON.parse(fixture('movie.json')) as { direct_playable: boolean };
    payload.direct_playable = false;
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname.startsWith('/embed/') ? fixture('player.html') : request.url.pathname.endsWith('.js') ? fixture('player-client.txt') : JSON.stringify(payload))) };
    await expect(new CinezoPlayerHostArchitecture().discover(movie, new URL('https://player.cinezo.test/embed/movie/27205'), 'source', 'family', services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams', streams: [{ url: new URL('https://native.cinezo.test/p/inception/master.m3u8'), protocol: 'hls' }] });
  });

  test.each([{ media: movie, changes: { title: 'Interstellar' } }, { media: movie, changes: { year: 2009 } }, { media: episode, changes: { series: 'Better Call Saul' } }, { media: episode, changes: { season: 2 } }, { media: laterEpisode, changes: { episode: 15 } }])('rejects playback for a different movie or episode', async ({ media, changes }) => {
    const payload = { ...JSON.parse(fixture(media.type === 'movie' ? 'movie.json' : media.season === 5 ? 'later-episode.json' : 'episode.json')) as object, ...changes };
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname.startsWith('/embed/') ? fixture('player.html') : request.url.pathname.endsWith('.js') ? fixture('player-client.txt') : JSON.stringify(payload))) };
    const path = media.type === 'movie' ? 'movie/27205' : `tv/1396/${media.season}/${media.episode}`;
    await expect(new CinezoPlayerHostArchitecture().discover(media, new URL(`https://player.cinezo.test/embed/${path}`), 'source', 'family', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED' } });
  });

  test('does not invent an endpoint for a provider removed from the player', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname.startsWith('/embed/') ? fixture('player.html') : fixture('player-client.txt').replace('id:"jennifer"', 'id:"removed"'))) };
    await expect(new CinezoPlayerHostArchitecture().discover(movie, new URL('https://player.cinezo.test/embed/movie/27205'), 'source', 'family', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED' } });
    expect(services.request).toHaveBeenCalledTimes(2);
  });

  test('reports an unavailable native title as absent', async () => {
    const services: RequestServices = { request: jest.fn(async (request) => {
      if (request.url.pathname.endsWith('.json')) throw new TransportFailure({ code: 'HTTP_NOT_FOUND', message: 'Not found', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      return response(request.url, request.url.pathname.startsWith('/embed/') ? fixture('player.html') : fixture('player-client.txt'));
    }) };
    await expect(new CinezoPlayerHostArchitecture().discover(movie, new URL('https://player.cinezo.test/embed/movie/27205'), 'source', 'family', services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
  });
});
