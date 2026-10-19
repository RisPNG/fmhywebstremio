import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, RequestServices } from './models';
import { StremioMediaResolver } from './stremio-media-resolver';

describe('StremioMediaResolver', () => {
  test('resolves Stremio IMDb media through Cinemeta', async () => {
    const fixture = readFileSync(resolve(__dirname, '__fixtures__/cinemeta-inception.json'), 'utf8');
    const services: RequestServices = { request: async (request: ExtractionRequest): Promise<ExtractionResponse> => ({ status: 200, headers: {}, body: Buffer.from(fixture), finalUrl: request.url, redirectChain: [], truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 }, text: () => fixture, json: () => JSON.parse(fixture) as unknown }) };

    await expect(new StremioMediaResolver(services, '').resolve({ type: 'movie', imdbId: 'tt1375666' }, new AbortController().signal)).resolves.toEqual({ type: 'movie', imdbId: 'tt1375666', canonicalId: 'tmdb:27205', tmdbId: 27205, title: 'Inception', year: 2010 });
  });

  test('lets ID-native families use TMDB requests without a metadata secret', async () => {
    const services = { request: jest.fn() } as unknown as RequestServices;

    await expect(new StremioMediaResolver(services, '').resolve({ type: 'episode', tmdbId: 1396, season: 1, episode: 1 }, new AbortController().signal)).resolves.toEqual({ type: 'episode', tmdbId: 1396, season: 1, episode: 1, canonicalId: 'tmdb:1396', title: '' });
    expect(services.request).not.toHaveBeenCalled();
  });

  test.each([
    { request: { type: 'movie' as const, imdbId: 'tt1375666' }, mapped: { name: 'Inception', moviedb_id: 27205, releaseInfo: '2010' }, native: { id: 27205, title: 'Inception', release_date: '2010-07-15' }, path: '/3/movie/27205', title: 'Inception', year: 2010 },
    { request: { type: 'episode' as const, imdbId: 'tt32604054', season: 1, episode: 2, preferredLanguages: ['en'] }, mapped: { name: 'Regular Show: Lost Tapes', moviedb_id: 256695, releaseInfo: '2026' }, native: { id: 256695, name: 'Regular Show: The Lost Tapes', first_air_date: '2026-05-11' }, path: '/3/tv/256695', title: 'Regular Show: The Lost Tapes', year: 2026 },
  ])('loads canonical TMDB metadata after mapping IMDb $request.imdbId', async ({ request, mapped, native, path, title, year }) => {
    const controller = new AbortController();
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
      const payload = request.url.hostname === 'v3-cinemeta.strem.io' ? { meta: mapped } : native;
      const body = JSON.stringify(payload);
      return { status: 200, headers: {}, body: Buffer.from(body), finalUrl: request.url, redirectChain: [], truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 }, text: () => body, json: () => payload };
    }) };
    await expect(new StremioMediaResolver(services, 'fixture-token').resolve(request, controller.signal)).resolves.toEqual({ ...request, canonicalId: `tmdb:${native.id}`, tmdbId: native.id, title, year });
    expect((services.request as jest.Mock).mock.calls.map(([request]) => request.url.href)).toEqual([`https://v3-cinemeta.strem.io/meta/${request.type === 'movie' ? 'movie' : 'series'}/${request.imdbId}.json`, `https://api.themoviedb.org${path}`]);
    expect((services.request as jest.Mock).mock.calls[1]).toEqual([expect.objectContaining({ headers: { authorization: 'Bearer fixture-token' }, expectedContent: 'json' }), controller.signal]);
  });

  test('loads direct TMDB requests through the same canonical metadata stage', async () => {
    const payload = { id: 256695, name: 'Regular Show: The Lost Tapes', first_air_date: '2026-05-11' };
    const body = JSON.stringify(payload);
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => ({ status: 200, headers: {}, body: Buffer.from(body), finalUrl: request.url, redirectChain: [], truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 }, text: () => body, json: () => payload })) };
    await expect(new StremioMediaResolver(services, 'fixture-token').resolve({ type: 'episode', tmdbId: 256695, season: 1, episode: 1 }, new AbortController().signal)).resolves.toEqual({ type: 'episode', tmdbId: 256695, season: 1, episode: 1, canonicalId: 'tmdb:256695', title: payload.name, year: 2026 });
    expect(services.request).toHaveBeenCalledTimes(1);
    expect((services.request as jest.Mock).mock.calls[0]?.[0].url.href).toBe('https://api.themoviedb.org/3/tv/256695');
  });

  test('preserves an explicit title without requesting metadata', async () => {
    const services = { request: jest.fn() } as unknown as RequestServices;
    const request = { type: 'episode' as const, tmdbId: 256695, imdbId: 'tt32604054', title: 'Regular Show: The Lost Tapes', year: 2026, season: 1, episode: 2 };
    await expect(new StremioMediaResolver(services, 'fixture-token').resolve(request, new AbortController().signal)).resolves.toEqual({ ...request, canonicalId: 'tmdb:256695' });
    expect(services.request).not.toHaveBeenCalled();
  });

  test.each([{ id: 31132, name: 'Regular Show' }, { id: 256695 }])('rejects canonical metadata that does not identify the requested title: %j', async (payload) => {
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
      const value = request.url.hostname === 'v3-cinemeta.strem.io' ? { meta: { moviedb_id: 256695, name: 'Regular Show: Lost Tapes' } } : payload;
      const body = JSON.stringify(value);
      return { status: 200, headers: {}, body: Buffer.from(body), finalUrl: request.url, redirectChain: [], truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 }, text: () => body, json: () => value };
    }) };
    const resolver = new StremioMediaResolver(services, 'fixture-token');
    for (const request of [{ type: 'episode' as const, imdbId: 'tt32604054', season: 1, episode: 1 }, { type: 'episode' as const, tmdbId: 256695, season: 1, episode: 1 }]) await expect(resolver.resolve(request, new AbortController().signal)).rejects.toThrow('Media metadata was not found for TMDB 256695');
  });
});
