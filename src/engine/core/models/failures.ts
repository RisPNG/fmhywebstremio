export const FAILURE_CODES = [
  'DIRECTORY_FETCH_FAILED', 'DIRECTORY_FORMAT_CHANGED', 'DIRECTORY_ENTRY_INVALID', 'DIRECTORY_CATEGORY_MISSING', 'DIRECTORY_PARSE_PARTIAL',
  'DNS_FAILED', 'CONNECTION_FAILED', 'TLS_FAILED', 'TIMEOUT', 'RATE_LIMITED',
  'HTTP_FORBIDDEN', 'HTTP_NOT_FOUND', 'HTTP_SERVER_ERROR', 'REDIRECT_LOOP',
  'UNEXPECTED_CONTENT_TYPE', 'RESPONSE_SCHEMA_CHANGED', 'PAGE_STRUCTURE_CHANGED',
  'SEARCH_FAILED', 'MEDIA_NOT_FOUND', 'KNOWN_PROBE_MEDIA_NOT_FOUND', 'EPISODE_NOT_FOUND', 'RESULT_MAPPING_FAILED',
  'FAMILY_PROBE_TIMEOUT', 'FAMILY_PROBE_BLOCKED', 'FAMILY_PROBE_NETWORK_FAILED', 'FAMILY_PROBE_AMBIGUOUS', 'FAMILY_PROBE_BUDGET_EXCEEDED', 'UNSUPPORTED_SOURCE_PATTERN',
  'EMBED_NOT_FOUND', 'UNKNOWN_HOST', 'HOST_EXTRACTION_FAILED', 'SCRIPT_DATA_MISSING', 'NO_STREAM_CANDIDATE', 'EXTRACTION_CYCLE', 'EXTRACTION_DEPTH_EXCEEDED',
  'MANIFEST_FETCH_FAILED', 'MANIFEST_INVALID', 'NO_PLAYABLE_VARIANTS', 'STREAM_EXPIRED',
  'EXTRACTOR_EXCEPTION', 'CONTRACT_VIOLATION', 'INTERNAL_ERROR',
] as const;

export type FailureCode = typeof FAILURE_CODES[number];
export type ExtractorFailureCode = Exclude<FailureCode, 'EXTRACTOR_EXCEPTION' | 'INTERNAL_ERROR'>;
export type FailureCategory = 'category:directory' | 'category:network' | 'category:http' | 'category:content' | 'category:discovery' | 'category:extraction' | 'category:protocol' | 'category:engine';
export type FailureStage = 'stage:directory' | 'stage:discovery' | 'stage:extraction' | 'stage:transport' | 'stage:protocol' | 'stage:engine';
export type RetryPolicy = 'none' | 'immediate' | 'backoff' | 're-extract' | 'defer';

const DIRECTORY = new Set<FailureCode>(FAILURE_CODES.slice(0, 5));
const NETWORK = new Set<FailureCode>(FAILURE_CODES.slice(5, 10));
const HTTP = new Set<FailureCode>(FAILURE_CODES.slice(10, 14));
const CONTENT = new Set<FailureCode>(FAILURE_CODES.slice(14, 17));
const DISCOVERY = new Set<FailureCode>(FAILURE_CODES.slice(17, 29));
const EXTRACTION = new Set<FailureCode>(FAILURE_CODES.slice(29, 36));
const PROTOCOL = new Set<FailureCode>(FAILURE_CODES.slice(36, 40));

export function categoryOf(code: FailureCode): FailureCategory {
  if (DIRECTORY.has(code)) return 'category:directory';
  if (NETWORK.has(code)) return 'category:network';
  if (HTTP.has(code)) return 'category:http';
  if (CONTENT.has(code)) return 'category:content';
  if (DISCOVERY.has(code)) return 'category:discovery';
  if (EXTRACTION.has(code)) return 'category:extraction';
  if (PROTOCOL.has(code)) return 'category:protocol';
  return 'category:engine';
}

