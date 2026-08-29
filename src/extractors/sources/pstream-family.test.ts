import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';
import type { ExtractionRequest, ExtractionResponse, RequestServices, SourceRecord } from '../../engine/core/models';
import { FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import { PStreamFamily, type PStreamProviderArchitecture } from './pstream-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/pstream/${name}`), 'utf8');

const response = (url: string, body: string): ExtractionResponse => ({ status: 200, headers: { 'content-type': url.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'text/html' }, finalUrl: new URL(url), redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('P-Stream source family and provider architecture', () => {
  const source: SourceRecord = { id: 'aether:aether.test', canonicalDomain: 'aether.test', aliases: [], fmhy: { section: 'P-Stream Forks', tags: ['recommended'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'pstream', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };

  test('recognizes the shared client asset fingerprint', () => {
    const html = fixture('home.html');
    const $ = cheerio.load(html);
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://aether.test/'), status: 200, headers: {}, htmlSample: html, assetPaths: $('script[src]').map((_index, element) => $(element).attr('src')).get(), scriptSignatures: [], routeHints: [] };
    expect(new PStreamFamily().classify(source, snapshot)).toMatchObject({ familyId: 'pstream', confidence: 1, evidence: [{ value: '/config.js' }, { value: 'pstream-provider-assets' }, { fingerprint: 'pstream-client' }] });
  });

  test('maps provider-host output into validated runtime streams', async () => {
    const providers: PStreamProviderArchitecture = { discover: jest.fn().mockResolvedValue({ sourceId: 'fixture-source', embedId: 'fixture-host', stream: { id: 'fixture', type: 'hls', playlist: 'https://cdn.test/master.m3u8', flags: [], captions: [], headers: { referer: 'https://host.test/' } } }) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => response(request.url.href, request.expectedContent === 'binary' ? 'fixture-segment' : fixture(request.url.pathname.endsWith('1080.m3u8') ? 'media.m3u8' : 'master.m3u8'))) };
    const registry = new SourceRegistry();
    registry.set(source);
    const family = new PStreamFamily(providers);
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, family, { familyId: 'pstream', cases: [{ id: 'movie', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' }] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true } });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect(providers.discover).toHaveBeenCalledWith(expect.objectContaining({ type: 'movie', tmdbId: '27205', imdbId: 'tt1375666' }), services, expect.any(AbortSignal));
  });
});
