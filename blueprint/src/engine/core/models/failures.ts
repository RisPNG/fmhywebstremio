export type FailureCode =
  | "DIRECTORY_FETCH_FAILED"
  | "DIRECTORY_FORMAT_CHANGED"
  | "DIRECTORY_ENTRY_INVALID"
  | "DIRECTORY_CATEGORY_MISSING"
  | "DIRECTORY_PARSE_PARTIAL"
  | "DNS_FAILED"
  | "CONNECTION_FAILED"
  | "TLS_FAILED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "HTTP_FORBIDDEN"
  | "HTTP_NOT_FOUND"
  | "HTTP_SERVER_ERROR"
  | "REDIRECT_LOOP"
  | "UNEXPECTED_CONTENT_TYPE"
  | "RESPONSE_SCHEMA_CHANGED"
  | "PAGE_STRUCTURE_CHANGED"
  | "SEARCH_FAILED"
  | "MEDIA_NOT_FOUND"
  | "KNOWN_PROBE_MEDIA_NOT_FOUND"
  | "EPISODE_NOT_FOUND"
  | "RESULT_MAPPING_FAILED"
  | "FAMILY_PROBE_TIMEOUT"
  | "FAMILY_PROBE_BLOCKED"
  | "FAMILY_PROBE_NETWORK_FAILED"
  | "FAMILY_PROBE_AMBIGUOUS"
  | "FAMILY_PROBE_BUDGET_EXCEEDED"
  | "UNSUPPORTED_SOURCE_PATTERN"
  | "EMBED_NOT_FOUND"
  | "UNKNOWN_HOST"
  | "HOST_EXTRACTION_FAILED"
  | "SCRIPT_DATA_MISSING"
  | "NO_STREAM_CANDIDATE"
  | "EXTRACTION_CYCLE"
  | "EXTRACTION_DEPTH_EXCEEDED"
  | "MANIFEST_FETCH_FAILED"
  | "MANIFEST_INVALID"
  | "NO_PLAYABLE_VARIANTS"
  | "STREAM_EXPIRED"
  | "EXTRACTOR_EXCEPTION"
  | "CONTRACT_VIOLATION"
  | "INTERNAL_ERROR";

/** Taxonomy category implied by the failure code itself. */
export type FailureCategory =
  | "category:directory"
  | "category:network"
  | "category:http"
  | "category:content"
  | "category:discovery"
  | "category:extraction"
  | "category:protocol"
  | "category:engine";

/** Runtime pipeline position where the failure actually occurred. */
export type FailureStage =
  | "stage:directory"
  | "stage:discovery"
  | "stage:extraction"
  | "stage:transport"
  | "stage:protocol"
  | "stage:engine";

export type RetryPolicy =
  | "none"
  | "immediate"
  | "backoff"
  | "re-extract"
  | "defer";

const FAILURE_CATEGORY = {
  DIRECTORY_FETCH_FAILED: "category:directory",
  DIRECTORY_FORMAT_CHANGED: "category:directory",
  DIRECTORY_ENTRY_INVALID: "category:directory",
  DIRECTORY_CATEGORY_MISSING: "category:directory",
  DIRECTORY_PARSE_PARTIAL: "category:directory",
  DNS_FAILED: "category:network",
  CONNECTION_FAILED: "category:network",
  TLS_FAILED: "category:network",
  TIMEOUT: "category:network",
  RATE_LIMITED: "category:network",
  HTTP_FORBIDDEN: "category:http",
  HTTP_NOT_FOUND: "category:http",
  HTTP_SERVER_ERROR: "category:http",
  REDIRECT_LOOP: "category:http",
  UNEXPECTED_CONTENT_TYPE: "category:content",
  RESPONSE_SCHEMA_CHANGED: "category:content",
  PAGE_STRUCTURE_CHANGED: "category:content",
  SEARCH_FAILED: "category:discovery",
  MEDIA_NOT_FOUND: "category:discovery",
  KNOWN_PROBE_MEDIA_NOT_FOUND: "category:discovery",
  EPISODE_NOT_FOUND: "category:discovery",
  RESULT_MAPPING_FAILED: "category:discovery",
  FAMILY_PROBE_TIMEOUT: "category:discovery",
  FAMILY_PROBE_BLOCKED: "category:discovery",
  FAMILY_PROBE_NETWORK_FAILED: "category:discovery",
  FAMILY_PROBE_AMBIGUOUS: "category:discovery",
  FAMILY_PROBE_BUDGET_EXCEEDED: "category:discovery",
  UNSUPPORTED_SOURCE_PATTERN: "category:discovery",
  EMBED_NOT_FOUND: "category:extraction",
  UNKNOWN_HOST: "category:extraction",
  HOST_EXTRACTION_FAILED: "category:extraction",
  SCRIPT_DATA_MISSING: "category:extraction",
  NO_STREAM_CANDIDATE: "category:extraction",
  EXTRACTION_CYCLE: "category:extraction",
  EXTRACTION_DEPTH_EXCEEDED: "category:extraction",
  MANIFEST_FETCH_FAILED: "category:protocol",
  MANIFEST_INVALID: "category:protocol",
  NO_PLAYABLE_VARIANTS: "category:protocol",
  STREAM_EXPIRED: "category:protocol",
  EXTRACTOR_EXCEPTION: "category:engine",
  CONTRACT_VIOLATION: "category:engine",
  INTERNAL_ERROR: "category:engine",
} as const satisfies Record<FailureCode, FailureCategory>;