const RETRY: Record<FailureCode, RetryPolicy> = {
  DIRECTORY_FETCH_FAILED: 'backoff', DIRECTORY_FORMAT_CHANGED: 'defer', DIRECTORY_ENTRY_INVALID: 'none', DIRECTORY_CATEGORY_MISSING: 'defer', DIRECTORY_PARSE_PARTIAL: 'defer',
  DNS_FAILED: 'backoff', CONNECTION_FAILED: 'immediate', TLS_FAILED: 'backoff', TIMEOUT: 'defer', RATE_LIMITED: 'backoff',
  HTTP_FORBIDDEN: 'defer', HTTP_NOT_FOUND: 'none', HTTP_SERVER_ERROR: 'backoff', REDIRECT_LOOP: 'none',
  UNEXPECTED_CONTENT_TYPE: 'none', RESPONSE_SCHEMA_CHANGED: 'none', PAGE_STRUCTURE_CHANGED: 'none', SEARCH_FAILED: 'none', MEDIA_NOT_FOUND: 'none', KNOWN_PROBE_MEDIA_NOT_FOUND: 'defer', EPISODE_NOT_FOUND: 'none', RESULT_MAPPING_FAILED: 'none',
  FAMILY_PROBE_TIMEOUT: 'defer', FAMILY_PROBE_BLOCKED: 'defer', FAMILY_PROBE_NETWORK_FAILED: 'defer', FAMILY_PROBE_AMBIGUOUS: 'defer', FAMILY_PROBE_BUDGET_EXCEEDED: 'defer', UNSUPPORTED_SOURCE_PATTERN: 'none',
  EMBED_NOT_FOUND: 'none', UNKNOWN_HOST: 'none', HOST_EXTRACTION_FAILED: 'none', SCRIPT_DATA_MISSING: 'none', NO_STREAM_CANDIDATE: 'none', EXTRACTION_CYCLE: 'none', EXTRACTION_DEPTH_EXCEEDED: 'none',
  MANIFEST_FETCH_FAILED: 'immediate', MANIFEST_INVALID: 'none', NO_PLAYABLE_VARIANTS: 'none', STREAM_EXPIRED: 're-extract', EXTRACTOR_EXCEPTION: 'none', CONTRACT_VIOLATION: 'none', INTERNAL_ERROR: 'none',
};
export function defaultRetryPolicyOf(code: FailureCode): RetryPolicy {
  return RETRY[code];
}

export interface FailureDiagnostic {
  sensitivity: 'privileged';
  status?: number;
  contentType?: string;
  finalUrl?: string;
  redirectChain?: readonly string[];
  bodyCaptured: boolean;
  bodyBytes?: number;
  bodySample?: string;
  bodyTruncated?: boolean;
  parserPath?: string;
}
export interface DiagnosticSource { status?: number; headers?: Readonly<Record<string, string>>; finalUrl?: URL; redirectChain?: readonly URL[]; body?: Uint8Array }
export interface CaptureDiagnosticOptions { maxBytes: number; parserPath?: string; includeFullUrls?: boolean }

export function sanitizeDiagnosticUrl(url: URL): string {
  const value = new URL(url);
  value.username = '';
  value.password = '';
  value.hash = '';
  value.pathname = value.pathname.split('/').map((segment) => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return '{uuid}';
    if (/^[0-9a-f]{32}$/i.test(segment)) return '{md5}';
    if (/^[0-9a-f]{40}$/i.test(segment)) return '{sha1}';
    if (/^[0-9a-f]{48,}$/i.test(segment)) return '{hex}';
    return segment.replace(/;([^=;/]+)=([^;/]*)/g, ';$1={redacted}');
  }).join('/');
  const names = [...value.searchParams.keys()];
  value.search = '';
  for (const name of names) value.searchParams.append(name, '');
  return value.toString().replace(/%7B(uuid|md5|sha1|hex|redacted)%7D/gi, '{$1}');
}

export function captureDiagnostic(source: DiagnosticSource, options: CaptureDiagnosticOptions): FailureDiagnostic {
  const contentType = Object.entries(source.headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
  const bodyBytes = source.body?.byteLength;
  const captured = source.body !== undefined;
  const bytes = source.body?.slice(0, options.maxBytes);
  let bodySample: string | undefined;
  if (bytes) {
    const charset = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1];
    try {
      bodySample = new TextDecoder(charset ?? 'utf-8', { fatal: false }).decode(bytes);
    } catch {
      bodySample = new TextDecoder().decode(bytes);
    }
    if (bodyBytes !== undefined && bodyBytes > options.maxBytes) bodySample = bodySample.replace(/\uFFFD$/, '');
  }
  const url = (value: URL) => options.includeFullUrls ? value.toString() : sanitizeDiagnosticUrl(value);
  return {
    sensitivity: 'privileged',
    ...(source.status !== undefined && { status: source.status }),
    ...(contentType !== undefined && { contentType }),
    ...(source.finalUrl && { finalUrl: url(source.finalUrl) }),
    ...(source.redirectChain && { redirectChain: source.redirectChain.map(url) }),
    bodyCaptured: captured,
    ...(bodyBytes !== undefined && { bodyBytes, bodySample: bodySample ?? '', bodyTruncated: bodyBytes > options.maxBytes }),
    ...(options.parserPath !== undefined && { parserPath: options.parserPath }),
  };
}

interface FailureBase<C extends FailureCode> {
  code: C;
  message: string;
  stage?: FailureStage;
  sourceId?: string;
  familyId?: string;
  extractorId?: string;
  targetHost?: string;
  observedAt: Date;
  diagnostic: FailureDiagnostic;
}
export type Failure = FailureBase<FailureCode>;
export type ExtractorFailure = FailureBase<ExtractorFailureCode>;
