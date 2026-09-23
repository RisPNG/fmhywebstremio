import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, MediaIdentity, RequestServices } from '../../engine/core/models';
import { VidriftApiHostArchitecture } from './vidrift-host-architecture';

describe('Vidrift API host architecture', () => {
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, title: 'The Boys', year: 2019, season: 2, episode: 1 };
  const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cinrift/${name}`), 'utf8');
  const services = (body: (request: ExtractionRequest) => string, requests: ExtractionRequest[] = []): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => {
    requests.push(request);
    const text = body(request);
    return { status: 200, headers: { 'content-type': 'application/json' }, finalUrl: request.url, redirectChain: [], body: Buffer.from(text), text: () => text, json: () => JSON.parse(text) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
  }) });

  test('sends the granted movie and exact episode to the declared player Earth provider and relays its signed playlists', async () => {
    const requests: ExtractionRequest[] = [];
    const host = new VidriftApiHostArchitecture();
    const movieResult = await host.discover(movie, new URL('https://embed.vidrift.net'), 'fixture-token', '7movies:7movies.test', 'cinrift', services(request => fixture(request.url.pathname.startsWith('/api/source/movie/') ? 'source-movie.json' : 'source-episode.json'), requests), new AbortController().signal);
    const episodeResult = await host.discover(episode, new URL('https://embed.vidrift.in'), 'fixture-token', '7movies:7movies.test', 'cinrift', services(request => fixture(request.url.pathname.startsWith('/api/source/movie/') ? 'source-movie.json' : 'source-episode.json'), requests), new AbortController().signal);
    expect(requests.map(request => request.url.href)).toEqual(['https://embed.vidrift.net/api/source/movie/27205?token=fixture-token&provider=vaplayer', 'https://embed.vidrift.in/api/source/tv/76479/2/1?token=fixture-token&provider=vaplayer']);
    const relayed = { protocol: 'hls', delivery: 'relayed', sourceId: '7movies:7movies.test', sourceExtractor: 'cinrift', hostExtractor: 'vidrift-api', label: 'Earth' };
    expect(movieResult).toMatchObject({ type: 'streams', streams: [relayed, relayed, relayed] });
    expect(episodeResult.type === 'streams' && episodeResult.streams.map(stream => [stream.url.hostname, new URL(stream.url.searchParams.get('url') as string).pathname])).toEqual([['relay.vidrift.net', '/fixture/pl/episode-0/master.m3u8'], ['relay.vidrift.net', '/fixture/pl/episode-1/master.m3u8']]);
  });

  test('keeps only playable HLS entries and types a changed source response', async () => {
    const host = new VidriftApiHostArchitecture();
    await expect(host.discover(movie, new URL('https://embed.vidrift.net'), 'fixture-token', '7movies:7movies.test', 'cinrift', services(() => '{"success":false,"streams":[{"url":"","proxyUrl":"","type":"hls"},{"url":"https://media.test/movie.mp4","type":"mp4"}]}'), new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
    await expect(host.discover(movie, new URL('https://embed.vidrift.net'), 'fixture-token', '7movies:7movies.test', 'cinrift', services(() => '{"success":false}'), new AbortController().signal))
      .resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', stage: 'stage:extraction', extractorId: 'vidrift-api', targetHost: 'embed.vidrift.net', diagnostic: { parserPath: 'streams' } } });
  });
});
