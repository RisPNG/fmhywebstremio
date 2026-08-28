import type { ExtractionTarget, Extractor, Failure, RequestServices, StreamCandidate } from '../core/models';

export interface ExtractorLookup { find(target: ExtractionTarget): Promise<Extractor | null> }
export interface ResolveExtractionResult { streams: readonly StreamCandidate[]; failures: readonly Failure[] }
export interface ExtractionResolverOptions { maxDepth?: number; onDelegation?: (parent: ExtractionTarget, child: ExtractionTarget) => void }

export class ExtractionResolver {
  private readonly maxDepth: number;
  private readonly onDelegation: ((parent: ExtractionTarget, child: ExtractionTarget) => void) | undefined;
  public constructor(private readonly lookup: ExtractorLookup, private readonly services: RequestServices, options: ExtractionResolverOptions = {}) {
    this.maxDepth = options.maxDepth ?? 5;
    this.onDelegation = options.onDelegation;
  }

  public async resolve(target: ExtractionTarget, signal: AbortSignal): Promise<ResolveExtractionResult> {
    const visit = async (current: ExtractionTarget, depth: number, ancestors: ReadonlySet<string>): Promise<ResolveExtractionResult> => {
      const fingerprint = `${current.kind ?? 'unknown'}:${current.url.href}`;
      if (ancestors.has(fingerprint)) return { streams: [], failures: [this.failure('EXTRACTION_CYCLE', 'Extraction target cycle detected', current)] };
      if (depth > this.maxDepth) return { streams: [], failures: [this.failure('EXTRACTION_DEPTH_EXCEEDED', `Extraction exceeded depth ${this.maxDepth}`, current)] };
      if (signal.aborted) return { streams: [], failures: [this.failure('TIMEOUT', 'Extraction was cancelled', current)] };

      const extractor = await this.lookup.find(current);
      if (!extractor) return { streams: [], failures: [this.failure('UNKNOWN_HOST', `No extractor matched ${current.url.hostname}`, current)] };
      try {
        const result = await extractor.extract(current, this.services, signal);
        switch (result.type) {
          case 'streams': return { streams: result.streams, failures: [] };
          case 'empty': return { streams: [], failures: [] };
          case 'failure': return { streams: [], failures: [{ ...result.failure, stage: 'stage:extraction', extractorId: result.failure.extractorId ?? extractor.id }] };
          case 'redirect':
            this.onDelegation?.(current, result.target);
            return visit(result.target, depth + 1, new Set([...ancestors, fingerprint]));
          case 'embeds': {
            for (const child of result.targets) this.onDelegation?.(current, child);
            const children = await Promise.all(result.targets.map(child => visit(child, depth + 1, new Set([...ancestors, fingerprint]))));
            return { streams: children.flatMap(child => child.streams), failures: children.flatMap(child => child.failures) };
          }
        }
      } catch (error) {
        return { streams: [], failures: [{ ...this.failure('EXTRACTOR_EXCEPTION', error instanceof Error ? error.message : String(error), current), extractorId: extractor.id }] };
      }
    };
    return visit(target, 0, new Set());
  }

  private failure(code: 'EXTRACTION_CYCLE' | 'EXTRACTION_DEPTH_EXCEEDED' | 'UNKNOWN_HOST' | 'TIMEOUT' | 'EXTRACTOR_EXCEPTION', message: string, target: ExtractionTarget): Failure {
    return { code, message, stage: code === 'TIMEOUT' ? 'stage:engine' : 'stage:extraction', targetHost: target.url.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', finalUrl: target.url.href, bodyCaptured: false } };
  }
}

export class StaticExtractorLookup implements ExtractorLookup {
  public constructor(private readonly extractors: readonly Extractor[]) {}
  public async find(target: ExtractionTarget): Promise<Extractor | null> {
    return [...this.extractors].map(extractor => ({ extractor, match: extractor.match(target) })).filter(item => item.match !== null).sort((a, b) => (b.match?.confidence ?? 0) - (a.match?.confidence ?? 0) || a.extractor.id.localeCompare(b.extractor.id))[0]?.extractor ?? null;
  }
}
