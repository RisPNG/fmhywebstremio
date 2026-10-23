import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices } from '../../engine/core/models';
import { TransportFailure } from '../../engine/transport/transport-director';
import { VidsparkApiHostArchitecture } from './vidspark-host-architecture';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/vidspark/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });
const httpFailure = (code: 'HTTP_NOT_FOUND' | 'HTTP_SERVER_ERROR') => new TransportFailure({ code, message: 'Fixture failure', stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });

describe('VidSpark host architecture', () => {
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const laterEpisode: MediaIdentity = { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 };
  const services = (api: (request: ExtractionRequest) => ExtractionResponse): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => {
    const url = request.url.hostname === 'moviesapi.to' && /^\/tv\/\d+-\d+-\d+$/.test(request.url.pathname) ? new URL(`${request.url.pathname.replaceAll('-', '/')}${request.url.search}`, request.url) : request.url;
    if (url.pathname.startsWith('/api/vidora/')) return api({ ...request, url });
    if (url.hostname === 'player.moviesapi.vip') return response(url, '<!doctype html><html><head><title>Moviesapi</title><script defer src="https://umami.vidflix.club/script.js"></script></head><body></body></html>');
    if (url.pathname === '/assets/index-DAW8kWjR.js') return response(url, fixture('moviesapi-client.txt'));
    if (url.pathname === '/assets/main-CJeU4wHt.js') return response(url, fixture('cdn-client.txt'));
    if (url.pathname.startsWith('/assets/')) return response(url, 'export const fixture=1;');
    return response(url, fixture(url.hostname === 'moviesapi.to' ? 'moviesapi-player.html' : 'cdn-player.html'));
  }) });
  const apiRequests = (requestServices: RequestServices) => (requestServices.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request).filter(request => request.url.pathname.startsWith('/api/vidora/'));

  test.each(['/proxy', '/', '/p1/proxy'])('follows the declared fallback player and upstream declared by a media proxy at %s', async (proxyPath) => {
    const requestServices = services((request) => {
      if (request.url.hostname === 'moviesapi.to') throw httpFailure('HTTP_NOT_FOUND');
      if (request.url.searchParams.get('source') === 'scrapify') {
        const payload = JSON.parse(fixture('cdn-movie-scrapify.json')) as { sources: { url: string }[] };
        const stream = payload.sources[0];
        if (!stream) throw new Error('Expected fixture stream');
        const proxy = new URL(stream.url);
        proxy.pathname = proxyPath;
        stream.url = proxy.href;
        return response(request.url, JSON.stringify(payload));
      }
      throw httpFailure('HTTP_SERVER_ERROR');
    });
    const result = await new VidsparkApiHostArchitecture().discover(movie, new URL('https://moviesapi.to/movie/27205?theme=F7BD46'), 'pressplayx:pressplayx.to', 'pressplayx', requestServices, new AbortController().signal);
    if (result.type !== 'streams') throw new Error('Expected VidSpark streams');
    expect(result.streams).toEqual([expect.objectContaining({ protocol: 'hls', delivery: 'relayed', headers: { origin: 'https://netoda.tech', referer: 'https://netoda.tech/' }, sourceId: 'pressplayx:pressplayx.to', sourceExtractor: 'pressplayx', hostExtractor: 'vidspark-api' })]);
    expect(result.streams[0]?.url.hostname).toBe('netoda.tech');
    expect(result.streams[0]?.url.pathname).toMatch(/^\/hls\/[a-f0-9-]+\/master\.m3u8$/);
    expect(apiRequests(requestServices).slice(0, 2).map(request => [request.url.href, request.headers, request.referrer?.href])).toEqual([
      ['https://moviesapi.to/api/vidora/v1/movie/27205', { 'x-player-key': '3a67e8866ae1d2bb9e81fe7f73315a56eb3bdf5e3e755c7554c8be6910aa6b13' }, 'https://moviesapi.to/movie/27205?theme=F7BD46'],
      ['https://cdn.vidspark.to/api/vidora/v1/movie/27205?source=scrapify', { 'x-player-key': 'f3b72e73c80c9a996574379798703796a1936efa3516a7105cb0e43048b46b5a' }, 'https://cdn.vidspark.to/movie/27205'],
    ]);
  });

  test('moves through servers in the player order and keeps every native quality from a proxy without upstream headers', async () => {
    const requestServices = services((request) => {
      if (request.url.hostname === 'moviesapi.to') throw httpFailure('HTTP_NOT_FOUND');
      if (request.url.searchParams.get('source') === 'scrapify') throw httpFailure('HTTP_SERVER_ERROR');
      return response(request.url, fixture('cdn-episode-oreon.json'));
    });
    const result = await new VidsparkApiHostArchitecture().discover(laterEpisode, new URL('https://moviesapi.to/tv/1396-5-16?theme=F7BD46'), 'source', 'family', requestServices, new AbortController().signal);
    if (result.type !== 'streams') throw new Error('Expected VidSpark streams');
    expect(result.streams.map(stream => [stream.protocol, stream.url.hostname, stream.declaredResolution?.height])).toEqual([['http', 'bcdn.hakunaymatata.com', undefined], ['http', 'bcdn.hakunaymatata.com', 1080], ['http', 'bcdn.hakunaymatata.com', 720], ['http', 'bcdn.hakunaymatata.com', 480], ['http', 'bcdn.hakunaymatata.com', 360]]);
    expect(result.streams.every(stream => stream.delivery === 'relayed' && Object.keys(stream.headers ?? {}).length === 0)).toBe(true);
    expect(result.streams[0]?.subtitles?.map(track => track.label)).toEqual(['English', 'Spanish']);
    expect(apiRequests(requestServices).map(request => request.url.searchParams.get('source'))).toEqual([null, 'scrapify', 'oreon']);
  });

  test('drains the eager fallback before reporting malformed primary API data', async () => {
    let fallbackSettled = false;
    const playerServices = services((request) => {
      if (request.url.hostname === 'moviesapi.to') return response(request.url, '{');
      throw httpFailure('HTTP_SERVER_ERROR');
    });
    const requestServices: RequestServices = { request: async (request, signal) => {
      if (request.url.hostname === 'cdn.vidspark.to' && !request.url.pathname.startsWith('/assets/') && !request.url.pathname.startsWith('/api/')) {
        await new Promise<void>(resolve => setImmediate(resolve));
        fallbackSettled = true;
        throw httpFailure('HTTP_SERVER_ERROR');
      }
      return playerServices.request(request, signal);
    } };
    await expect(new VidsparkApiHostArchitecture().discover(movie, new URL('https://moviesapi.to/movie/27205'), 'source', 'family', requestServices, new AbortController().signal)).rejects.toThrow(SyntaxError);
    expect(fallbackSettled).toBe(true);
  });

  test('keeps the primary player stream together with the fallback stream used when it does not play', async () => {
    const episode: MediaIdentity = { canonicalId: 'tmdb:1399:1:1', type: 'episode', tmdbId: 1399, title: 'Game of Thrones', year: 2011, season: 1, episode: 1 };
    const requestServices = services((request) => {
      if (request.url.hostname === 'moviesapi.to') return response(request.url, fixture('moviesapi-episode.json'));
      if (request.url.searchParams.get('source') === 'scrapify') return response(request.url, fixture('cdn-movie-scrapify.json').replace('"type": "movie"', '"type": "tv", "season": 1, "episode": 1').replace('"27205"', '"1399"'));
      throw httpFailure('HTTP_SERVER_ERROR');
    });
    const result = await new VidsparkApiHostArchitecture().discover(episode, new URL('https://moviesapi.to/tv/1399-1-1?theme=F7BD46'), 'source', 'family', requestServices, new AbortController().signal);
    if (result.type !== 'streams') throw new Error('Expected VidSpark streams');
    expect(result.streams.map(stream => [stream.url.hostname, stream.headers])).toEqual([['bx.netrocdn.site', { referer: 'https://moviesapi.to/' }], ['netoda.tech', { origin: 'https://netoda.tech', referer: 'https://netoda.tech/' }]]);
  });

  test('does not publish a stream for a different movie or episode', async () => {
    const episodeServices = services((request) => {
      if (request.url.hostname === 'moviesapi.to') throw httpFailure('HTTP_NOT_FOUND');
      return response(request.url, fixture('cdn-episode-oreon.json').replace('"episode": 16', '"episode": 15'));
    });
    await expect(new VidsparkApiHostArchitecture().discover(laterEpisode, new URL('https://moviesapi.to/tv/1396-5-16'), 'source', 'family', episodeServices, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED' } });
    const movieServices = services((request) => {
      if (request.url.hostname === 'moviesapi.to') throw httpFailure('HTTP_NOT_FOUND');
      return response(request.url, fixture('cdn-movie-scrapify.json').replace('"year": 2010', '"year": 2011'));
    });
    await expect(new VidsparkApiHostArchitecture().discover(movie, new URL('https://moviesapi.to/movie/27205'), 'source', 'family', movieServices, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED' } });
  });

  test('reports a changed player when it no longer declares the Vidora API', async () => {
    const requestServices: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname.startsWith('/assets/') ? 'export const fixture=1;' : fixture('moviesapi-player.html'))) };
    await expect(new VidsparkApiHostArchitecture().discover(movie, new URL('https://moviesapi.to/movie/27205'), 'source', 'family', requestServices, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED' } });
  });
});
