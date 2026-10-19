import type { ExtractionResponse, RequestServices, SourceRecord, StreamCandidate } from '../core/models';
import { StreamSelector } from '../protocols';
import { SourceRegistry } from '../registry';
import { ExtractionResolver, StaticExtractorLookup } from '../resolver';
import { FamilyHealthRunner } from './family-health-runner';
import type { SourceFamily } from './source-family';

const source: SourceRecord = { id: 'source', canonicalDomain: 'source.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'fixture', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };
const movie = { canonicalId: 'movie', type: 'movie' as const, title: 'Movie' };
const candidate: StreamCandidate = { url: new URL('https://media.test/working.mp4'), protocol: 'http', sourceId: source.id, sourceExtractor: 'fixture', discoveredAt: new Date(0) };

describe('bounded family health validation', () => {
  test('passes a playable case after a failed candidate and cancels optional work before checking absent media', async () => {
    let pendingCancelled = false;
    const services: RequestServices = { request: jest.fn(async (request, signal): Promise<ExtractionResponse> => {
      if (request.url.pathname === '/0-broken.m3u8') throw new Error('MANIFEST_INVALID');
      if (request.url.pathname === '/1-pending.m3u8') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        pendingCancelled = true;
        reject(signal.reason);
      }, { once: true }));
      const body = request.expectedContent === 'manifest' ? '#EXTM3U\n#EXTINF:4,\nsegment.ts' : 'media';
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: new TextEncoder().encode(body), text: () => body, json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const family: SourceFamily = { id: 'fixture', classify: () => null, discoverMedia: async media => media.title === 'Absent' ? { type: 'empty', reason: 'not-found' } : { type: 'streams', streams: ['0-broken', '1-pending', '2-working', '3-unchecked'].map(name => ({ ...candidate, url: new URL(`https://media.test/${name}.m3u8`), protocol: 'hls' })) } };
    const registry = new SourceRegistry();
    const controller = new AbortController();
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, family, { familyId: family.id, cases: [{ id: 'movie', media: movie, expected: 'discoverable' }, { id: 'absent', media: { ...movie, title: 'Absent' }, expected: 'absent' }] }, controller.signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, anomalies: [], cases: [{ stages: { discovery: true, extraction: true, validation: true } }, { discovered: false, stages: { discovery: false, extraction: false, validation: false } }] });
    expect(outcome.cases[0]?.failure).toBeUndefined();
    expect(pendingCancelled).toBe(true);
    expect((services.request as jest.Mock).mock.calls.map(([request]) => request.url.pathname)).toEqual(['/0-broken.m3u8', '/1-pending.m3u8', '/2-working.m3u8', '/segment.ts']);
    expect(registry.runtimeEligible().map(record => record.id)).toEqual([source.id]);
    expect(controller.signal.aborted).toBe(false);
  });

  test('gives each case a fresh discovery deadline and continues after a timed-out case', async () => {
    const signals: AbortSignal[] = [];
    const services: RequestServices = { request: jest.fn(async (request, signal): Promise<ExtractionResponse> => {
      signal.throwIfAborted();
      signals.push(signal);
      if (request.url.pathname === '/pending') return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      return { status: 200, headers: { 'content-type': 'video/mp4' }, finalUrl: request.url, redirectChain: [], body: new Uint8Array(), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const family: SourceFamily = { id: 'fixture', classify: () => null, discoverMedia: async (media, _source, transport, signal) => {
      await transport.request({ url: new URL(`https://source.test/${media.title.toLowerCase()}`) }, signal);
      return { type: 'streams', streams: [candidate] };
    } };
    const registry = new SourceRegistry();
    const controller = new AbortController();
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry, 0.75, undefined, 25).run(source, family, { familyId: family.id, cases: [{ id: 'pending', media: { ...movie, title: 'Pending' }, expected: 'discoverable' }, { id: 'working', media: movie, expected: 'discoverable' }] }, controller.signal);
    expect(outcome).toMatchObject({ status: 'healthy', staleCases: ['pending'], cases: [{ stages: { validation: false }, failure: { code: 'TIMEOUT', stage: 'stage:discovery' } }, { stages: { validation: true } }] });
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(signals[0]).not.toBe(signals[1]);
    expect(controller.signal.aborted).toBe(false);
  });

  test('bounds discovery and all-invalid validation with one case deadline', async () => {
    const signals: AbortSignal[] = [];
    const services: RequestServices = { request: jest.fn(async (request, signal): Promise<ExtractionResponse> => {
      signals.push(signal);
      if (request.url.hostname === 'source.test') {
        await new Promise<void>(resolve => setTimeout(resolve, 10));
        return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: new Uint8Array(), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
      }
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }) };
    let discoverySignal: AbortSignal | undefined;
    const family: SourceFamily = { id: 'fixture', classify: () => null, discoverMedia: async (_media, _source, transport, signal) => {
      discoverySignal = signal;
      await transport.request({ url: new URL('https://source.test/catalog') }, signal);
      return { type: 'streams', streams: Array.from({ length: 20 }, (_value, index) => ({ ...candidate, url: new URL(`https://media.test/${index}.mp4`) })) };
    } };
    const registry = new SourceRegistry();
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry, 0.5, undefined, 30).run(source, family, { familyId: family.id, cases: [{ id: 'movie', media: movie, expected: 'discoverable' }] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'degraded', extractable: false, cases: [{ stages: { discovery: true, extraction: true, validation: false }, failure: { code: 'TIMEOUT', stage: 'stage:protocol' } }] });
    expect(discoverySignal?.aborted).toBe(true);
    expect(signals).toHaveLength(3);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(registry.runtimeEligible()).toEqual([]);
  });

  test('preserves an external abort during discovery', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const services: RequestServices = { request: jest.fn(async (_request, signal) => {
      requestSignal = signal;
      queueMicrotask(() => controller.abort(new Error('Health audit cancelled')));
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    }) };
    const family: SourceFamily = { id: 'fixture', classify: () => null, discoverMedia: async (_media, _source, transport, signal) => {
      await transport.request({ url: new URL('https://source.test/catalog') }, signal);
      return { type: 'empty', reason: 'not-found' };
    } };
    const registry = new SourceRegistry();
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, family, { familyId: family.id, cases: [{ id: 'movie', media: movie, expected: 'discoverable' }] }, controller.signal);
    expect(outcome).toMatchObject({ extractable: false, cases: [{ failure: { code: 'TIMEOUT', stage: 'stage:discovery' } }] });
    expect(requestSignal?.reason).toBe(controller.signal.reason);
    expect(outcome.cases[0]?.failure?.message).toBe('Health audit cancelled');
    expect(registry.runtimeEligible()).toEqual([]);
  });
});
