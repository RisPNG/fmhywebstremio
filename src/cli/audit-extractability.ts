import { resolve } from 'node:path';
import { FmhyDirectoryProvider, FmhyMaintenanceService, JsonDirectorySnapshotStore } from '../discovery/fmhy';
import { defaultFamilyHealthCorpora, DependencyGraph, ExtractabilityAuditRunner, FamilyHealthRunner, JsonDependencyStore, JsonExtractabilityReportStore, SourceFamilyProbeRunner } from '../engine/health';
import { StreamSelector } from '../engine/protocols';
import { JsonSourceRegistryStore, MatcherRegistry, RegistryExtractorLookup, SourceRegistry } from '../engine/registry';
import { ExtractionResolver } from '../engine/resolver';
import { TransportDirector } from '../engine/transport';
import { extractorRegistry } from '../extractors/registry.generated';
import { DooplayFamily } from '../extractors/sources/dooplay-family';

const dataDirectory = resolve(process.env['EXTRACTABILITY_DATA_DIR'] ?? '.data/extractability');
const transport = new TransportDirector({ globalConcurrency: 24, perHostConcurrency: 3, maxRetries: 1 });
const registry = new SourceRegistry();
const registryStore = new JsonSourceRegistryStore(resolve(dataDirectory, 'sources.json'));
const families = new Map([['dooplay', new DooplayFamily()]]);
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort(new Error(signal)));

const provider = new FmhyDirectoryProvider(transport, undefined, new JsonDirectorySnapshotStore(resolve(dataDirectory, 'fmhy-snapshot.json')));
const probes = new SourceFamilyProbeRunner(transport, [...families.values()], { maxRequests: 1, maxBytes: 1024 * 1024, deadlineMs: Number(process.env['EXTRACTABILITY_RECOGNITION_TIMEOUT_MS'] ?? 10000) });
const maintenance = new FmhyMaintenanceService(provider, registry, probes, registryStore, Number(process.env['EXTRACTABILITY_CONCURRENCY'] ?? 8), Number(process.env['EXTRACTABILITY_REPROBE_INTERVAL_MS'] ?? 24 * 60 * 60 * 1000));
const dependencies = new DependencyGraph();
const dependencyStore = new JsonDependencyStore(resolve(dataDirectory, 'dependencies.json'));
const resolver = new ExtractionResolver(new RegistryExtractorLookup(new MatcherRegistry(extractorRegistry)), transport, { onDelegation: (_parent, child) => {
  const sourceId = child.hints?.['sourceId'];
  const familyId = child.hints?.['sourceExtractor'];
  if (typeof sourceId === 'string' && typeof familyId === 'string') dependencies.record({ sourceId, familyId, provider: child.url.hostname, observedAt: new Date() });
} });
const health = new FamilyHealthRunner(resolver, new StreamSelector(transport), transport, registry, Number(process.env['EXTRACTABILITY_QUORUM'] ?? 0.5), dependencies);
const reportStore = new JsonExtractabilityReportStore(resolve(dataDirectory, 'report.json'));

async function runExtractabilityAudit(): Promise<void> {
  dependencies.restore(await dependencyStore.load());
  const watch = process.argv.includes('--watch');
  const intervalMs = Number(process.env['EXTRACTABILITY_INTERVAL_MS'] ?? 6 * 60 * 60 * 1000);
  do {
    const update = await maintenance.synchronize(controller.signal);
    const report = await new ExtractabilityAuditRunner(registry, health, families, defaultFamilyHealthCorpora, dependencies).run(controller.signal);
    await registryStore.save(registry.snapshot());
    await dependencyStore.save(dependencies.list());
    await reportStore.save(report);

    process.stdout.write(`${JSON.stringify({ directory: update.ok ? { ok: true, entries: update.snapshot.entries.length, changes: update.diff.length } : { ok: false, code: update.failure.code, message: update.failure.message, usedLastKnownGood: Boolean(update.snapshot) }, reportPath: resolve(dataDirectory, 'report.json'), generatedAt: report.generatedAt, ok: report.ok, totals: report.totals, rootCauses: report.rootCauses }, null, 2)}\n`);
    if (!watch) {
      if (!report.ok) process.exitCode = 1;
      return;
    }
    await new Promise<void>((complete) => {
      const onAbort = () => {
        clearTimeout(timer);
        complete();
      };
      const timer = setTimeout(() => {
        controller.signal.removeEventListener('abort', onAbort);
        complete();
      }, intervalMs);
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
  } while (!controller.signal.aborted);
}

void runExtractabilityAudit().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
