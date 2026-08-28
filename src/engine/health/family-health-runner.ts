import type { ExtractionResult, Failure, RequestServices, SourceRecord, StreamCandidate } from '../core/models';
import type { StreamSelector } from '../protocols';
import type { SourceRegistry } from '../registry';
import type { ExtractionResolver } from '../resolver';
import { evaluateFamilyHealth, type FamilyHealthCorpus, type ProbeCaseOutcome } from './corpus';
import type { DependencyGraph } from './dependencies';
import type { SourceFamily } from './source-family';

export class FamilyHealthRunner {
  public constructor(private readonly resolver: ExtractionResolver, private readonly selector: StreamSelector, private readonly services: RequestServices, private readonly registry: SourceRegistry, private readonly quorum = 0.5, private readonly dependencies?: DependencyGraph) {}

  public async run(source: SourceRecord, family: SourceFamily, corpus: FamilyHealthCorpus, signal: AbortSignal): Promise<ReturnType<typeof evaluateFamilyHealth>> {
    const outcomes: ProbeCaseOutcome[] = [];
    for (const test of corpus.cases) {
      const failures: Failure[] = [];
      const candidates: StreamCandidate[] = [];
      let result: ExtractionResult;
      try {
        result = await family.discoverMedia(test.media, source, this.services, signal);
      } catch (error) {
        const nested = error && typeof error === 'object' && 'failure' in error ? (error as { failure?: Failure }).failure : undefined;
        const failure: Failure = nested ? { ...nested, sourceId: nested.sourceId ?? source.id, familyId: nested.familyId ?? family.id, stage: 'stage:discovery' } : { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error), stage: 'stage:engine', sourceId: source.id, familyId: family.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } };
        outcomes.push({ caseId: test.id, expected: test.expected, discovered: false, stages: { discovery: false, extraction: false, validation: false }, failure });
        continue;
      }
      if (result.type === 'streams') for (const stream of result.streams) this.dependencies?.record({ sourceId: source.id, familyId: family.id, provider: stream.hostExtractor ?? stream.url.hostname, observedAt: new Date() });
      if (result.type === 'redirect') this.dependencies?.record({ sourceId: source.id, familyId: family.id, provider: result.target.url.hostname, observedAt: new Date() });
      if (result.type === 'embeds') for (const target of result.targets) this.dependencies?.record({ sourceId: source.id, familyId: family.id, provider: target.url.hostname, observedAt: new Date() });
      let discovered = result.type !== 'empty' && result.type !== 'failure';
      if (result.type === 'streams') candidates.push(...result.streams);
      if (result.type === 'failure') failures.push(result.failure);
      if (result.type === 'redirect') {
        const resolved = await this.resolver.resolve(result.target, signal);
        candidates.push(...resolved.streams);
        failures.push(...resolved.failures);
      }
      if (result.type === 'embeds') {
        const resolved = await Promise.all(result.targets.map(target => this.resolver.resolve(target, signal)));
        candidates.push(...resolved.flatMap(value => value.streams));
        failures.push(...resolved.flatMap(value => value.failures));
      }
      const validation = await this.selector.validate(candidates, { topK: 1 }, signal);
      failures.push(...validation.failures);
      if (test.expected === 'discoverable' && !discovered && failures.length === 0) failures.push({ code: 'KNOWN_PROBE_MEDIA_NOT_FOUND', message: 'Known probe media was not found', stage: 'stage:discovery', sourceId: source.id, familyId: family.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      if (candidates.length > 0) discovered = true;
      const decisiveFailure = validation.failures[0] ?? failures[0];
      outcomes.push({ caseId: test.id, expected: test.expected, discovered, stages: { discovery: discovered, extraction: candidates.length > 0, validation: validation.streams.some(stream => stream.validation === 'validated') }, ...(decisiveFailure && { failure: decisiveFailure }) });
    }
    const health = evaluateFamilyHealth(corpus, outcomes, this.quorum);
    this.registry.set({ ...source, status: health.extractable && health.status === 'healthy' ? 'supported' : 'degraded' });
    this.registry.recordHealth({ sourceId: source.id, lastOutcome: health.extractable ? health.status : 'failed', recentSuccesses: outcomes.filter(outcome => outcome.stages.validation).length, recentFailures: outcomes.filter(outcome => !outcome.stages.validation && outcome.expected === 'discoverable').length, observedAt: new Date() });
    return health;
  }
}
