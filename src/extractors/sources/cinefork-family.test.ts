import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { CineforkFamily } from './cinefork-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cinefork/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });
const failure = (code: 'HTTP_NOT_FOUND' | 'HTTP_SERVER_ERROR', url: URL) => new TransportFailure({ code, message: code, stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, finalUrl: url.href } });

describe('Cinefork source family', () => {
  const source: SourceRecord = { id: 'cinefork:cinefork.net', canonicalDomain: 'cinefork.net', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 };
  const signal = new AbortController().signal;
  const servicesFor = (overrides: Readonly<Record<string, string | TransportFailure>> = {}): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => {
    const path = request.url.pathname;
    if (path === '/') return response(request.url, fixture('home.html'));
    if (path.startsWith('/assets/')) return response(request.url, overrides['client.txt'] as string ?? fixture('client.txt'));
    const provider = path.split('/')[3] as string;
    const name = `${provider}-${path.includes('/movie/') ? 'inception' : 'breaking-bad-s05e16'}.json`;
    const body = overrides[provider] ?? (existsSync(resolve(__dirname, `../__fixtures__/cinefork/${name}`)) ? fixture(name) : failure('HTTP_SERVER_ERROR', request.url));
    if (body instanceof TransportFailure) throw body;
    return response(request.url, body);
  }) });
  const requested = (services: RequestServices) => (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request.url);

  test('requires the declared Cinefork identity and application assets', () => {
    const family = new CineforkFamily();
    const html = fixture('home.html');
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://cinefork.net/'), status: 200, headers: {}, htmlSample: html, assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: 'cinefork', confidence: 1 });
    for (const altered of [html.replace('<title>Cinefork</title>', '<title>Other</title>'), html.replace('/config.js', '/other.js'), html.replace('id="root"', 'id="app"')]) expect(family.classify(source, { ...snapshot, htmlSample: altered })).toBeNull();
  });

  test('reads the declared servers and returns each supported provider stream with its player identity', async () => {
    const services = servicesFor();
    const result = await new CineforkFamily().discoverMedia(movie, source, services, signal);
    if (result.type !== 'streams') throw new Error('Expected Cinefork streams');
    expect(result.streams.map(stream => stream.hostExtractor)).toEqual(['vidfast-api', 'vidfast-api', 'xpass-api', 'vidrock-api', 'lordflix-api', 'lordflix-api', 'lordflix-api']);
    expect(result.streams.every(stream => stream.protocol === 'hls' && stream.delivery === 'relayed' && stream.url.hostname === 'proxy.cinextream.cc' && stream.sourceId === source.id && stream.sourceExtractor === 'cinefork')).toBe(true);
    expect(result.streams[0]?.headers).toEqual({ origin: 'https://cinefork.net', referer: 'https://cinefork.net/' });
    expect(result.streams.find(stream => stream.hostExtractor === 'vidrock-api')?.language).toBe('English');
    expect(result.streams.find(stream => stream.hostExtractor === 'xpass-api')?.language).toBeUndefined();
    expect(requested(services).map(url => url.pathname + url.search).slice(0, 2)).toEqual(['/', '/assets/index-DPMIW4m5.js']);
    expect(requested(services).slice(2).map(url => url.pathname + url.search).sort()).toEqual([
      '/api/ext/lordflix/api/movie/27205?server=Lisbon&worker=1&data=en',
      '/api/ext/lordflix/api/movie/27205?server=Scout&worker=1&data=en',
      '/api/ext/lordflix/api/movie/27205?server=nebula&worker=1&data=en',
      '/api/ext/movy/api/movie/27205?server=miami&worker=1&data=en',
      '/api/ext/vidfast/api/movie/27205?server=1&worker=1&data=en',
      '/api/ext/vidfast/api/movie/27205?server=2&worker=1&data=en',
      '/api/ext/vidrock/api/movie/27205?server=orion&worker=1&data=en',
      '/api/ext/xpass/movie/27205?server=1&worker=1&data=en',
    ]);
  });

  test('requests the exact season and episode and keeps only responses that echo them', async () => {
    const services = servicesFor();
    const result = await new CineforkFamily().discoverMedia(episode, source, services, signal);
    if (result.type !== 'streams') throw new Error('Expected Cinefork streams');
    expect(new Set(result.streams.map(stream => stream.hostExtractor))).toEqual(new Set(['vidfast-api', 'xpass-api', 'vidrock-api', 'lordflix-api']));
    expect(requested(services).map(url => url.pathname)).toContain('/api/ext/xpass/tv/1396/5/16');
    expect(requested(services).map(url => url.pathname)).toContain('/api/ext/vidfast/api/tv/1396/5/16');
    const original = JSON.parse(fixture('vidfast-breaking-bad-s05e16.json')) as object;
    for (const change of [{ season: 1 }, { episode: 1 }, { title: 'Another Series' }, { id: '1' }]) {
      const mismatched = servicesFor({ vidfast: JSON.stringify({ ...original, ...change }) });
      const outcome = await new CineforkFamily().discoverMedia(episode, source, mismatched, signal);
      if (outcome.type !== 'streams') throw new Error('Expected the other providers to remain');
      expect(outcome.streams.some(stream => stream.hostExtractor === 'vidfast-api')).toBe(false);
    }
  });

  test('ignores a movie response that does not identify the requested media', async () => {
    const result = await new CineforkFamily().discoverMedia(movie, source, servicesFor(Object.fromEntries(['lordflix', 'vidfast', 'vidrock', 'xpass'].map(provider => [provider, fixture('movy-inception.json')]))), signal);
    expect(result).toEqual({ type: 'empty', reason: 'no-streams' });
    const anotherTitle = await new CineforkFamily().discoverMedia({ ...movie, title: 'Another Title' }, source, servicesFor(), signal);
    if (anotherTitle.type !== 'streams') throw new Error('Expected providers that do not declare a title to remain');
    expect(anotherTitle.streams.some(stream => stream.hostExtractor === 'vidfast-api')).toBe(false);
  });

  test('keeps unavailable media absent and reports a source whose providers all fail', async () => {
    const family = new CineforkFamily();
    const unavailable = Object.fromEntries(['lordflix', 'movy', 'vidfast', 'vidrock', 'xpass'].map(provider => [provider, JSON.stringify({ success: false })]));
    await expect(family.discoverMedia(movie, source, servicesFor(unavailable), signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
    const missing = Object.fromEntries(['lordflix', 'movy', 'vidfast', 'vidrock', 'xpass'].map(provider => [provider, failure('HTTP_NOT_FOUND', new URL('https://cinefork.net/'))]));
    await expect(family.discoverMedia(movie, source, servicesFor(missing), signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
    const broken = Object.fromEntries(['lordflix', 'movy', 'vidfast', 'vidrock', 'xpass'].map(provider => [provider, failure('HTTP_SERVER_ERROR', new URL('https://cinefork.net/'))]));
    await expect(family.discoverMedia(movie, source, servicesFor(broken), signal)).rejects.toBeInstanceOf(TransportFailure);
    await expect(family.discoverMedia({ ...movie, tmdbId: 0 }, source, servicesFor(), signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
  });

  test('reports a changed server declaration', async () => {
    await expect(new CineforkFamily().discoverMedia(movie, source, servicesFor({ 'client.txt': fixture('client.txt').replaceAll('responseType', 'kind') }), signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED' } });
  });
});
