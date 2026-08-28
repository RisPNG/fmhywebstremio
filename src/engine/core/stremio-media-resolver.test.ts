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
});
