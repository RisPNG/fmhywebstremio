import { createHash } from 'node:crypto';
import type { ExtractionResponse, ExtractionResult, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';
import { TransportFailure } from '../../engine/transport/transport-director';

const playerEnvelopeSeed = '9e2b7c41a0f6d85b3c1e7a94f25d0b86';
const qualityHeights: Readonly<Record<string, number>> = { '4K ULTRA HD': 2160, 'FULL HD': 1080, 'HD': 720, 'SD': 480 };

interface BingeBangSourceList {
  servers?: readonly { id?: string; label?: string; quality?: string; source_url?: string }[];
}

export function decryptBingeBangEnvelope(envelope: string, ticket: string): string {
  const key = createHash('sha256').update(`${playerEnvelopeSeed}${ticket}`).digest();
  const payload = Buffer.from(envelope, 'base64url');
  if (payload.byteLength <= 16) throw new Error('BingeBang player envelope is shorter than its nonce');
  const nonce = payload.subarray(0, 16);
  const encrypted = payload.subarray(16);
  const plaintext = Buffer.alloc(encrypted.byteLength);
  const counterBlock = Buffer.concat([key, nonce, Buffer.alloc(4)]);
  for (let offset = 0, counter = 0; offset < encrypted.byteLength; offset += 32, counter++) {
    counterBlock.writeUInt32BE(counter, key.byteLength + nonce.byteLength);
    const keystream = createHash('sha256').update(counterBlock).digest();
    for (let index = 0; index < keystream.byteLength && offset + index < encrypted.byteLength; index++) plaintext[offset + index] = (encrypted[offset + index] as number) ^ (keystream[index] as number);
  }
  return plaintext.toString('utf8');
}

export function readBingeBangPlayerConfiguration(html: string): string | undefined {
  const block = html.match(/var k=\[([\d,\s]+)\],d=\[([\d,\s]+)\]/);
  if (!block?.[1] || !block[2]) return undefined;
  const key = block[1].split(',').map(Number);
  const data = block[2].split(',').map(Number);
  return Buffer.from(data.map((value, index) => value ^ (key[index % key.length] as number))).toString('utf8');
}

export interface BingeBangHostArchitecture {
  discover(player: URL, media: MediaIdentity, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class BingeBangPlayerHostArchitecture implements BingeBangHostArchitecture {
  public constructor(private readonly maxServers = 4) {}

  public async discover(player: URL, media: MediaIdentity, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (media.type === 'episode' && (!media.season || !media.episode)) return { type: 'empty', reason: 'not-found' };
    const episodePlayer = media.type === 'episode' ? new URL(`${player.pathname}/${media.season}/${media.episode}`, player) : player;
    let page: ExtractionResponse;
    try {
      page = await services.request({ url: episodePlayer, expectedContent: 'html', stateScope: { kind: 'host', key: player.hostname } }, signal);
    } catch (error) {
      if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
      throw error;
    }
    const failure = (message: string, parserPath: string, response: ExtractionResponse): ExtractionResult => ({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message, stage: 'stage:extraction', sourceId, familyId: sourceExtractor, extractorId: 'bingebang-player', targetHost: player.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, finalUrl: response.finalUrl.toString(), bodyCaptured: false, parserPath } } });
    const configuration = readBingeBangPlayerConfiguration(page.text());
    const ticket = configuration?.match(/ticket:\s*"([^"]+)"/)?.[1];
    if (!configuration || !ticket) return failure('BingeBang player page no longer exposes its player configuration', 'ticket', page);
    const declaredType = configuration.match(/mediaType:\s*"([a-z]+)"/)?.[1];
    const declaredEpisode = configuration.match(/season:\s*(\d+),\s*episode:\s*(\d+)/);
    if (declaredType !== (media.type === 'movie' ? 'movie' : 'episode')) return { type: 'empty', reason: 'not-found' };
    if (media.type === 'episode' && (Number(declaredEpisode?.[1]) !== media.season || Number(declaredEpisode?.[2]) !== media.episode)) return { type: 'empty', reason: 'not-found' };
    const request = (path: string) => ({ url: new URL(path, player), headers: { 'X-BB-Player': '1', 'X-BB-Ticket': ticket }, referrer: episodePlayer, expectedContent: 'json' as const, stateScope: { kind: 'host' as const, key: player.hostname } });
    const listResponse = await services.request(request('/api/player/sources'), signal);
    const envelope = (listResponse.json() as { enc?: string }).enc;
    if (typeof envelope !== 'string') return failure('BingeBang player source list is no longer an encrypted envelope', 'enc', listResponse);
    const servers = (JSON.parse(decryptBingeBangEnvelope(envelope, ticket)) as BingeBangSourceList).servers;
    if (!Array.isArray(servers)) return failure('BingeBang player source list did not contain servers', 'servers', listResponse);
    const referer = `${player.origin}/`;
    const streams: StreamCandidate[] = [];
    for (const server of servers.slice(0, this.maxServers)) {
      if (!server.source_url) continue;
      const resolveResponse = await services.request(request(`/api/player/resolve?src=${encodeURIComponent(server.source_url)}`), signal);
      const resolved = JSON.parse(decryptBingeBangEnvelope((resolveResponse.json() as { enc?: string }).enc ?? '', ticket)) as { ok?: boolean; url?: string; type?: string };
      if (!resolved.ok || !resolved.url) continue;
      const height = qualityHeights[(server.quality ?? '').toUpperCase()];
      streams.push({ url: new URL(resolved.url), protocol: resolved.type === 'hls' ? 'hls' : 'http', headers: { referer }, delivery: 'relayed', sourceId, sourceExtractor, hostExtractor: 'bingebang-player', ...(server.label && { label: server.quality ? `${server.label} ${server.quality}` : server.label }), ...(height && { declaredResolution: { width: Math.round(height * 16 / 9), height } }), discoveredAt: new Date() });
    }
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
