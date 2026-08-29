import type { ExtractionResult, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface VidsrcMeResponse {
  status_code?: number;
  data?: { stream_urls?: string | readonly string[]; title?: string };
  vs?: { wasm_url?: string };
}

export interface VidsrcMeEnvelopeDecoder {
  decrypt(envelope: string, wasmUrl: URL, services: RequestServices, signal: AbortSignal): Promise<readonly string[]>;
}

export class WasmVidsrcMeEnvelopeDecoder implements VidsrcMeEnvelopeDecoder {
  public async decrypt(envelope: string, wasmUrl: URL, services: RequestServices, signal: AbortSignal): Promise<readonly string[]> {
    const response = await services.request({ url: wasmUrl, expectedContent: 'binary', stateScope: { kind: 'host', key: wasmUrl.hostname } }, signal);
    const wasm = (globalThis as typeof globalThis & { WebAssembly: { instantiate(bytes: Uint8Array): Promise<{ instance: { exports: unknown } }> } }).WebAssembly;
    const module = await wasm.instantiate(response.body);
    const exports = module.instance.exports as { memory?: { buffer: ArrayBuffer }; alloc?: (size: number) => number; decrypt?: (pointer: number, length: number) => number };
    if (!exports.memory || typeof exports.alloc !== 'function' || typeof exports.decrypt !== 'function') throw new Error('VidsrcMe decryption module has an unsupported interface');
    const encrypted = Buffer.from(envelope, 'base64');
    const pointer = exports.alloc(encrypted.byteLength);
    new Uint8Array(exports.memory.buffer, pointer, encrypted.byteLength).set(encrypted);
    const length = exports.decrypt(pointer, encrypted.byteLength);
    const plaintext = new TextDecoder().decode(new Uint8Array(exports.memory.buffer, pointer + 12, length));
    if (/^https?:\/\//i.test(plaintext)) return plaintext.split(/(?=https?:\/\/)/).filter(Boolean);
    const decoded: unknown = JSON.parse(plaintext);
    if (!Array.isArray(decoded) || decoded.some(value => typeof value !== 'string')) throw new Error('VidsrcMe stream envelope has an unsupported shape');
    return decoded;
  }
}

export interface VidsrcMeHostArchitecture {
  discover(media: MediaIdentity, sourceId: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class VidsrcMeApiHostArchitecture implements VidsrcMeHostArchitecture {
  public constructor(private readonly decoder: VidsrcMeEnvelopeDecoder = new WasmVidsrcMeEnvelopeDecoder()) {}

  public async discover(media: MediaIdentity, sourceId: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const endpoint = new URL('https://data.vidsrcme.ru/api.php');
    endpoint.searchParams.set('type', media.type === 'movie' ? 'movie' : 'tv');
    endpoint.searchParams.set('tmdb', String(media.tmdbId));
    if (media.type === 'episode') {
      endpoint.searchParams.set('season', String(media.season));
      endpoint.searchParams.set('episode', String(media.episode));
    }
    endpoint.searchParams.set('stream_urls', '');
    const response = await services.request({ url: endpoint, expectedContent: 'json', timeoutMs: 30000, stateScope: { kind: 'host', key: endpoint.hostname } }, signal);
    const payload = response.json() as VidsrcMeResponse;
    const envelope = payload.data?.stream_urls;
    if (!envelope || (typeof envelope !== 'string' && !Array.isArray(envelope))) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'VidsrcMe response did not contain stream URLs', stage: 'stage:extraction', sourceId, extractorId: 'vidsrcme-api', targetHost: endpoint.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, ...(response.headers['content-type'] && { contentType: response.headers['content-type'] }), finalUrl: response.finalUrl.toString(), bodyCaptured: true, bodyBytes: response.body.byteLength, parserPath: 'data.stream_urls' } } };
    const urls = Array.isArray(envelope) ? envelope : payload.vs?.wasm_url ? await this.decoder.decrypt(envelope, new URL(payload.vs.wasm_url, response.finalUrl), services, signal) : [];
    const streams: StreamCandidate[] = [];
    const hostTokens = new Map<string, string>();
    for (const value of urls) {
      const mediaUrl = new URL(value);
      let token = hostTokens.get(mediaUrl.hostname);
      if (!token) {
        const tokenResponse = await services.request({ url: new URL('/generate.php', mediaUrl), expectedContent: 'text', referrer: endpoint, stateScope: { kind: 'host', key: mediaUrl.hostname } }, signal);
        const tokenText = tokenResponse.text().trim();
        token = tokenText;
        if (tokenText.startsWith('{')) {
          const tokenPayload = JSON.parse(tokenText) as { token?: string; data?: string; result?: string };
          token = tokenPayload.token ?? tokenPayload.data ?? tokenPayload.result ?? '';
        }
        if (token) hostTokens.set(mediaUrl.hostname, token);
      }
      if (!token) continue;
      mediaUrl.searchParams.set('token', token);
      streams.push({ url: mediaUrl, protocol: /\.m3u8(?:$|\?)/i.test(mediaUrl.href) ? 'hls' : 'http', sourceId, sourceExtractor: 'cinego', hostExtractor: 'vidsrcme-api', ...(payload.data?.title && { label: payload.data.title }), discoveredAt: new Date() });
    }
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
