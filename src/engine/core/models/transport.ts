import type { ExtractionResponse } from './contracts';

export type TransportCapability = 'http' | 'cookies' | 'redirects' | 'streaming-response' | 'browser-rendering';
export interface RequestStateScope { kind: 'query' | 'source' | 'host'; key: string }
export interface ExtractionRequest {
  url: URL;
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  maxBytes?: number;
  referrer?: URL;
  expectedContent?: 'html' | 'json' | 'text' | 'binary' | 'manifest';
  capabilities?: readonly TransportCapability[];
  stateScope?: RequestStateScope;
}
export interface RequestServices {
  request(request: ExtractionRequest, signal: AbortSignal): Promise<ExtractionResponse>;
}
