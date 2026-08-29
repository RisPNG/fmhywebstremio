import { createHash } from 'node:crypto';
import type { ExtractionResult, ExtractionTarget, Extractor, MatchResult, RequestServices, StreamCandidate } from '../../engine/core/models';

interface CinextreamServer { name?: string; apiUrl?: string; responseType?: string }
interface CinextreamEncryptedResponse { enc?: string }
interface BingrResponse { servers?: readonly { sources?: readonly { url?: string; quality?: string; type?: string }[] }[] }

export interface CinextreamEnvelopeDecoder {
  decrypt(envelope: string, tmdbId: number, salt: string, wasmUrl: URL, services: RequestServices, signal: AbortSignal): Promise<unknown>;
}

export class WasmCinextreamEnvelopeDecoder implements CinextreamEnvelopeDecoder {
  public async decrypt(envelope: string, tmdbId: number, salt: string, wasmUrl: URL, services: RequestServices, signal: AbortSignal): Promise<unknown> {
    const response = await services.request({ url: wasmUrl, expectedContent: 'binary', stateScope: { kind: 'host', key: wasmUrl.hostname } }, signal);
    const wasm = (globalThis as typeof globalThis & { WebAssembly: { instantiate(bytes: Uint8Array, imports: { env: { abort(): void } }): Promise<{ instance: { exports: unknown } }> } }).WebAssembly;
    const module = await wasm.instantiate(response.body, { env: { abort: () => undefined } });
    const exports = module.instance.exports as { memory?: { buffer: ArrayBuffer }; allocBuffer?: (size: number) => number; freeBuffer?: (pointer: number) => void; normalizeBuffer?: (encryptedPointer: number, encryptedLength: number, keyPointer: number, outputPointer: number) => number };
    if (!exports.memory || typeof exports.allocBuffer !== 'function' || typeof exports.freeBuffer !== 'function' || typeof exports.normalizeBuffer !== 'function') throw new Error('Cinextream decryption module has an unsupported interface');
    const encrypted = Buffer.from(envelope, 'base64');
    const key = createHash('sha256').update(`${tmdbId}${salt}`).digest();
    const encryptedPointer = exports.allocBuffer(encrypted.byteLength);
    const keyPointer = exports.allocBuffer(key.byteLength);
    const outputPointer = exports.allocBuffer(encrypted.byteLength);
    try {
      let memory = new Uint8Array(exports.memory.buffer);
      memory.set(encrypted, encryptedPointer);
      memory.set(key, keyPointer);
      const length = exports.normalizeBuffer(encryptedPointer, encrypted.byteLength, keyPointer, outputPointer);
      memory = new Uint8Array(exports.memory.buffer);
      return JSON.parse(new TextDecoder().decode(memory.slice(outputPointer, outputPointer + length))) as unknown;
    } finally {
      exports.freeBuffer(encryptedPointer);
      exports.freeBuffer(keyPointer);
      exports.freeBuffer(outputPointer);
    }
  }
}

export default class CinextreamHostExtractor implements Extractor {
  public readonly id = 'cinextream';

  public constructor(private readonly decoder: CinextreamEnvelopeDecoder = new WasmCinextreamEnvelopeDecoder()) {}

  public match(target: ExtractionTarget): MatchResult | null {
    return target.url.hostname === 'cinextream.cc' && /^\/api\/embed\/(?:movie|tv)\//.test(target.url.pathname) ? { matcherId: 'cinextream-player', confidence: 30 } : null;
  }

  public async extract(target: ExtractionTarget, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    const media = target.media;
    if (!media?.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const player = await services.request({ url: target.url, ...(target.referrer && { referrer: target.referrer }), expectedContent: 'html', stateScope: { kind: 'host', key: target.url.hostname } }, signal);
    const serversJson = player.text().match(/\bSERVERS\s*=\s*(\[[^;]+\])/s)?.[1];
    const salt = player.text().match(/\b_SALT\s*=\s*"([^"]+)"/)?.[1];
    if (!serversJson || !salt) return { type: 'failure', failure: { code: 'SCRIPT_DATA_MISSING', message: 'Cinextream player configuration was not found', extractorId: this.id, targetHost: player.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: player.status, finalUrl: player.finalUrl.href, bodyCaptured: false } } };
    let servers: readonly CinextreamServer[];
    try {
      servers = JSON.parse(serversJson) as readonly CinextreamServer[];
    } catch {
      return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cinextream player server configuration is invalid', extractorId: this.id, targetHost: player.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: player.status, finalUrl: player.finalUrl.href, bodyCaptured: false } } };
    }
    const server = servers.find(value => value.responseType === 'bingr' && value.apiUrl);
    if (!server?.apiUrl) return { type: 'empty', reason: 'no-streams' };
    const endpoint = new URL(server.apiUrl, player.finalUrl);
    const response = await services.request({ url: endpoint, expectedContent: 'json', referrer: player.finalUrl, stateScope: { kind: 'host', key: endpoint.hostname } }, signal);
    const envelope = (response.json() as CinextreamEncryptedResponse).enc;
    if (!envelope) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cinextream playback response did not contain an encrypted envelope', extractorId: this.id, targetHost: endpoint.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, finalUrl: response.finalUrl.href, bodyCaptured: true, bodyBytes: response.body.byteLength, parserPath: 'enc' } } };
    const payload = await this.decoder.decrypt(envelope, media.tmdbId, salt, new URL('/decrypt.wasm', player.finalUrl), services, signal) as BingrResponse;
    const streams: StreamCandidate[] = (payload.servers ?? []).flatMap(value => value.sources ?? []).flatMap((source) => {
      if (!source.url) return [];
      const url = new URL(source.url, response.finalUrl);
      const height = Number.parseInt(source.quality ?? '');
      return [{ url, protocol: source.type?.includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(url.href) ? 'hls' as const : 'http' as const, sourceId: String(target.hints?.['sourceId'] ?? target.url.hostname), sourceExtractor: String(target.hints?.['sourceExtractor'] ?? 'cinetaro'), hostExtractor: this.id, ...(height > 0 && { declaredResolution: { width: Math.round(height * 16 / 9), height } }), ...(server.name && { label: server.name }), discoveredAt: new Date() }];
    });
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
