import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, ExtractionResult, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import { decryptSpeedracelightEnvelope, SpeedracelightApiHostArchitecture, type SpeedracelightHostArchitecture } from '../hosts/speedracelight-host-architecture';
import { CinemaOsFamily } from './cinemaos-family';

describe('CinemaOS source family and Speedracelight host architecture', () => {
  const source: SourceRecord = { id: 'cinemaos:cinemaos.test', canonicalDomain: 'cinemaos.test', aliases: [], fmhy: { section: 'Multi-Server', tags: ['recommended'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'cinemaos', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };

  test('recognizes the CinemaOS catalog and decrypts its player envelope', () => {
    const html = readFileSync(resolve(__dirname, '../__fixtures__/cinemaos/home.html'), 'utf8');
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://cinemaos.test/'), status: 200, headers: {}, htmlSample: html, assetPaths: ['/_next/static/chunks/app/page-fixture.js'], scriptSignatures: [], routeHints: ['/movie/watch/27205', '/tv/watch/1396'] };
    expect(new CinemaOsFamily().classify(source, snapshot)).toMatchObject({ familyId: 'cinemaos', confidence: 1, evidence: [{ fingerprint: 'cinemaos-brand' }, { value: '/movie|tv/watch/{tmdbId}' }, { value: 'cinemaos-next-client' }] });
    const encrypted = JSON.parse(readFileSync(resolve(__dirname, '../__fixtures__/cinemaos/encrypted-source.json'), 'utf8')) as { seed: string; mediaId: number; envelope: string; plaintext: string };
    expect(decryptSpeedracelightEnvelope(encrypted.envelope, encrypted.seed, encrypted.mediaId)).toBe(encrypted.plaintext);
  });

  test('decrypts player sources and preserves exact coordinates and source attribution', async () => {
    const encrypted = JSON.parse(readFileSync(resolve(__dirname, '../__fixtures__/cinemaos/encrypted-source.json'), 'utf8')) as { seed: string; mediaId: number; envelope: string };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      const body = request.url.pathname === '/seed' ? JSON.stringify({ seed: encrypted.seed }) : encrypted.envelope;
      const response: ExtractionResponse = { status: 200, headers: { 'content-type': request.url.pathname === '/seed' ? 'application/json' : 'text/plain' }, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
      return response;
    }) };
    const media = { canonicalId: 'tmdb:76479:2:1', type: 'episode' as const, tmdbId: encrypted.mediaId, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 };
    await expect(new SpeedracelightApiHostArchitecture().discover(media, source.id, 'cinemaos', services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams', streams: [{ url: new URL('https://media.cineby.test/master.m3u8'), protocol: 'hls', label: '1080p', declaredResolution: { width: 1920, height: 1080 }, sourceId: source.id, sourceExtractor: 'cinemaos', hostExtractor: 'speedracelight-api' }] });
    expect(services.request).toHaveBeenNthCalledWith(1, expect.objectContaining({ url: new URL(`https://api.speedracelight.com/seed?mediaId=${encrypted.mediaId}`) }), expect.any(AbortSignal));
    expect(services.request).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: new URL(`https://api.speedracelight.com/cdn/sources-with-title?title=The%2520Boys&mediaType=tv&year=2019&seasonId=2&episodeId=1&tmdbId=${encrypted.mediaId}&imdbId=tt1190634&enc=2&seed=${encodeURIComponent(encrypted.seed)}`) }), expect.any(AbortSignal));
  });

  test('matches the exact movie, early episode, and later-season catalog coordinates', async () => {
    const streams: ExtractionResult = { type: 'streams', streams: [{ url: new URL('https://media.cinemaos.test/master.m3u8'), protocol: 'hls', sourceId: source.id, sourceExtractor: 'cinemaos', hostExtractor: 'speedracelight-api', discoveredAt: new Date(0) }] };
    const host: SpeedracelightHostArchitecture = { discover: jest.fn(async () => streams) };
    const family = new CinemaOsFamily(host);
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      const body = request.url.pathname.startsWith('/watch/movie/') ? readFileSync(resolve(__dirname, '../__fixtures__/cinemaos/movie-inception.html'), 'utf8') : request.url.pathname.endsWith('/76479') ? readFileSync(resolve(__dirname, '../__fixtures__/cinemaos/series-the-boys.html'), 'utf8') : readFileSync(resolve(__dirname, '../__fixtures__/cinemaos/series-breaking-bad.html'), 'utf8');
      return { status: 200, headers: { 'content-type': 'text/html' }, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const media = [{ canonicalId: 'tmdb:27205', type: 'movie' as const, tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, { canonicalId: 'tmdb:1396:1:1', type: 'episode' as const, tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, { canonicalId: 'tmdb:76479:2:1', type: 'episode' as const, tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 }];
    for (const identity of media) await expect(family.discoverMedia(identity, source, services, new AbortController().signal)).resolves.toBe(streams);
    expect(host.discover).toHaveBeenNthCalledWith(3, media[2], source.id, 'cinemaos', services, expect.any(AbortSignal));
  });
});
