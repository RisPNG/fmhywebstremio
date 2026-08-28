import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Semaphore } from 'async-mutex';
import { CookieJar } from 'tough-cookie';
import { captureDiagnostic, defaultRetryPolicyOf, type ExtractionRequest, type ExtractionResponse, type Failure, type FailureCode, type RequestServices, sanitizeDiagnosticUrl } from '../core/models';

export class TransportFailure extends Error {
  public constructor(public readonly failure: Failure) { super(failure.message); }
}
export interface TransportDirectorOptions { globalConcurrency?: number; perHostConcurrency?: number; maxRedirects?: number; maxResponseBytes?: number; maxRetries?: number; blockedHosts?: readonly string[]; blockedCidrs?: readonly string[] }

export class TransportDirector implements RequestServices {
  private readonly global: Semaphore;
  private readonly hosts = new Map<string, Semaphore>();
  private readonly jars = new Map<string, CookieJar>();
  private readonly perHost: number;
  private readonly maxRedirects: number;
  private readonly maxResponseBytes: number;
  private readonly maxRetries: number;
  private readonly blockedHosts: ReadonlySet<string>;
  private readonly blockedCidrs: readonly string[];

  public constructor(options: TransportDirectorOptions = {}) {
    this.global = new Semaphore(options.globalConcurrency ?? 24);
    this.perHost = options.perHostConcurrency ?? 4;
    this.maxRedirects = options.maxRedirects ?? 5;
    this.maxResponseBytes = options.maxResponseBytes ?? 4 * 1024 * 1024;
    this.maxRetries = options.maxRetries ?? 1;
    this.blockedHosts = new Set(options.blockedHosts ?? []);
    this.blockedCidrs = options.blockedCidrs ?? [];
  }

