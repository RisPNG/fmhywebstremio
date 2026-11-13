import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord, StreamCandidate } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';

interface MovySourcesResponse {
  playlist?: string;
}

const streamApi = 'https://api.wecollege.net';
const payloadMagic = Buffer.from('mvm1');

const mix = (value: number): number => {
  let x = value >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
};
const rotateLeft = (value: number, bits: number): number => (bits & 31) === 0 ? value >>> 0 : ((value << (bits & 31)) | (value >>> (32 - (bits & 31)))) >>> 0;

/** Reproduces the Movy client's keystream so the `enc=2` sources payload can be read with the seed issued for the media ID. */
function decryptSourcesPayload(payload: string, seed: string, mediaId: number): string {
  const bytes = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  let fnv = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) fnv = Math.imul(fnv ^ seed.charCodeAt(index), 0x1000193) >>> 0;
  let state = mix(mix(fnv) ^ mix((mediaId >>> 0) ^ 0x9e3779b9)) >>> 0;
  const slots = new Map<number, number>();
  for (let round = 0; round < 8; round += 1) {
    const slot = state % 61;
    state = rotateLeft((state + 0x9e3779b9) >>> 0, 7 + (round & 7));
    slots.set(slot, (state ^ mix(state)) >>> 0);
    state = mix((state + slot) >>> 0);
  }
  let accumulator = mix(0xa5a5a5a5 ^ state) >>> 0;
  const decrypted = Buffer.alloc(bytes.length);
  for (let offset = 0, counter = 0; offset < bytes.length; counter += 1) {
    const slot = accumulator % 61;
    const present = slots.has(slot) ? 0xffffffff : 0;
    const salt = ((slots.get(slot) ?? 0) ^ Math.imul(0x9e3779b9, counter + 1)) >>> 0;
    const combined = (((accumulator ^ salt) >>> 0) | ((accumulator & salt & present) >>> 0)) >>> 0;
    const blended = (rotateLeft((combined + accumulator) >>> 0, slot) ^ rotateLeft(accumulator, Math.imul(slot, 7))) >>> 0;
    accumulator = mix((blended + 0x9e3779b9) >>> 0);
    slots.set(slot, accumulator);
    for (let shift = 0; shift < 32 && offset < bytes.length; shift += 8, offset += 1) decrypted[offset] = (bytes[offset] as number) ^ ((accumulator >>> shift) & 255);
  }
  if (!decrypted.subarray(0, payloadMagic.length).equals(payloadMagic)) throw new Error('Movy sources payload did not decrypt with the issued seed');
  return decrypted.subarray(payloadMagic.length).toString('utf8');
}

export class MovyFamily implements SourceFamily {
  public readonly id = 'movy';

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if ($('meta[property="og:site_name"]').attr('content') === 'Movy') evidence.push({ type: 'script-signature', fingerprint: 'movy-brand' });
    if ($('meta[property="og:url"]').attr('content')?.replace(/\/$/, '') === 'https://www.movy.sx' && $('script#__NEXT_DATA__').length) evidence.push({ type: 'dom-shape', fingerprint: 'movy-next-catalog' });
    if ($('script[src^="/_next/static/chunks/"]').length) evidence.push({ type: 'asset-path', value: 'movy-next-client' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || !media.imdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const origin = new URL(`https://${source.canonicalDomain}/`);
    let page;
    try {
      page = await services.request({ url: new URL(`/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdbId}`, origin), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    } catch (error) {
      if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
      throw error;
    }
    const $ = cheerio.load(page.text());
    const normalize = (title: string | undefined) => title?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (normalize($('meta[property="og:title"]').attr('content')?.replace(/\s*\|\s*Movy$/, '')) !== normalize(media.title)) return { type: 'empty', reason: 'not-found' };
    const headers = { origin: origin.origin, referer: origin.href };
    const seedResponse = await services.request({ url: new URL(`/seed?mediaId=${media.tmdbId}`, streamApi), expectedContent: 'json', headers, referrer: origin, stateScope: { kind: 'source', key: source.id } }, signal);
    const seed = (seedResponse.json() as { seed?: string }).seed;
    if (!seed) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Movy stream API did not issue a seed', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: seedResponse.status, bodyCaptured: false, parserPath: 'seed' } } };
    const sources = new URL('/miami/sources', streamApi);
    sources.searchParams.set('title', encodeURIComponent(media.title));
    sources.searchParams.set('mediaType', media.type === 'movie' ? 'movie' : 'tv');
    if (media.year !== undefined) sources.searchParams.set('year', String(media.year));
    sources.searchParams.set('episodeId', String(media.episode ?? 1));
    sources.searchParams.set('seasonId', String(media.season ?? 1));
    sources.searchParams.set('tmdbId', String(media.tmdbId));
    sources.searchParams.set('imdbId', media.imdbId);
    sources.searchParams.set('enc', '2');
    sources.searchParams.set('seed', seed);
    let response;
    try {
      response = await services.request({ url: sources, expectedContent: 'text', headers, referrer: origin, stateScope: { kind: 'source', key: source.id } }, signal);
    } catch (error) {
      if (error instanceof TransportFailure && error.failure.code === 'HTTP_SERVER_ERROR') return { type: 'empty', reason: 'no-streams' };
      throw error;
    }
    let payload: MovySourcesResponse;
    try {
      payload = JSON.parse(decryptSourcesPayload(response.text().trim(), seed, media.tmdbId)) as MovySourcesResponse;
    } catch {
      return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Movy sources payload could not be decrypted into JSON', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'sources' } } };
    }
    if (!payload.playlist) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Movy sources response did not contain a playlist', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'sources' } } };
    const url = new URL(payload.playlist);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { type: 'empty', reason: 'no-streams' };
    const stream: StreamCandidate = { url, protocol: 'hls', delivery: 'relayed', headers, hostExtractor: 'miami-api', sourceId: source.id, sourceExtractor: this.id, discoveredAt: new Date() };
    return { type: 'streams', streams: [stream] };
  }
}