const FAILURE_RETRY_POLICY = {
  DIRECTORY_FETCH_FAILED: "backoff",
  DIRECTORY_FORMAT_CHANGED: "defer",
  DIRECTORY_ENTRY_INVALID: "none",
  DIRECTORY_CATEGORY_MISSING: "defer",
  DIRECTORY_PARSE_PARTIAL: "defer",
  DNS_FAILED: "backoff",
  CONNECTION_FAILED: "immediate",
  TLS_FAILED: "backoff",
  TIMEOUT: "defer",
  RATE_LIMITED: "backoff",
  HTTP_FORBIDDEN: "defer",
  HTTP_NOT_FOUND: "none",
  HTTP_SERVER_ERROR: "backoff",
  REDIRECT_LOOP: "none",
  UNEXPECTED_CONTENT_TYPE: "none",
  RESPONSE_SCHEMA_CHANGED: "none",
  PAGE_STRUCTURE_CHANGED: "none",
  SEARCH_FAILED: "none",
  MEDIA_NOT_FOUND: "none",
  KNOWN_PROBE_MEDIA_NOT_FOUND: "defer",
  EPISODE_NOT_FOUND: "none",
  RESULT_MAPPING_FAILED: "none",
  FAMILY_PROBE_TIMEOUT: "defer",
  FAMILY_PROBE_BLOCKED: "defer",
  FAMILY_PROBE_NETWORK_FAILED: "defer",
  FAMILY_PROBE_AMBIGUOUS: "defer",
  FAMILY_PROBE_BUDGET_EXCEEDED: "defer",
  UNSUPPORTED_SOURCE_PATTERN: "none",
  EMBED_NOT_FOUND: "none",
  UNKNOWN_HOST: "none",
  HOST_EXTRACTION_FAILED: "none",
  SCRIPT_DATA_MISSING: "none",
  NO_STREAM_CANDIDATE: "none",
  EXTRACTION_CYCLE: "none",
  EXTRACTION_DEPTH_EXCEEDED: "none",
  MANIFEST_FETCH_FAILED: "immediate",
  MANIFEST_INVALID: "none",
  NO_PLAYABLE_VARIANTS: "none",
  STREAM_EXPIRED: "re-extract",
  EXTRACTOR_EXCEPTION: "none",
  CONTRACT_VIOLATION: "none",
  INTERNAL_ERROR: "none",
} as const satisfies Record<FailureCode, RetryPolicy>;

export function categoryOf(code: FailureCode): FailureCategory {
  return FAILURE_CATEGORY[code];
}

/** Bounded diagnostic evidence captured by runtime helpers. */
export interface FailureDiagnostic {
  /** Body samples can contain secrets from HTML/JS and are privileged diagnostic data. */
  sensitivity: "privileged";
  status?: number;
  contentType?: string;
  /** Sanitized by default: no userinfo/fragment; query values and obvious path tokens are redacted. */
  finalUrl?: string;
  /** Sanitized by default: no userinfo/fragment; query values and obvious path tokens are redacted. */
  redirectChain?: readonly string[];
  /** Distinguishes "not captured" from a captured zero-length body. */
  bodyCaptured: boolean;
  /** Original captured source-body length when a body was supplied. */
  bodyBytes?: number;
  /** Present whenever a body was supplied, including the empty string for a zero-length body. */
  bodySample?: string;
  bodyTruncated?: boolean;
  parserPath?: string;
}

export interface DiagnosticSource {
  status?: number;
  /** Transport responses should normalize header names to lowercase. */
  headers?: Readonly<Record<string, string>>;
  finalUrl?: URL;
  redirectChain?: readonly URL[];
  body?: Uint8Array;
}

export interface CaptureDiagnosticOptions {
  maxBytes: number;
  parserPath?: string;
  /**
   * Unsafe debugging escape hatch. Defaults to false. When false, URL userinfo
   * and fragments are removed, query values are redacted, recognized unambiguous
   * path identifiers and matrix parameters are templated, and parameter names are retained. This does NOT
   * sanitize secrets embedded in bodySample.
   */
  includeFullUrls?: boolean;
}

function sanitizeDiagnosticPathSegment(segment: string): string {
  // Preserve ordinary route structure while removing common opaque identifiers
  // and token-shaped path material. These labels are diagnostic templates, not
  // claims about the token's cryptographic origin.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(segment)) return "{uuid}";
  if (/^[0-9a-f]{32}$/i.test(segment)) return "{md5}";
  if (/^[0-9a-f]{40}$/i.test(segment)) return "{sha1}";
  if (/^[0-9a-f]{48,}$/i.test(segment)) return "{hex}";

  // Matrix/path parameters such as ;jsessionid=... may carry session secrets.
  return segment.replace(/;([^=;/]+)=([^;/]*)/g, ";$1={redacted}");
}