  public async request(request: ExtractionRequest, signal: AbortSignal): Promise<ExtractionResponse> {
    if (request.capabilities?.some(capability => capability === 'browser-rendering' || capability === 'streaming-response')) throw this.error('CONTRACT_VIOLATION', `Unsupported transport capability`, request.url);
    const [, releaseGlobal] = await this.global.acquire(1);
    if (signal.aborted) {
      releaseGlobal();
      throw this.error('TIMEOUT', 'Transport request was cancelled', request.url);
    }
    const hostSemaphore = this.hosts.get(request.url.hostname) ?? new Semaphore(this.perHost);
    this.hosts.set(request.url.hostname, hostSemaphore);
    const [, releaseHost] = await hostSemaphore.acquire(1);
    if (signal.aborted) {
      releaseHost();
      releaseGlobal();
      throw this.error('TIMEOUT', 'Transport request was cancelled', request.url);
    }
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await this.execute(request, signal);
        } catch (error) {
          if (!(error instanceof TransportFailure) || attempt >= this.maxRetries || signal.aborted) throw error;
          const policy = defaultRetryPolicyOf(error.failure.code);
          if (policy !== 'immediate' && policy !== 'backoff') throw error;
          if (policy === 'backoff') await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
        }
      }
    } finally {
      releaseHost();
      releaseGlobal();
    }
  }

  private async execute(request: ExtractionRequest, signal: AbortSignal): Promise<ExtractionResponse> {
    const startedAt = new Date();
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('Transport timeout')), request.timeoutMs ?? 10000);
    let current = new URL(request.url);
    const redirectChain: URL[] = [];
    try {
      for (let redirects = 0; ; redirects++) {
        await this.assertPublic(current);
        const headers = new Headers(request.headers);
        if (request.referrer) headers.set('referer', request.referrer.href);
        const jar = request.stateScope ? this.jars.get(`${request.stateScope.kind}:${request.stateScope.key}`) ?? new CookieJar() : undefined;
        if (jar && request.stateScope) {
          this.jars.set(`${request.stateScope.kind}:${request.stateScope.key}`, jar);
          const cookie = await jar.getCookieString(current.href);
          if (cookie) headers.set('cookie', cookie);
        }
        const response = await fetch(current, { method: request.method ?? 'GET', headers, ...(request.body !== undefined && { body: request.body }), redirect: 'manual', signal: controller.signal });
        for (const cookie of response.headers.getSetCookie()) if (jar) await jar.setCookie(cookie, current.href);
        if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
          if (redirects >= this.maxRedirects) throw this.error('REDIRECT_LOOP', 'Redirect limit exceeded', current);
          current = new URL(response.headers.get('location') as string, current);
          if (redirectChain.some(url => url.href === current.href)) throw this.error('REDIRECT_LOOP', 'Redirect cycle detected', current);
          redirectChain.push(current);
          continue;
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        let truncated = false;
        if (response.body) for await (const chunk of response.body) {
          const bytes = chunk as Uint8Array;
          const available = Math.min(this.maxResponseBytes, request.maxBytes ?? this.maxResponseBytes) - length;
          if (bytes.byteLength > available) {
            if (available > 0) chunks.push(bytes.slice(0, available));
            truncated = true;
            break;
          }
          chunks.push(bytes);
          length += bytes.byteLength;
        }
        const body = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const normalizedHeaders = Object.fromEntries([...response.headers.entries()].map(([name, value]) => [name.toLowerCase(), value]));
        const httpCode = response.status === 403 ? 'HTTP_FORBIDDEN' : response.status === 404 ? 'HTTP_NOT_FOUND' : response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'HTTP_SERVER_ERROR' : undefined;
        if (httpCode) {
          throw new TransportFailure({ code: httpCode, message: `HTTP request failed with status ${response.status}`, stage: 'stage:transport', targetHost: current.hostname, observedAt: new Date(), diagnostic: captureDiagnostic({ status: response.status, headers: normalizedHeaders, finalUrl: current, redirectChain, body }, { maxBytes: 2048 }) });
        }
        this.assertContentType(request, normalizedHeaders['content-type'], current);
        const text = () => new TextDecoder(normalizedHeaders['content-type']?.match(/charset=([^;]+)/i)?.[1] ?? 'utf-8').decode(body);
        return { status: response.status, headers: normalizedHeaders, finalUrl: current, redirectChain, body, text, json: () => JSON.parse(text()) as unknown, truncated, timing: { startedAt, elapsedMs: Date.now() - startedAt.getTime() } };
      }
    } catch (error) {
      if (error instanceof TransportFailure) throw error;
      if (controller.signal.aborted) throw this.error('TIMEOUT', 'Transport request timed out or was cancelled', current);
      const cause = error instanceof Error && error.cause && typeof error.cause === 'object' ? error.cause as { code?: string } : undefined;
      const code = cause?.code?.includes('CERT') || cause?.code?.includes('TLS') ? 'TLS_FAILED' : cause?.code === 'ENOTFOUND' || cause?.code === 'EAI_AGAIN' ? 'DNS_FAILED' : error instanceof TypeError ? 'CONNECTION_FAILED' : 'INTERNAL_ERROR';
      throw this.error(code, error instanceof Error ? error.message : String(error), current);
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    }
  }

  private assertContentType(request: ExtractionRequest, contentType: string | undefined, url: URL): void {
    if (!request.expectedContent || request.expectedContent === 'binary' || !contentType) return;
    const accepted: Record<Exclude<ExtractionRequest['expectedContent'], undefined | 'binary'>, RegExp> = { html: /html|xhtml/i, json: /json/i, text: /text|json|xml|javascript/i, manifest: /mpegurl|dash\+xml|text|octet-stream/i };
    if (!accepted[request.expectedContent].test(contentType)) throw this.error('UNEXPECTED_CONTENT_TYPE', `Expected ${request.expectedContent}, received ${contentType}`, url);
  }

  private async assertPublic(url: URL): Promise<void> {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw this.error('CONTRACT_VIOLATION', `Unsupported URL protocol ${url.protocol}`, url);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || this.blockedHosts.has(host)) throw this.error('CONNECTION_FAILED', 'Blocked network target', url);
    const addresses = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true }).catch(() => {
          throw this.error('DNS_FAILED', 'DNS lookup failed', url);
        });
    if (addresses.some(({ address }) => this.isPrivateAddress(address) || this.isConfiguredAddress(address))) throw this.error('CONNECTION_FAILED', 'Blocked private, metadata, or configured internal address', url);
  }

  private isPrivateAddress(address: string): boolean {
    const value = address.toLowerCase();
    if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    const ipv4 = mapped ?? (isIP(value) === 4 ? value : undefined);
    if (!ipv4) return false;
    const [a = 0, b = 0] = ipv4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19));
  }

  private isConfiguredAddress(address: string): boolean {
    return this.blockedCidrs.some((range) => {
      const [network, bitsText] = range.split('/');
      if (!network) return false;
      if (!bitsText) return address === network;
      if (isIP(address) !== 4 || isIP(network) !== 4) return false;
      const bits = Number(bitsText);
      if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
      const number = (value: string) => value.split('.').reduce((result, part) => (result << 8) + Number(part), 0) >>> 0;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (number(address) & mask) === (number(network) & mask);
    });
  }

  private error(code: FailureCode, message: string, url: URL): TransportFailure {
    return new TransportFailure({ code, message, stage: 'stage:transport', targetHost: url.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', finalUrl: sanitizeDiagnosticUrl(url), bodyCaptured: false } });
  }
}
