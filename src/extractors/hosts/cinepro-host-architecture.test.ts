import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, MediaIdentity, RequestServices } from '../../engine/core/models';
import { CineproApiHostArchitecture } from './cinepro-host-architecture';

describe('CinePro host architecture', () => {
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  let bodies: Record<string, string>;
  let services: RequestServices;

  beforeEach(() => {
    bodies = {
      player: readFileSync(resolve(__dirname, '../__fixtures__/anicine/cinepro-player.html'), 'utf8'),
      token: '{"token":"public-fixture-token","expiresAt":"2099-01-01T00:00:00Z"}',
      sources: readFileSync(resolve(__dirname, '../__fixtures__/anicine/cinepro-sources.json'), 'utf8'),
    };
    services = { request: jest.fn(async (request: ExtractionRequest) => {
      const body = bodies[request.url.pathname === '/v1/token' ? 'token' : request.url.pathname.startsWith('/v1/') ? 'sources' : 'player'] as string;
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
  });

  test('exchanges the public token and returns viewer URLs without propagating authorization', async () => {
    const result = await new CineproApiHostArchitecture().discover(movie, new URL('https://player.test/movie/27205'), 'source', 'anicine', services, new AbortController().signal);
    expect(services.request).toHaveBeenLastCalledWith(expect.objectContaining({ url: new URL('https://player.test/v1/movies/27205'), headers: { Authorization: 'Bearer public-fixture-token' } }), expect.any(AbortSignal));
    expect(result).toMatchObject({ type: 'streams', streams: [{ protocol: 'hls', sourceId: 'source', sourceExtractor: 'anicine', hostExtractor: 'cinepro-api' }, {}, {}] });
    expect(JSON.stringify(result)).not.toContain('public-fixture-token');
    if (result.type === 'streams') expect(result.streams[0]?.subtitles).toEqual([{ url: new URL('https://subtitles.test/english.vtt'), label: 'English', format: 'vtt' }]);
    if (result.type === 'streams') expect(result.streams.every(stream => !stream.headers && !stream.delivery)).toBe(true);
  });

  test('requests the exact later-season episode from the selected host', async () => {
    await new CineproApiHostArchitecture().discover({ ...movie, type: 'episode', tmdbId: 1429, season: 2, episode: 1 }, new URL('https://series.test/tv/1429/2/1'), 'source', 'anicine', services, new AbortController().signal);
    expect(services.request).toHaveBeenLastCalledWith(expect.objectContaining({ url: new URL('https://series.test/v1/tv/1429/seasons/2/episodes/1') }), expect.any(AbortSignal));
  });

  test.each([
    ['player', '<title>Different player</title>', 'PAGE_STRUCTURE_CHANGED'],
    ['token', '{}', 'RESPONSE_SCHEMA_CHANGED'],
    ['sources', '{}', 'RESPONSE_SCHEMA_CHANGED'],
  ])('preserves typed failure for changed %s', async (key, body, code) => {
    bodies[key] = body;
    await expect(new CineproApiHostArchitecture().discover(movie, new URL('https://player.test/movie/27205'), 'source', 'anicine', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code, extractorId: 'cinepro-api' } });
  });

  test('does not invent streams for an empty provider result', async () => {
    bodies['sources'] = '{"sources":[]}';
    await expect(new CineproApiHostArchitecture().discover(movie, new URL('https://player.test/movie/27205'), 'source', 'anicine', services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
  });
});
