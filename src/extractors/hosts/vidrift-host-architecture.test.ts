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
    const text = request.url.pathname.startsWith('/api/boot/') ? fixture('boot.json') : body(request);
    return { status: 200, headers: { 'content-type': 'application/json' }, finalUrl: request.url, redirectChain: [], body: Buffer.from(text), text: () => text, json: () => JSON.parse(text) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
  }) });

  test('boots the granted movie and exact episode with the parent session before asking the default provider cascade', async () => {
    const requests: ExtractionRequest[] = [];
    const host = new VidriftApiHostArchitecture();
    const referrer = new URL('https://7movies.test/movie/27205/watch');
    const movieResult = await host.discover(movie, new URL('https://embed.vidrift.net'), 'fixture-token', referrer, '7movies:7movies.test', 'cinrift', services(request => fixture(request.url.pathname.startsWith('/api/source/movie/') ? 'source-movie.json' : 'source-episode.json'), requests), new AbortController().signal);
    const episodeResult = await host.discover(episode, new URL('https://embed.vidrift.in'), 'fixture-token', new URL('https://7movies.test/tv/76479/watch?season=2&episode=1'), '7movies:7movies.test', 'cinrift', services(request => fixture(request.url.pathname.startsWith('/api/source/movie/') ? 'source-movie.json' : 'source-episode.json'), requests), new AbortController().signal);
    expect(requests.map(request => request.url.href)).toEqual(['https://embed.vidrift.net/api/boot/movie/27205?token=fixture-token&shell=1', 'https://embed.vidrift.net/api/source/movie/27205?token=fixture-session-token&provider=', 'https://embed.vidrift.in/api/boot/tv/76479/2/1?token=fixture-token&shell=1', 'https://embed.vidrift.in/api/source/tv/76479/2/1?token=fixture-session-token&provider=']);
    expect(requests[0]).toMatchObject({ headers: { 'x-embed-parent': referrer.origin }, referrer, stateScope: { kind: 'host', key: 'embed.vidrift.net' } });
    expect(requests[1]?.stateScope).toEqual(requests[0]?.stateScope);
    expect(requests[3]?.stateScope).toEqual(requests[2]?.stateScope);
    const relayed = { protocol: 'hls', delivery: 'relayed', sourceId: '7movies:7movies.test', sourceExtractor: 'cinrift', hostExtractor: 'vidrift-api', label: 'Vela' };
    expect(movieResult).toMatchObject({ type: 'streams', streams: [relayed, relayed, relayed] });
    expect(episodeResult.type === 'streams' && episodeResult.streams.map(stream => [stream.url.hostname, new URL(stream.url.searchParams.get('url') as string).pathname])).toEqual([['relay.vidrift.net', '/fixture/pl/episode-0/master.m3u8'], ['relay.vidrift.net', '/fixture/pl/episode-1/master.m3u8']]);
  });

  test('keeps only playable HLS entries and types a changed source response', async () => {
    const host = new VidriftApiHostArchitecture();
    const referrer = new URL('https://7movies.test/movie/27205/watch');
    await expect(host.discover(movie, new URL('https://embed.vidrift.net'), 'fixture-token', referrer, '7movies:7movies.test', 'cinrift', services(() => '{"success":false,"streams":[{"url":"","proxyUrl":"","type":"hls"},{"url":"https://media.test/movie.mp4","type":"mp4"}]}'), new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
    await expect(host.discover(movie, new URL('https://embed.vidrift.net'), 'fixture-token', referrer, '7movies:7movies.test', 'cinrift', services(() => '{"success":false}'), new AbortController().signal))
      .resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', stage: 'stage:extraction', extractorId: 'vidrift-api', targetHost: 'embed.vidrift.net', diagnostic: { parserPath: 'streams' } } });
    await expect(host.discover(movie, new URL('https://embed.vidrift.net'), 'fixture-token', referrer, '7movies:7movies.test', 'cinrift', services(() => '{"streams":[{"url":"/api/orion/master.m3u8","type":"hls","provider":"Orion"}]}'), new AbortController().signal)).resolves.toMatchObject({ type: 'streams', streams: [{ url: new URL('https://embed.vidrift.net/api/orion/master.m3u8'), protocol: 'hls' }] });
  });

  test('does not request sources when the player boot contract changes', async () => {
    const unavailable: RequestServices = { request: jest.fn(async request => ({ status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from('{}'), text: () => '{}', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } })) };
    await expect(new VidriftApiHostArchitecture().discover(movie, new URL('https://embed.vidrift.net'), 'fixture-token', new URL('https://7movies.test/movie/27205/watch'), '7movies:7movies.test', 'cinrift', unavailable, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', diagnostic: { parserPath: 'meta.playbackToken' } } });
    expect(unavailable.request).toHaveBeenCalledTimes(1);
  });
});
