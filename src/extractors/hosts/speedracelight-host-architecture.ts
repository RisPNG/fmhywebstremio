import type { ExtractionResult, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface SpeedracelightPayload {
  sources?: readonly { url?: string; type?: string; quality?: string }[];
}

const roundConstants = [1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580];

function avalancheSpeedracelightWord(value: number): number {
  value >>>= 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2246822507) >>> 0;
  value ^= value >>> 13;
  value = Math.imul(value, 3266489909) >>> 0;
  return (value ^ value >>> 16) >>> 0;
}

function rotateSpeedracelightWord(value: number, amount: number): number {
  value >>>= 0;
  amount &= 31;
  return amount === 0 ? value : (value << amount | value >>> 32 - amount) >>> 0;
}

export function decryptSpeedracelightEnvelope(envelope: string, seed: string, mediaId: number): string {
  const normalized = envelope.replace(/-/g, '+').replace(/_/g, '/').padEnd(4 * Math.ceil(envelope.length / 4), '=');
  const encrypted = new Uint8Array(Buffer.from(normalized, 'base64'));
  let state: { values: number[]; accumulator: number };
  if ((seed.length * (seed.length + 1) & 1) === 1) {
    const values = Array.from({ length: 256 }, (_value, index) => index);
    let position = 0;
    for (let index = 0; index < 256; index++) {
      position = position + (values[index] ?? 0) + seed.charCodeAt(index % seed.length) & 255;
      const current = values[index] ?? 0;
      values[index] = values[position] ?? 0;
      values[position] = current;
    }
    let accumulator = 1732584193;
    for (let index = 0; index < seed.length; index++) accumulator = rotateSpeedracelightWord((accumulator ^ Math.imul(seed.charCodeAt(index), roundConstants[index & 15] ?? 0)) >>> 0, 5);
    state = { values, accumulator: avalancheSpeedracelightWord(accumulator) };
  } else {
    const values = Array<number>(61);
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
    hash = avalancheSpeedracelightWord((avalancheSpeedracelightWord(hash) ^ avalancheSpeedracelightWord((mediaId >>> 0) ^ 2654435769)) >>> 0);
    for (let index = 0; index < 8; index++) {
      if ((index * (index + 1) & 1) === 0) {
        const position = hash % 61;
        hash = rotateSpeedracelightWord((hash + 2654435769) >>> 0, 7 + (7 & index));
        values[position] = (hash ^ avalancheSpeedracelightWord(hash)) >>> 0;
        hash = avalancheSpeedracelightWord((hash + position) >>> 0);
      } else {
        values[index] = roundConstants[index & 15] ?? 0;
      }
    }
    state = { values, accumulator: avalancheSpeedracelightWord((2779096485 ^ hash) >>> 0) };
  }
  const key = new Uint8Array(encrypted.length);
  let wordIndex = 0;
  for (let index = 0; index < key.length;) {
    const position = state.accumulator % 61;
    const present = 0 - Number(position in state.values);
    const value = state.values[position] ?? 0;
    const transformed = (value ^ Math.imul(2654435769, wordIndex + 1)) >>> 0;
    let word = ((state.accumulator ^ transformed) | (state.accumulator & transformed & present)) >>> 0;
    word = (rotateSpeedracelightWord((word + state.accumulator) >>> 0, 31 & position) ^ rotateSpeedracelightWord(state.accumulator, 31 & Math.imul(position, 7))) >>> 0;
    state.accumulator = avalancheSpeedracelightWord((word + 2654435769) >>> 0);
    state.values[position] = state.accumulator;
    wordIndex++;
    key[index++] = state.accumulator & 255;
    if (index < key.length) key[index++] = state.accumulator >>> 8 & 255;
    if (index < key.length) key[index++] = state.accumulator >>> 16 & 255;
    if (index < key.length) key[index++] = state.accumulator >>> 24 & 255;
  }
  for (let index = 0; index < encrypted.length; index++) encrypted[index] = (encrypted[index] ?? 0) ^ (key[index] ?? 0);
  if (!Buffer.from(encrypted.subarray(0, 4)).equals(Buffer.from('mvm1'))) throw new Error('Speedracelight source envelope could not be decrypted');
  return new TextDecoder().decode(encrypted.subarray(4));
}

export interface SpeedracelightHostArchitecture {
  discover(media: MediaIdentity, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class SpeedracelightApiHostArchitecture implements SpeedracelightHostArchitecture {
  public async discover(media: MediaIdentity, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const endpoint = new URL('https://api.speedracelight.com/cdn/sources-with-title');
    const seedResponse = await services.request({ url: new URL(`/seed?mediaId=${media.tmdbId}`, endpoint), expectedContent: 'json', stateScope: { kind: 'host', key: endpoint.hostname } }, signal);
    const seed = (seedResponse.json() as { seed?: string }).seed;
    if (!seed) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Speedracelight seed response did not contain a seed', stage: 'stage:extraction', sourceId, extractorId: 'speedracelight-api', targetHost: endpoint.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: seedResponse.status, ...(seedResponse.headers['content-type'] && { contentType: seedResponse.headers['content-type'] }), finalUrl: seedResponse.finalUrl.toString(), bodyCaptured: true, bodyBytes: seedResponse.body.byteLength, parserPath: 'seed' } } };
    endpoint.searchParams.set('title', encodeURIComponent(media.title));
    endpoint.searchParams.set('mediaType', media.type === 'movie' ? 'movie' : 'tv');
    if (media.year) endpoint.searchParams.set('year', String(media.year));
    if (media.type === 'episode') {
      endpoint.searchParams.set('seasonId', String(media.season));
      endpoint.searchParams.set('episodeId', String(media.episode));
    }
    endpoint.searchParams.set('tmdbId', String(media.tmdbId));
    if (media.imdbId) endpoint.searchParams.set('imdbId', media.imdbId);
    endpoint.searchParams.set('enc', '2');
    endpoint.searchParams.set('seed', seed);
    const response = await services.request({ url: endpoint, expectedContent: 'text', stateScope: { kind: 'host', key: endpoint.hostname } }, signal);
    let payload: SpeedracelightPayload;
    try {
      payload = JSON.parse(decryptSpeedracelightEnvelope(response.text(), seed, media.tmdbId)) as SpeedracelightPayload;
    } catch (error) {
      return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: error instanceof Error ? error.message : String(error), stage: 'stage:extraction', sourceId, extractorId: 'speedracelight-api', targetHost: endpoint.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, ...(response.headers['content-type'] && { contentType: response.headers['content-type'] }), finalUrl: response.finalUrl.toString(), bodyCaptured: true, bodyBytes: response.body.byteLength, parserPath: 'encrypted.sources' } } };
    }
    const streams: StreamCandidate[] = (payload.sources ?? []).flatMap((stream) => {
      if (!stream.url) return [];
      const url = new URL(stream.url);
      const height = /^4k$/i.test(stream.quality ?? '') ? 2160 : Number(stream.quality?.match(/\d+/)?.[0]);
      return [{ url, protocol: stream.type === 'm3u8' || /\.m3u8(?:$|\?)/i.test(url.href) ? 'hls' as const : stream.type === 'dash' || /\.mpd(?:$|\?)/i.test(url.href) ? 'dash' as const : 'http' as const, sourceId, sourceExtractor, hostExtractor: 'speedracelight-api', ...(stream.quality && { label: stream.quality }), ...(height > 0 && { declaredResolution: { width: Math.round(height * 16 / 9), height } }), discoveredAt: new Date() }];
    });
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
