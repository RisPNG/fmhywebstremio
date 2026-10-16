import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import { CinegoFamily } from './cinego-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cinego/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('CineGo source family', () => {
  const source: SourceRecord = { id: 'cinego:cinego.test', canonicalDomain: 'cinego.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };

  test('recognizes the shared catalog and player fingerprint', () => {
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://cinego.test/'), status: 200, headers: {}, htmlSample: fixture('home.html'), assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(new CinegoFamily().classify(source, snapshot)).toMatchObject({ familyId: 'cinego', confidence: 1 });
  });

  test('retains exact catalog matching and reports the declared unsupported grant host', async () => {
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => response(request.url, fixture(request.url.pathname === '/' ? 'home.html' : request.url.searchParams.get('q') === 'Inception' ? 'search-inception.json' : request.url.searchParams.get('q') === 'Loki' ? 'search-loki.json' : 'search-absent.json'))) };
    const family = new CinegoFamily();
    const signal = new AbortController().signal;
    for (const media of [
      { canonicalId: 'tmdb:27205', type: 'movie' as const, tmdbId: 27205, title: 'Inception', year: 2010 },
      { canonicalId: 'tmdb:84958:2:1', type: 'episode' as const, tmdbId: 84958, title: 'Loki', year: 2021, season: 2, episode: 1 },
    ]) await expect(family.discoverMedia(media, source, services, signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'UNKNOWN_HOST', targetHost: 'ployan.me' } });
    for (const media of [
      { canonicalId: 'absent', type: 'movie' as const, tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 },
      { canonicalId: 'wrong-year', type: 'movie' as const, tmdbId: 27205, title: 'Inception', year: 1980 },
      { canonicalId: 'wrong-season', type: 'episode' as const, tmdbId: 84958, title: 'Loki', season: 99, episode: 1 },
    ]) await expect(family.discoverMedia(media, source, services, signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect((services.request as jest.Mock).mock.calls.every(([request]: [ExtractionRequest]) => request.url.hostname === 'cinego.test')).toBe(true);
  });
});
