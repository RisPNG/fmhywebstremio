import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Failure } from '../core/models';
import type { SourceRegistry } from '../registry';
import type { FamilyHealthCorpus, ProbeCaseOutcome } from './corpus';
import type { DependencyGraph } from './dependencies';
import type { FamilyHealthRunner } from './family-health-runner';
import type { SourceFamily } from './source-family';

export type SiteExtractability = 'extractable' | 'degraded' | 'failed' | 'unsupported' | 'redirected' | 'unreachable' | 'blocked' | 'inconclusive' | 'unknown' | 'disabled' | 'not-tested';

export interface SiteExtractabilityResult {
  sourceId: string;
  domain: string;
  section?: string;
  tags?: readonly string[];
  familyId?: string;
  status: SiteExtractability;
  runtimeEligible: boolean;
  stages: { recognition: boolean; discovery: boolean; extraction: boolean; validation: boolean };
  successes: number;
  failures: number;
  observedFinalUrl?: string;
  probeFailureCode?: Failure['code'];
  probeMessage?: string;
  cases?: readonly ProbeCaseOutcome[];
  failure?: Failure;
}

export interface ExtractabilityReport {
  generatedAt: Date;
  ok: boolean;
  totals: { sites: number; passed: number; extractable: number; degraded: number; failed: number; unsupported: number; redirected: number; unreachable: number; blocked: number; inconclusive: number; unknown: number; disabled: number; notTested: number; runtimeEligible: number };
  rootCauses: Readonly<Record<string, readonly string[]>>;
  sites: readonly SiteExtractabilityResult[];
}

export class ExtractabilityAuditRunner {
  public constructor(private readonly registry: SourceRegistry, private readonly health: FamilyHealthRunner, private readonly families: ReadonlyMap<string, SourceFamily>, private readonly corpora: ReadonlyMap<string, FamilyHealthCorpus>, private readonly dependencies?: DependencyGraph) {}

