import type { ExtractionResponse, RequestServices, StreamCandidate } from '../core/models';
import { TransportFailure } from '../transport';
import { StreamSelector } from './stream-selector';

describe('source-fair stream validation', () => {
  test('validates CineGo despite six forbidden advertised variants and three AniCine candidates', async () => {
    const candidates: StreamCandidate[] = [
      ...['cinemaos', 'movies-to-watch'].flatMap(sourceId => [1080, 720, 480].map(height => ({ url: new URL(`https://${sourceId}.test/${height}.mp4`), protocol: 'http' as const, sourceId, sourceExtractor: 'fixture', declaredResolution: { width: height * 16 / 9, height }, discoveredAt: new Date(0) }))),
      ...['one', 'two', 'three'].map(id => ({ url: new URL(`https://anicine.test/${id}.mp4`), protocol: 'http' as const, sourceId: 'anicine', sourceExtractor: 'fixture', discoveredAt: new Date(0) })),
      { url: new URL('https://cinego.test/episode.mp4'), protocol: 'http', sourceId: 'cinego', sourceExtractor: 'fixture', discoveredAt: new Date(0) },
    ];
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
      if (request.url.hostname === 'cinemaos.test' || request.url.hostname === 'movies-to-watch.test') throw new TransportFailure({ code: 'HTTP_FORBIDDEN', message: 'Unavailable media', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: new Uint8Array(), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const result = await new StreamSelector(services).validate(candidates, { concurrency: 8 }, new AbortController().signal);
    expect(result.streams.map(stream => stream.sourceId)).toEqual(['anicine', 'anicine', 'anicine', 'cinego']);
    expect(result.streams.every(stream => stream.validation === 'validated')).toBe(true);
    expect(result.failures).toHaveLength(6);
    expect(result.failures.every(failure => failure.code === 'HTTP_FORBIDDEN')).toBe(true);
    expect(services.request).toHaveBeenCalledTimes(10);
    expect((services.request as jest.Mock).mock.calls.slice(0, 4).map(([request]) => request.url.hostname)).toEqual(['cinemaos.test', 'movies-to-watch.test', 'anicine.test', 'cinego.test']);
  });

  test('returns more than eight distinct working streams while bounding active checks', async () => {
    let active = 0;
    let peak = 0;
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve => setImmediate(resolve));
      active--;
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: new Uint8Array(), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    const candidates = Array.from({ length: 12 }, (_value, index): StreamCandidate => ({ url: new URL(`https://source.test/${index}.mp4`), protocol: 'http', sourceId: 'source', sourceExtractor: 'fixture', discoveredAt: new Date(0) }));
    const result = await new StreamSelector(services).validate(candidates, { concurrency: 2 }, new AbortController().signal);
    expect(result.streams).toHaveLength(12);
    expect(result.unverified).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(peak).toBe(2);
    expect(services.request).toHaveBeenCalledTimes(12);
  });

  test('does not start queued network checks after cancellation or mark them validated', async () => {
    const controller = new AbortController();
    const services: RequestServices = { request: jest.fn(async (request): Promise<ExtractionResponse> => {
      controller.abort();
      throw new TransportFailure({ code: 'TIMEOUT', message: 'Cancelled', targetHost: request.url.hostname, observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
    }) };
    const candidates = Array.from({ length: 12 }, (_value, index): StreamCandidate => ({ url: new URL(`https://source.test/${index}.mp4`), protocol: 'http', sourceId: 'source', sourceExtractor: 'fixture', discoveredAt: new Date(0) }));
    const result = await new StreamSelector(services).validate(candidates, { concurrency: 1 }, controller.signal);
    expect(services.request).toHaveBeenCalledTimes(1);
    expect(result.failures).toMatchObject([{ code: 'TIMEOUT' }]);
    expect(result.unverified).toHaveLength(11);
    expect(result.streams.every(stream => stream.validation === 'unverified')).toBe(true);
  });
});
