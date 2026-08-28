import type { Extractor } from '../core/models';

export interface ExtractorMatcherMetadata {
  id: string;
  protocols?: readonly string[];
  hostname?: string;
  path?: string;
  priority: number;
  positive: readonly string[];
  negative: readonly string[];
}
export interface ExtractorMetadata {
  id: string;
  kind: 'source' | 'host' | 'generic';
  matchers: readonly ExtractorMatcherMetadata[];
  load(): Promise<{ default: new () => Extractor }>;
}
export interface RegistryMatch { metadata: ExtractorMetadata; matcher: ExtractorMatcherMetadata; confidence: number; captures?: Readonly<Record<string, string>> }