  public async run(signal: AbortSignal): Promise<ExtractabilityReport> {
    const sites: SiteExtractabilityResult[] = [];
    for (const source of this.registry.list()) {
      if (signal.aborted) break;
      const provenance = { ...(source.fmhy.section && { section: source.fmhy.section }), ...(source.fmhy.tags?.length && { tags: source.fmhy.tags }) };
      if (source.status === 'disabled') {
        sites.push({ sourceId: source.id, domain: source.canonicalDomain, ...provenance, ...(source.family && { familyId: source.family.id }), status: 'disabled', runtimeEligible: false, stages: { recognition: Boolean(source.family), discovery: false, extraction: false, validation: false }, successes: 0, failures: 0 });
        continue;
      }
      if (source.probe?.outcome === 'redirected' || source.probe?.outcome === 'unreachable' || source.probe?.outcome === 'blocked' || source.probe?.outcome === 'ambiguous' || source.probe?.outcome === 'budget-exceeded') {
        const status = source.probe.outcome === 'ambiguous' || source.probe.outcome === 'budget-exceeded' ? 'inconclusive' : source.probe.outcome;
        sites.push({ sourceId: source.id, domain: source.canonicalDomain, ...provenance, status, runtimeEligible: false, stages: { recognition: false, discovery: false, extraction: false, validation: false }, successes: 0, failures: 0, ...(source.probe.finalUrl && { observedFinalUrl: source.probe.finalUrl }), ...(source.probe.failureCode && { probeFailureCode: source.probe.failureCode }), ...(source.probe.message && { probeMessage: source.probe.message }) });
        continue;
      }
      if (!source.family) {
        sites.push({ sourceId: source.id, domain: source.canonicalDomain, ...provenance, status: source.status === 'unsupported' ? 'unsupported' : 'unknown', runtimeEligible: false, stages: { recognition: false, discovery: false, extraction: false, validation: false }, successes: 0, failures: 0, ...(source.probe?.finalUrl && { observedFinalUrl: source.probe.finalUrl }), ...(source.probe?.failureCode && { probeFailureCode: source.probe.failureCode }), ...(source.probe?.message && { probeMessage: source.probe.message }) });
        continue;
      }
      const family = this.families.get(source.family.id);
      const corpus = this.corpora.get(source.family.id);
      if (!family || !corpus) {
        sites.push({ sourceId: source.id, domain: source.canonicalDomain, ...provenance, familyId: source.family.id, status: 'not-tested', runtimeEligible: false, stages: { recognition: true, discovery: false, extraction: false, validation: false }, successes: 0, failures: 0 });
        continue;
      }
      try {
        const outcome = await this.health.run(source, family, corpus, signal);
        const history = this.registry.health().get(source.id);
        sites.push({ sourceId: source.id, domain: source.canonicalDomain, ...provenance, familyId: source.family.id, status: outcome.extractable ? outcome.status === 'healthy' ? 'extractable' : 'degraded' : 'failed', runtimeEligible: outcome.extractable, stages: { recognition: true, ...outcome.stages }, successes: history?.recentSuccesses ?? 0, failures: history?.recentFailures ?? 0, cases: outcome.cases });
      } catch (error) {
        const failure: Failure = { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error), stage: 'stage:engine', sourceId: source.id, familyId: family.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } };
        this.registry.set({ ...source, status: 'degraded' });
        this.registry.recordHealth({ sourceId: source.id, lastOutcome: 'failed', recentSuccesses: 0, recentFailures: corpus.cases.filter(test => test.expected === 'discoverable').length, observedAt: new Date() });
        sites.push({ sourceId: source.id, domain: source.canonicalDomain, ...provenance, familyId: family.id, status: 'failed', runtimeEligible: false, stages: { recognition: true, discovery: false, extraction: false, validation: false }, successes: 0, failures: corpus.cases.filter(test => test.expected === 'discoverable').length, failure });
      }
    }
    const totals = {
      sites: sites.length,
      passed: sites.filter(site => site.status === 'extractable' || site.status === 'degraded').length,
      extractable: sites.filter(site => site.status === 'extractable').length,
      degraded: sites.filter(site => site.status === 'degraded').length,
      failed: sites.filter(site => site.status === 'failed').length,
      unsupported: sites.filter(site => site.status === 'unsupported').length,
      redirected: sites.filter(site => site.status === 'redirected').length,
      unreachable: sites.filter(site => site.status === 'unreachable').length,
      blocked: sites.filter(site => site.status === 'blocked').length,
      inconclusive: sites.filter(site => site.status === 'inconclusive').length,
      unknown: sites.filter(site => site.status === 'unknown').length,
      disabled: sites.filter(site => site.status === 'disabled').length,
      notTested: sites.filter(site => site.status === 'not-tested').length,
      runtimeEligible: sites.filter(site => site.runtimeEligible).length,
    };
    const failures = sites.flatMap(site => [...(site.failure ? [site.failure] : []), ...(site.cases?.flatMap(test => test.failure ? [test.failure] : []) ?? [])]);
    return { generatedAt: new Date(), ok: totals.runtimeEligible > 0, totals, rootCauses: this.dependencies?.rollup(failures) ?? {}, sites };
  }
}

export class JsonExtractabilityReportStore {
  public constructor(private readonly path: string) {}

  public async load(): Promise<ExtractabilityReport | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as Omit<ExtractabilityReport, 'generatedAt' | 'totals'> & { generatedAt: string; totals: Omit<ExtractabilityReport['totals'], 'passed'> & { passed?: number } };
      return { ...value, generatedAt: new Date(value.generatedAt), totals: { ...value.totals, passed: value.totals.passed ?? value.totals.extractable + value.totals.degraded }, rootCauses: value.rootCauses ?? {}, sites: value.sites.map(site => ({ ...site, ...(site.cases && { cases: site.cases.map(test => ({ ...test, ...(test.failure && { failure: { ...test.failure, observedAt: new Date(test.failure.observedAt) } }) })) }), ...(site.failure && { failure: { ...site.failure, observedAt: new Date(site.failure.observedAt) } }) })) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  public async save(report: ExtractabilityReport): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(report, null, 2));
    await rename(temporaryPath, this.path);
  }
}
