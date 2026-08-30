import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, ExtractionResult, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import { decryptSpeedracelightEnvelope, SpeedracelightApiHostArchitecture, type SpeedracelightHostArchitecture } from '../hosts/speedracelight-host-architecture';
import { CinebyFamily } from './cineby-family';

describe('Cineby source family and Speedracelight host architecture', () => {
  const source: SourceRecord = { id: 'cineby:cineby.test', canonicalDomain: 'cineby.test', aliases: [], fmhy: { section: 'Stream Aggregators', tags: ['recommended'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'cineby', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };

  test('recognizes the Cineby catalog and decrypts its source envelope', () => {
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://cineby.test/'), status: 200, headers: {}, htmlSample: readFileSync(resolve(__dirname, '../__fixtures__/cineby/home.html'), 'utf8'), assetPaths: [], scriptSignatures: [], routeHints: ['/movie/27205', '/tv/1396'] };
    expect(new CinebyFamily().classify(source, snapshot)).toMatchObject({ familyId: 'cineby', confidence: 0.8500000000000001, evidence: [{ fingerprint: 'cineby-brand' }, { value: '/movie|tv/{tmdbId}' }] });
    const encrypted = JSON.parse(readFileSync(resolve(__dirname, '../__fixtures__/cineby/encrypted-source.json'), 'utf8')) as { seed: string; mediaId: number; envelope: string; plaintext: string };
    expect(decryptSpeedracelightEnvelope(encrypted.envelope, encrypted.seed, encrypted.mediaId)).toBe(encrypted.plaintext);
  });

  test('decrypts player sources and preserves exact media coordinates and advertised quality', async () => {
    const encrypted = JSON.parse(readFileSync(resolve(__dirname, '../__fixtures__/cineby/encrypted-source.json'), 'utf8')) as { seed: string; mediaId: number; envelope: string };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      const body = request.url.pathname === '/seed' ? JSON.stringify({ seed: encrypted.seed }) : encrypted.envelope;
      const response: ExtractionResponse = { status: 200, headers: { 'content-type': request.url.pathname === '/seed' ? 'application/json' : 'text/plain' }, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
      return response;
    }) };
    const media = { canonicalId: 'tmdb:76479:2:1', type: 'episode' as const, tmdbId: encrypted.mediaId, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 };
    await expect(new SpeedracelightApiHostArchitecture().discover(media, source.id, services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams', streams: [{ url: new URL('https://media.cineby.test/master.m3u8'), protocol: 'hls', label: '1080p', declaredResolution: { width: 1920, height: 1080 }, sourceId: source.id, sourceExtractor: 'cineby', hostExtractor: 'speedracelight-api' }] });
    expect(services.request).toHaveBeenNthCalledWith(1, expect.objectContaining({ url: new URL(`https://api.speedracelight.com/seed?mediaId=${encrypted.mediaId}`) }), expect.any(AbortSignal));
    expect(services.request).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: new URL(`https://api.speedracelight.com/cdn/sources-with-title?title=The%2520Boys&mediaType=tv&year=2019&seasonId=2&episodeId=1&tmdbId=${encrypted.mediaId}&imdbId=tt1190634&enc=2&seed=${encodeURIComponent(encrypted.seed)}`) }), expect.any(AbortSignal));
  });

  test('sends exact movie and later-season coordinates to the shared player architecture', async () => {
    const streams: ExtractionResult = { type: 'streams', streams: [{ url: new URL('https://media.cineby.test/master.m3u8'), protocol: 'hls', sourceId: source.id, sourceExtractor: 'cineby', hostExtractor: 'speedracelight-api', discoveredAt: new Date(0) }] };
    const host: SpeedracelightHostArchitecture = { discover: jest.fn(async () => streams) };
    const family = new CinebyFamily(host);
    const services = {} as RequestServices;
    const signal = new AbortController().signal;
    const movie = { canonicalId: 'tmdb:27205', type: 'movie' as const, tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 };
    const laterSeason = { canonicalId: 'tmdb:76479:2:1', type: 'episode' as const, tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 };
    await expect(family.discoverMedia(movie, source, services, signal)).resolves.toBe(streams);
    await expect(family.discoverMedia(laterSeason, source, services, signal)).resolves.toBe(streams);
    expect(host.discover).toHaveBeenNthCalledWith(1, movie, source.id, services, signal);
    expect(host.discover).toHaveBeenNthCalledWith(2, laterSeason, source.id, services, signal);
  });
});
