import type { SourceFamilyProbeRunner } from '../../engine/health';
import type { JsonSourceRegistryStore, SourceRegistry } from '../../engine/registry';
import type { DirectoryUpdate } from './models';
import type { FmhyDirectoryProvider } from './provider';

export class FmhyMaintenanceService {
  public constructor(private readonly provider: FmhyDirectoryProvider, private readonly registry: SourceRegistry, private readonly probes: SourceFamilyProbeRunner, private readonly store?: JsonSourceRegistryStore, private readonly concurrency = 8, private readonly reprobeAfterMs = 24 * 60 * 60 * 1000) {}

  public async synchronize(signal: AbortSignal): Promise<DirectoryUpdate> {
    const persisted = await this.store?.load();
    if (persisted && this.registry.list().length === 0) this.registry.restore(persisted);
    const update = await this.provider.fetchSnapshot(signal);
    if (!update.ok) return update;
    this.registry.apply(update.snapshot);
    const candidates = this.registry.list().filter(source => source.status !== 'disabled' && (!source.probe || Date.now() - source.probe.observedAt.getTime() >= this.reprobeAfterMs));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(this.concurrency, candidates.length) }, async () => {
      while (!signal.aborted) {
        const source = candidates[next++];
        if (!source) break;
        const recognition = await this.probes.recognize(source, signal);
        const knownDomains = [source.canonicalDomain, ...source.aliases].map(domain => domain.replace(/^www\d*\./, ''));
        const redirected = recognition.snapshot && !knownDomains.includes(recognition.snapshot.finalUrl.hostname.replace(/^www\d*\./, ''));
        if (recognition.type === 'matched') {
          if (redirected) {
            const unassigned = { ...source };
            delete unassigned.family;
            this.registry.set({ ...unassigned, status: 'unsupported', probe: { outcome: 'redirected', observedAt: new Date(), finalUrl: recognition.snapshot.finalUrl.href, message: `Candidate redirected to ${recognition.snapshot.finalUrl.hostname}` } });
          } else {
            this.registry.set({ ...source, family: { id: recognition.match.familyId, confidence: recognition.match.confidence, evidence: [...recognition.match.evidence], lastProbedAt: new Date() }, probe: { outcome: 'matched', observedAt: new Date(), finalUrl: recognition.snapshot.finalUrl.href } });
          }
        } else if (redirected && recognition.snapshot) {
          const unassigned = { ...source };
          delete unassigned.family;
          this.registry.set({ ...unassigned, status: 'unsupported', probe: { outcome: 'redirected', observedAt: new Date(), finalUrl: recognition.snapshot.finalUrl.href, failureCode: recognition.failure.code, message: `Candidate redirected to ${recognition.snapshot.finalUrl.hostname}` } });
        } else if (recognition.failure.code === 'UNSUPPORTED_SOURCE_PATTERN') {
          const unassigned = { ...source };
          delete unassigned.family;
          this.registry.set({ ...unassigned, status: 'unsupported', probe: { outcome: 'unsupported', observedAt: new Date(), ...(recognition.snapshot && { finalUrl: recognition.snapshot.finalUrl.href }), failureCode: recognition.failure.code, message: recognition.failure.message } });
        } else {
          const outcome = recognition.failure.code === 'FAMILY_PROBE_BLOCKED' ? 'blocked' : recognition.failure.code === 'FAMILY_PROBE_AMBIGUOUS' ? 'ambiguous' : recognition.failure.code === 'FAMILY_PROBE_BUDGET_EXCEEDED' ? 'budget-exceeded' : 'unreachable';
          const unassigned = { ...source };
          delete unassigned.family;
          this.registry.set({ ...unassigned, status: 'unknown', probe: { outcome, observedAt: new Date(), ...(recognition.snapshot && { finalUrl: recognition.snapshot.finalUrl.href }), failureCode: recognition.failure.code, message: recognition.failure.message } });
        }
      }
    }));
    await this.store?.save(this.registry.snapshot());
    return update;
  }
}
