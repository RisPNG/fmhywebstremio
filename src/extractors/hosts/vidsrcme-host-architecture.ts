import * as cheerio from 'cheerio';
import type { ExtractionResult, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';
import { sanitizeDiagnosticUrl } from '../../engine/core/models';

interface VidsrcMeResponse {
  status_code?: number;
  data?: { stream_urls?: string | readonly string[]; title?: string };
  vs?: { wasm_url?: string };
}

interface VidsrcMePlayerConfiguration {
  mediaType?: string;
  tmdb?: string | number;
  season?: number;
  episode?: number;
  api?: string;
  streamBase?: string;
  apiToken?: string;
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
    if (/^https?:\/\//i.test(plaintext)) return plaintext.split(/\s+|(?=https?:\/\/)/).filter(Boolean);
    const decoded: unknown = JSON.parse(plaintext);
    if (!Array.isArray(decoded) || decoded.some(value => typeof value !== 'string')) throw new Error('VidsrcMe stream envelope has an unsupported shape');
    return decoded;
  }
}

export interface VidsrcMeHostArchitecture {
  discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class VidsrcMeApiHostArchitecture implements VidsrcMeHostArchitecture {
  public constructor(private readonly decoder: VidsrcMeEnvelopeDecoder = new WasmVidsrcMeEnvelopeDecoder()) {}

  public async discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const stateScope = { kind: 'host' as const, key: player.hostname };
    let page = await services.request({ url: player, expectedContent: 'html', stateScope }, signal);
    const wrapper = cheerio.load(page.text());
    const bootstrap = wrapper('iframe#player_iframe[data-api]').attr('data-api');
    if (bootstrap) {
      const grant = await services.request({ url: new URL(bootstrap, page.finalUrl), expectedContent: 'json', referrer: page.finalUrl, stateScope }, signal);
      const src = (grant.json() as { src?: string }).src;
      if (!src) return { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: 'VidsrcMe wrapper did not issue a player URL', stage: 'stage:extraction', sourceId, extractorId: 'vidsrcme-api', targetHost: grant.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'src' } } };
      page = await services.request({ url: new URL(src, grant.finalUrl), expectedContent: 'html', referrer: new URL('/', page.finalUrl), stateScope }, signal);
    }
    const landing = page.text().match(/window\.CFG\s*=\s*(\{[^\n]+?\});/)?.[1];
    if (landing) {
      const configured = JSON.parse(landing) as { playerUrl?: string };
      if (!configured.playerUrl) return { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: 'VidsrcMe landing page did not configure its player', stage: 'stage:extraction', sourceId, extractorId: 'vidsrcme-api', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'CFG.playerUrl' } } };
      page = await services.request({ url: new URL(configured.playerUrl, page.finalUrl), expectedContent: 'html', referrer: page.finalUrl, stateScope }, signal);
    }
    const configuration = page.text().match(/window\.CONFIG\s*=\s*(\{[^\n]+?\});/)?.[1];
    if (!configuration) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'VidsrcMe player no longer exposes its stream configuration', stage: 'stage:extraction', sourceId, extractorId: 'vidsrcme-api', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'CONFIG' } } };
    const configured = JSON.parse(configuration) as VidsrcMePlayerConfiguration;
    if (configured.mediaType !== (media.type === 'movie' ? 'movie' : 'tv') || Number(configured.tmdb) !== media.tmdbId || (media.type === 'episode' && (configured.season !== media.season || configured.episode !== media.episode))) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'VidsrcMe player does not match the requested media', stage: 'stage:extraction', sourceId, extractorId: 'vidsrcme-api', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'CONFIG' } } };
    const api = media.type === 'movie' ? configured.api : configured.streamBase;
    if (!api || !configured.apiToken) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'VidsrcMe player did not issue its stream API and token', stage: 'stage:extraction', sourceId, extractorId: 'vidsrcme-api', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'CONFIG.apiToken' } } };
    const endpoint = new URL(api, page.finalUrl);
    if (media.type === 'episode') {
      endpoint.searchParams.set('season', String(media.season));
      endpoint.searchParams.set('episode', String(media.episode));
      endpoint.searchParams.set('stream_urls', '');
    }
    endpoint.searchParams.set('api_token', configured.apiToken);
    const response = await services.request({ url: endpoint, expectedContent: 'json', timeoutMs: 30000, referrer: page.finalUrl, stateScope }, signal);
    const payload = response.json() as VidsrcMeResponse;
    const envelope = payload.data?.stream_urls;
    if (!envelope || (typeof envelope !== 'string' && !Array.isArray(envelope))) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'VidsrcMe response did not contain stream URLs', stage: 'stage:extraction', sourceId, extractorId: 'vidsrcme-api', targetHost: endpoint.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, ...(response.headers['content-type'] && { contentType: response.headers['content-type'] }), finalUrl: sanitizeDiagnosticUrl(response.finalUrl), bodyCaptured: true, bodyBytes: response.body.byteLength, parserPath: 'data.stream_urls' } } };
    const urls = Array.isArray(envelope) ? envelope : payload.vs?.wasm_url ? await this.decoder.decrypt(envelope, new URL(payload.vs.wasm_url, response.finalUrl), services, signal) : [];
    const streams: StreamCandidate[] = [];
    const hostTokens = new Map<string, string>();
    let lastTokenFailure: unknown;
    for (const value of urls) {
      const mediaUrl = new URL(value);
      let token = hostTokens.get(mediaUrl.hostname);
      if (!token) {
        try {
          const tokenResponse = await services.request({ url: new URL('/generate.php', mediaUrl), expectedContent: 'text', referrer: page.finalUrl, stateScope: { kind: 'host', key: mediaUrl.hostname } }, signal);
          const tokenText = tokenResponse.text().trim();
          token = tokenText;
          if (tokenText.startsWith('{')) {
            const tokenPayload = JSON.parse(tokenText) as { token?: string; data?: string; string?: string; result?: string };
            token = tokenPayload.token ?? tokenPayload.data ?? tokenPayload.string ?? tokenPayload.result ?? '';
          }
          if (token) hostTokens.set(mediaUrl.hostname, token);
        } catch (error) {
          lastTokenFailure = error;
          continue;
        }
      }
      if (!token) continue;
      mediaUrl.searchParams.set('token', token);
      streams.push({ url: mediaUrl, protocol: /\.m3u8(?:$|\?)/i.test(mediaUrl.href) ? 'hls' : 'http', delivery: 'relayed', sourceId, sourceExtractor, hostExtractor: 'vidsrcme-api', ...(payload.data?.title && { label: payload.data.title }), discoveredAt: new Date() });
    }
    if (!streams.length && lastTokenFailure) throw lastTokenFailure;
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
