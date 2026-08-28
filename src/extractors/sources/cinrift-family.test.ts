import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, RequestServices, SourceRecord } from '../../engine/core/models';
import { FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import { CinriftFamily } from './cinrift-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cinrift/${name}`), 'utf8');
const response = (url: string, body: string, contentType = 'application/json'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: new URL(url), redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('Cinrift source family and Vidrift host architecture', () => {
  const source: SourceRecord = { id: '7movies:7movies.test', canonicalDomain: '7movies.test', aliases: [], fmhy: { section: 'Multi-Server', tags: [], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'cinrift', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };

  test('recognizes the shared Cinrift and Vidrift fingerprint', () => {
    const html = fixture('home.html');
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://7movies.test/'), status: 200, headers: {}, htmlSample: html, assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(new CinriftFamily().classify(source, snapshot)).toMatchObject({ familyId: 'cinrift', confidence: 1, evidence: [{ fingerprint: 'vidrift-player' }, { fingerprint: 'cinrift-client' }, { fingerprint: 'cinrift-brand' }] });
  });

  test('exchanges the source grant for a freshly validated host stream', async () => {
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.pathname === '/api/playback-token') return response(request.url.href, JSON.stringify({ token: 'fixture-token' }));
      if (request.url.pathname === '/api/source/movie/27205') return response(request.url.href, JSON.stringify({ streams: [{ url: 'https://media.vidrift.test/movie_27205/vod.m3u8', type: 'hls', provider: 'Direct' }] }));
      return response(request.url.href, fixture('master.m3u8'), 'application/vnd.apple.mpegurl');
    }) };
    const registry = new SourceRegistry();
    registry.set(source);
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, new CinriftFamily(), { familyId: 'cinrift', cases: [{ id: 'movie', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, expected: 'discoverable' }] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true } });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://embed.vidrift.in/api/source/movie/27205?token=fixture-token&provider=selfhost') }), expect.any(AbortSignal));
  });
});
