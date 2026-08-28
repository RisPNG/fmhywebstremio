import type { DependencyGraph, JsonDependencyStore, SourceFamily } from '../health';
import { StreamSelector } from '../protocols';
import type { SourceRegistry } from '../registry';
import type { ExtractionResolver } from '../resolver';
import type { ExtractionResult, Failure, MediaIdentity, MediaRequest, QueryOptions, RequestServices, StreamCandidate, StreamEngine, StreamQueryResult } from './models';

export interface MediaResolver { resolve(request: MediaRequest, signal: AbortSignal): Promise<MediaIdentity> }

export class RuntimeStreamEngine implements StreamEngine {
  public constructor(private readonly mediaResolver: MediaResolver, private readonly sources: SourceRegistry, private readonly families: ReadonlyMap<string, SourceFamily>, private readonly resolver: ExtractionResolver, private readonly services: RequestServices, private readonly dependencies?: DependencyGraph, private readonly dependencyStore?: JsonDependencyStore) {}

  public async findStreams(request: MediaRequest, options: QueryOptions = {}): Promise<StreamQueryResult> {
    const started = Date.now();
    const budgetMs = options.deadlineMs ?? 12000;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), budgetMs);
    const discoveryController = new AbortController();
    const abortDiscovery = () => discoveryController.abort(controller.signal.reason);
    controller.signal.addEventListener('abort', abortDiscovery, { once: true });
    const discoveryDeadline = setTimeout(() => discoveryController.abort(), Math.floor(budgetMs * 0.7));
    const failures: Failure[] = [];
    const candidates: StreamCandidate[] = [];
    let completed = 0;
    let cancelled = 0;
    let attempted = 0;
    const excludedSourceIds = new Set(options.excludedSourceIds ?? []);
    const selectedSources = this.sources.runtimeEligible().filter(source => !excludedSourceIds.has(source.id)).sort((a, b) => ({ healthy: 0, degraded: 1, failed: 2 }[this.sources.health().get(a.id)?.lastOutcome ?? 'healthy']) - ({ healthy: 0, degraded: 1, failed: 2 }[this.sources.health().get(b.id)?.lastOutcome ?? 'healthy']) || (this.sources.health().get(b.id)?.recentSuccesses ?? 0) - (this.sources.health().get(a.id)?.recentSuccesses ?? 0) || (this.sources.health().get(a.id)?.recentFailures ?? 0) - (this.sources.health().get(b.id)?.recentFailures ?? 0) || a.id.localeCompare(b.id)).slice(0, options.maxSources ?? Number.MAX_SAFE_INTEGER);
    if (!selectedSources.length) return { streams: [], failures, unverified: candidates, deadline: { budgetMs, elapsedMs: Date.now() - started, exceeded: false, sourcesAttempted: 0, sourcesCompleted: 0, sourcesCancelled: 0 } };
    try {
      const media = await this.mediaResolver.resolve(request, controller.signal);
      const batchSize = Math.max(1, options.initialSourceBatch ?? 4);
      for (let offset = 0; offset < selectedSources.length && !discoveryController.signal.aborted; offset += batchSize) {
        const batch = selectedSources.slice(offset, offset + batchSize);
        attempted += batch.length;
        const tasks = batch.map(async (source) => {
          const family = source.family && this.families.get(source.family.id);
          if (!family) return;
          try {
            const result = await family.discoverMedia(media, source, this.services, discoveryController.signal);
            if (result.type === 'streams') for (const stream of result.streams) this.dependencies?.record({ sourceId: source.id, familyId: family.id, provider: stream.hostExtractor ?? stream.url.hostname, observedAt: new Date() });
            if (result.type === 'redirect') this.dependencies?.record({ sourceId: source.id, familyId: family.id, provider: result.target.url.hostname, observedAt: new Date() });
            if (result.type === 'embeds') for (const target of result.targets) this.dependencies?.record({ sourceId: source.id, familyId: family.id, provider: target.url.hostname, observedAt: new Date() });
            const consume = async (value: ExtractionResult) => {
              switch (value.type) {
                case 'streams':
                  candidates.push(...value.streams);
                  break;
                case 'failure':
                  failures.push({ ...value.failure, sourceId: value.failure.sourceId ?? source.id, familyId: value.failure.familyId ?? family.id, stage: value.failure.stage ?? 'stage:discovery' });
                  break;
                case 'redirect': {
                  const resolved = await this.resolver.resolve(value.target, discoveryController.signal);
                  candidates.push(...resolved.streams);
                  failures.push(...resolved.failures.map(failure => ({ ...failure, sourceId: failure.sourceId ?? source.id, familyId: failure.familyId ?? family.id })));
                  break;
                }
                case 'embeds': {
                  const resolved = await Promise.all(value.targets.map(target => this.resolver.resolve(target, discoveryController.signal)));
                  candidates.push(...resolved.flatMap(item => item.streams));
                  failures.push(...resolved.flatMap(item => item.failures.map(failure => ({ ...failure, sourceId: failure.sourceId ?? source.id, familyId: failure.familyId ?? family.id }))));
                  break;
                }
                case 'empty': break;
              }
            };
            await consume(result);
          } catch (error) {
            if (!discoveryController.signal.aborted) failures.push({ code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error), stage: 'stage:engine', sourceId: source.id, familyId: family.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
          } finally {
            if (discoveryController.signal.aborted) cancelled++;
            else completed++;
          }
        });
        await Promise.allSettled(tasks);
        if (candidates.length >= (options.minimumCandidates ?? 8)) break;
      }
      const selector = new StreamSelector(this.services);
      const preferredLanguages = options.preferredLanguages ?? request.preferredLanguages;
      const validation = await selector.validate(candidates, { topK: options.validationTopK ?? 8, ...(preferredLanguages && { preferredLanguages }), health: this.sources.health() }, controller.signal);
      failures.push(...validation.failures);
      return { streams: validation.streams, failures, unverified: validation.unverified, deadline: { budgetMs, elapsedMs: Date.now() - started, exceeded: controller.signal.aborted, sourcesAttempted: attempted, sourcesCompleted: completed, sourcesCancelled: Math.max(cancelled, attempted - completed) } };
    } catch (error) {
      failures.push({ code: controller.signal.aborted ? 'TIMEOUT' : 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error), stage: 'stage:engine', observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      return { streams: [], failures, unverified: candidates, deadline: { budgetMs, elapsedMs: Date.now() - started, exceeded: controller.signal.aborted, sourcesAttempted: attempted, sourcesCompleted: completed, sourcesCancelled: Math.max(cancelled, attempted - completed) } };
    } finally {
      await this.dependencyStore?.save(this.dependencies?.list() ?? []);
      clearTimeout(deadline);
      clearTimeout(discoveryDeadline);
      controller.signal.removeEventListener('abort', abortDiscovery);
    }
  }
}
