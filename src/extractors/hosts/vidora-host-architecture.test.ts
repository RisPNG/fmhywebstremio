import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { HlsRelay } from '../../addon/stremio-adapter/hls-relay';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices } from '../../engine/core/models';
import { StreamSelector } from '../../engine/protocols';
import { TransportFailure } from '../../engine/transport/transport-director';
import { VidoraPlayerHostArchitecture } from './vidora-host-architecture';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/vidora/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('Vidora native player architecture', () => {
  const movie: MediaIdentity = { canonicalId: 'tmdb:1303517', type: 'movie', tmdbId: 1303517, title: 'Kahar: Kapla High Council', year: 2024 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:334097:1:4', type: 'episode', tmdbId: 334097, title: 'Kudrat 1968: High Council', year: 2026, season: 1, episode: 4 };
  const referrer = new URL('https://catalog.greybox.test/stream/tv/334097/1/4');
  const player = new URL('https://configured.vidora.test/embed/tv/334097/1/4');

  test.each([{ media: movie, page: 'player-movie.html', sources: 'movie-generation-1.ndjson', count: 3 }, { media: episode, page: 'player-episode.html', sources: 'episode-generation-1.ndjson', count: 2 }])('preserves the native page session and both source generations for $media.canonicalId', async ({ media, page, sources, count }) => {
    const target = new URL(media.type === 'movie' ? '/embed/movie/1303517' : '/embed/tv/334097/1/4', player);
    const finalPage = new URL(target);
    finalPage.searchParams.set('theme', 'blue');
    const apiCalls: ExtractionRequest[] = [];
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.pathname.startsWith('/embed/')) {
        expect(request.referrer).toEqual(referrer);
        expect(request.stateScope).toEqual({ kind: 'host', key: target.hostname });
        return response(finalPage, fixture(page));
      }
      if (request.url.pathname.endsWith('shared.js')) return response(request.url, '(globalThis.TURBOPACK ||= []).push([])');
      if (request.url.pathname.endsWith('player-client.js')) {
        expect(request.referrer).toEqual(finalPage);
        return response(request.url, fixture('player-client.txt'));
      }
      if (request.url.pathname === '/api/sources') {
        apiCalls.push(request);
        expect(request.referrer).toEqual(finalPage);
        expect(request.stateScope).toEqual({ kind: 'host', key: target.hostname });
        expect(request.headers).toBeUndefined();
        expect(request.timeoutMs).toBe(40000);
        return response(request.url, request.url.searchParams.has('gen') ? fixture('episode-generation-2.ndjson') : fixture(sources));
      }
      expect(request.method).toBe('HEAD');
      expect(request.headers).toEqual({ 'User-Agent': 'curl/8.5.0' });
      return { ...response(request.url, ''), headers: { 'content-type': 'video/mp4', 'accept-ranges': 'bytes' } };
    }) };
    const signal = new AbortController().signal;
    const result = await new VidoraPlayerHostArchitecture().discover(media, target, 'greybox:catalog.greybox.test', 'greybox', services, signal, referrer);
    expect(apiCalls).toHaveLength(2);
    expect(apiCalls.map(call => Object.fromEntries(call.url.searchParams))).toEqual([
      { type: media.type === 'movie' ? 'movie' : 'tv', id: String(media.tmdbId), ...(media.type === 'episode' && { season: '1', episode: '4' }) },
      { type: media.type === 'movie' ? 'movie' : 'tv', id: String(media.tmdbId), ...(media.type === 'episode' && { season: '1', episode: '4' }), gen: '2' },
    ]);
    if (result.type !== 'streams') throw new Error('Expected direct Vidora streams');
    expect(result.streams).toHaveLength(count);
    expect(result.streams.every(stream => stream.protocol === 'http' && stream.delivery === 'relayed' && stream.hostExtractor === 'vidora-player')).toBe(true);
    expect(result.streams.every(stream => stream.url.hostname === 'bcdn.media.test' && !stream.providerContentId && !stream.declaredResolution && !stream.language)).toBe(true);
    if (media.type === 'episode') expect(result.streams[0]?.subtitles).toEqual([{ url: new URL('/api/media?u=aHR0cHM6Ly9zdWJ0aXRsZS50ZXN0L2VuZ2xpc2guc3J0', finalPage), label: 'English', language: 'english', format: 'srt' }]);
    const validation = await new StreamSelector(services).validate(result.streams, { concurrency: 2 }, signal);
    expect(validation.failures).toEqual([]);
    expect(validation.streams).toHaveLength(count);
    expect(validation.streams.every(stream => stream.validation === 'validated' && stream.headers?.['User-Agent'] === 'curl/8.5.0' && stream.resolution === undefined)).toBe(true);
    const relay = new HlsRelay();
    const stream = result.streams[0];
    if (!stream) throw new Error('Expected a direct stream');
    const signed = relay.createUrl(new URL('https://addon.test/'), { url: stream.url, ...(stream.headers && { headers: stream.headers }), resource: { kind: 'file' } });
    const parts = signed.pathname.split('/');
    expect(relay.resolveTarget(parts.at(-3) as string, parts.at(-2) as string)).toEqual({ url: stream.url, headers: { 'User-Agent': 'curl/8.5.0' }, resource: { kind: 'file' } });
  });

  test('uses the final replacement for each generation and retains every direct alternative', async () => {
    const services: RequestServices = { request: jest.fn(async (request) => {
      if (request.url.pathname.startsWith('/embed/')) return response(request.url, fixture('player-episode.html'));
      if (request.url.pathname.endsWith('.js')) return response(request.url, fixture('player-client.txt').replace('/api/sources', '/native/playback'));
      expect(request.url.pathname).toBe('/native/playback');
      const generation = request.url.searchParams.has('gen') ? 2 : 1;
      const sources = [1080, 720, 480].map(height => ({ url: `https://media.test/gen${generation}/${height}.${height === 720 ? 'm3u8' : 'mp4'}`, type: height === 720 ? 'hls' : 'mp4', server: `native-${generation}-${height}`, quality: `${height}p`, gen: generation }));
      return response(request.url, [
        JSON.stringify({ event: 'source', source: { url: `https://media.test/stale${generation}.mp4`, type: 'mp4', server: `stale-${generation}`, gen: generation } }),
        JSON.stringify({ event: 'done', sources }),
      ].join('\n'));
    }) };
    const result = await new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, new AbortController().signal, referrer);
    if (result.type !== 'streams') throw new Error('Expected both generations');
    expect(result.streams).toHaveLength(6);
    expect(result.streams.filter(stream => stream.protocol === 'hls')).toHaveLength(2);
    expect(result.streams.some(stream => stream.url.pathname.includes('stale'))).toBe(false);
    expect(result.streams.every(stream => !stream.headers && !stream.declaredResolution)).toBe(true);
  });

  test('uses valid source events when a generation ends without a final replacement', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname.startsWith('/embed/') ? fixture('player-episode.html') : request.url.pathname.endsWith('.js') ? fixture('player-client.txt') : request.url.searchParams.has('gen') ? '{"event":"done","sources":[]}' : 'not-json\n{"event":"source","source":{"url":"https://media.test/partial.mp4","server":"partial","type":"mp4","gen":1}}\n')) };
    await expect(new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, new AbortController().signal, referrer)).resolves.toMatchObject({ type: 'streams', streams: [{ url: new URL('https://media.test/partial.mp4') }] });
  });

  test('an empty final replacement removes earlier provisional streams', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname.startsWith('/embed/') ? fixture('player-episode.html') : request.url.pathname.endsWith('.js') ? fixture('player-client.txt') : '{"event":"source","source":{"url":"https://media.test/stale.mp4","type":"mp4","gen":1}}\n{"event":"done","sources":[]}\n')) };
    await expect(new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, new AbortController().signal, referrer)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
  });

  test('one failed generation cannot suppress the other generation streams', async () => {
    const services: RequestServices = { request: jest.fn(async (request) => {
      if (request.url.pathname.startsWith('/embed/')) return response(request.url, fixture('player-episode.html'));
      if (request.url.pathname.endsWith('.js')) return response(request.url, fixture('player-client.txt'));
      if (request.url.searchParams.has('gen')) throw new TransportFailure({ code: 'HTTP_FORBIDDEN', message: 'Forbidden', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', status: 403, bodyCaptured: false } });
      return response(request.url, fixture('episode-generation-1.ndjson'));
    }) };
    await expect(new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, new AbortController().signal, referrer)).resolves.toMatchObject({ type: 'streams', streams: [{ protocol: 'http' }, { protocol: 'http' }] });
  });

  test('keeps the canonical transport failure when both source generations fail', async () => {
    const failure = new TransportFailure({ code: 'RATE_LIMITED', message: 'Rate limited', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', status: 429, bodyCaptured: false } });
    const services: RequestServices = { request: jest.fn(async (request) => {
      if (request.url.pathname.startsWith('/embed/')) return response(request.url, fixture('player-episode.html'));
      if (request.url.pathname.endsWith('.js')) return response(request.url, fixture('player-client.txt'));
      throw failure;
    }) };
    await expect(new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, new AbortController().signal, referrer)).rejects.toBe(failure);
  });

  test.each([{ changes: ['\\"id\\":334097', '\\"id\\":218507'] }, { changes: ['\\"type\\":\\"tv\\"', '\\"type\\":\\"movie\\"'] }, { changes: ['\\"title\\":\\"Kudrat 1968: High Council\\"', '\\"title\\":\\"Project: High Council\\"'] }, { changes: ['\\"season\\":1', '\\"season\\":2'] }, { changes: ['\\"episode\\":4', '\\"episode\\":3'] }])('rejects a different native player identity $changes', async ({ changes }) => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, fixture('player-episode.html').replace(changes[0] as string, changes[1] as string))) };
    await expect(new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, new AbortController().signal, referrer)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED' } });
    expect(services.request).toHaveBeenCalledTimes(1);
  });

  test('does not invent an API when the current player client removes its generations', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname.startsWith('/embed/') ? fixture('player-episode.html') : 'export const removed = true;')) };
    await expect(new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, new AbortController().signal, referrer)).resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', diagnostic: { parserPath: 'player-client' } } });
    expect(services.request).toHaveBeenCalledTimes(3);
  });

  test('reports a missing embedded player configuration', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, '<html><title>Vidora</title></html>')) };
    await expect(new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, new AbortController().signal, referrer)).resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', diagnostic: { parserPath: 'player-configuration' } } });
    expect(services.request).toHaveBeenCalledTimes(1);
  });

  test('reports a changed NDJSON response rather than claiming an absent title', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname.startsWith('/embed/') ? fixture('player-episode.html') : request.url.pathname.endsWith('.js') ? fixture('player-client.txt') : '{"message":"The player protocol changed"}\nnot-json')) };
    await expect(new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, new AbortController().signal, referrer)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED' } });
  });

  test('keeps an iframe-only completed response empty', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.pathname.startsWith('/embed/') ? fixture('player-episode.html') : request.url.pathname.endsWith('.js') ? fixture('player-client.txt') : fixture('episode-generation-2.ndjson'))) };
    await expect(new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, new AbortController().signal, referrer)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
  });

  test('starts both native generations together and preserves the caller cancellation', async () => {
    const controller = new AbortController();
    const failure = new Error('Caller deadline');
    let started = 0;
    const services: RequestServices = { request: jest.fn(async (request, signal) => {
      if (request.url.pathname.startsWith('/embed/')) return response(request.url, fixture('player-episode.html'));
      if (request.url.pathname.endsWith('.js')) return response(request.url, fixture('player-client.txt'));
      return new Promise<ExtractionResponse>((_resolve, reject) => {
        expect(signal).toBeDefined();
        if (!signal) throw new Error('Expected a shared signal');
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        started += 1;
        if (started === 2) controller.abort(failure);
      });
    }) };
    await expect(new VidoraPlayerHostArchitecture().discover(episode, player, 'source', 'family', services, controller.signal, referrer)).rejects.toBe(failure);
    expect(started).toBe(2);
  });
});