/** Produce a diagnostic-safe URL shape while preserving useful route/query structure. */
export function sanitizeDiagnosticUrl(url: URL): string {
  const sanitized = new URL(url.toString());
  sanitized.username = "";
  sanitized.password = "";
  sanitized.hash = "";

  sanitized.pathname = sanitized.pathname
    .split("/")
    .map(sanitizeDiagnosticPathSegment)
    .join("/");

  const names = [...sanitized.searchParams.keys()];
  sanitized.search = "";
  for (const name of names) sanitized.searchParams.append(name, "");
  return sanitized
    .toString()
    .replace(/%7B(uuid|md5|sha1|hex|redacted)%7D/gi, "{$1}");
}

function diagnosticUrl(url: URL, includeFullUrls: boolean): string {
  return includeFullUrls ? url.toString() : sanitizeDiagnosticUrl(url);
}

function headerValue(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const normalizedName = name.toLowerCase();
  const direct = headers[normalizedName];
  if (direct !== undefined) return direct;

  // Defensive fallback for a transport implementation that violates the
  // lowercase-header contract; diagnostics should still preserve the signal.
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedName) return value;
  }
  return undefined;
}

function charsetFromContentType(contentType: string | undefined): string | undefined {
  const match = contentType?.match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  return match?.[1]?.trim();
}

/**
 * Decode a byte-bounded sample using the declared response charset when
 * supported, falling back to UTF-8. With `stream: true`, TextDecoder holds an
 * incomplete trailing sequence instead of inventing U+FFFD at the byte cap.
 */
function decodeDiagnosticSample(
  sample: Uint8Array,
  truncated: boolean,
  contentType: string | undefined,
): string {
  const charset = charsetFromContentType(contentType);
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset ?? "utf-8");
  } catch {
    decoder = new TextDecoder("utf-8");
  }
  return truncated ? decoder.decode(sample, { stream: true }) : decoder.decode(sample);
}

/**
 * Centralized diagnostic capture so body-size and URL-redaction rules are
 * enforced once. The byte cap applies before UTF-8 decoding. A supplied empty
 * body is represented explicitly as `bodyCaptured: true`, `bodyBytes: 0`, and
 * `bodySample: ""`.
 */
export function captureDiagnostic(
  source: DiagnosticSource,
  options: CaptureDiagnosticOptions,
): FailureDiagnostic {
  const maxBytes = Math.max(0, options.maxBytes);
  const bodyCaptured = source.body !== undefined;
  const body = source.body;
  const sampleBytes = body?.subarray(0, maxBytes);
  const bodyTruncated = body !== undefined && sampleBytes !== undefined
    ? body.byteLength > sampleBytes.byteLength
    : false;
  const includeFullUrls = options.includeFullUrls ?? false;
  const contentType = headerValue(source.headers, "content-type");

  return {
    ...(source.status !== undefined ? { status: source.status } : {}),
    ...(contentType !== undefined ? { contentType } : {}),
    ...(source.finalUrl
      ? { finalUrl: diagnosticUrl(source.finalUrl, includeFullUrls) }
      : {}),
    ...(source.redirectChain
      ? {
          redirectChain: source.redirectChain.map((url) =>
            diagnosticUrl(url, includeFullUrls),
          ),
        }
      : {}),
    sensitivity: "privileged",
    bodyCaptured,
    ...(body !== undefined && sampleBytes !== undefined
      ? {
          bodyBytes: body.byteLength,
          bodySample: decodeDiagnosticSample(sampleBytes, bodyTruncated, contentType),
          bodyTruncated,
        }
      : {}),
    ...(options.parserPath ? { parserPath: options.parserPath } : {}),
  };
}

export interface Failure {
  code: FailureCode;
  message: string;
  observedAt: Date;
  /** Actual runtime pipeline position. Resolver/runtime stamps this when known. */
  stage?: FailureStage;
  sourceId?: string;
  extractorId?: string;
  targetHost?: string;
  diagnostic?: FailureDiagnostic;
}

/** Resolver/runtime-only codes for unexpected bugs, never extractor-owned failures. */
export type RuntimeOwnedFailureCode = "EXTRACTOR_EXCEPTION" | "INTERNAL_ERROR";
export type ExtractorFailureCode = Exclude<FailureCode, RuntimeOwnedFailureCode>;
export type ExtractorFailure = Omit<Failure, "code"> & { code: ExtractorFailureCode };

/**
 * Default retry policy. Callers may override it by execution context; in
 * particular, user-query timeouts should not be immediately retried within the
 * same deadline budget, while scheduled probes may choose a later retry.
 */
export function defaultRetryPolicyOf(code: FailureCode): RetryPolicy {
  return FAILURE_RETRY_POLICY[code];
}
