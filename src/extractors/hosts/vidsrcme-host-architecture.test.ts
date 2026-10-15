import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices } from '../../engine/core/models';
import { StreamSelector } from '../../engine/protocols';
import type { VidsrcMeEnvelopeDecoder } from './vidsrcme-host-architecture';
import { VidsrcMeApiHostArchitecture } from './vidsrcme-host-architecture';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cinego/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('VidsrcMe API host architecture', () => {
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };

  test.each(['encrypted', 'decoded'])('validates every %s mirror when the first tokenized playlist is expired', async (format) => {
    const urls = ['https://media.vidsrcme.test/expired.m3u8', 'https://media.vidsrcme.test/master.m3u8', 'https://backup.vidsrcme.test/master.m3u8'];
    const decoder: VidsrcMeEnvelopeDecoder = { decrypt: jest.fn(async () => urls) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname === 'data.vidsrcme.ru') return response(request.url, format === 'encrypted' ? fixture('vidsrcme-movie.json') : JSON.stringify({ data: { stream_urls: urls, title: 'Inception' } }));
      if (request.url.pathname === '/generate.php') return response(request.url, `token-${request.url.hostname}`);
      if (request.url.pathname === '/expired.m3u8') return response(request.url, '<html>Expired stream</html>');
      if (request.expectedContent === 'binary') return response(request.url, 'fixture-segment');
      return response(request.url, fixture(request.url.pathname === '/video-720.m3u8' ? 'media.m3u8' : 'master.m3u8'));
    }) };
    const signal = new AbortController().signal;
    const result = await new VidsrcMeApiHostArchitecture(decoder).discover(movie, 'cinego:cinego.test', 'cinego', services, signal);
    expect(result).toMatchObject({ type: 'streams', streams: urls.map(value => ({ url: new URL(`${value}?token=token-${new URL(value).hostname}`), protocol: 'hls', delivery: 'relayed', sourceId: 'cinego:cinego.test', sourceExtractor: 'cinego', hostExtractor: 'vidsrcme-api' })) });
    expect((services.request as jest.Mock).mock.calls.filter(([request]: [ExtractionRequest]) => request.url.pathname === '/generate.php')).toHaveLength(2);
    if (result.type !== 'streams') throw new Error('VidsrcMe did not return stream candidates');
    const validation = await new StreamSelector(services).validate(result.streams, { concurrency: 2 }, signal);
    expect(validation).toMatchObject({ streams: [{ validation: 'validated', delivery: 'relayed' }], failures: [{ code: 'MANIFEST_INVALID', extractorId: 'vidsrcme-api' }] });
    for (const value of urls) expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL(`${value}?token=token-${new URL(value).hostname}`), expectedContent: 'manifest' }), signal);
    for (const hostname of ['media.vidsrcme.test', 'backup.vidsrcme.test']) expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL(`https://${hostname}/segment-1.ts`), expectedContent: 'binary' }), signal);
  });
});
