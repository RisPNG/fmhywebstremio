import { FmhyDirectoryProvider } from '../discovery/fmhy';
import { sanitizeDiagnosticUrl } from '../engine/core/models';
import { SourceRegistry } from '../engine/registry';
import { TransportDirector, TransportFailure } from '../engine/transport';

async function probeReachability(): Promise<void> {
  const domains = [...new Set(process.argv.slice(2))];
  if (!domains.length || domains.length > 10) throw new Error('Provide between one and ten current FMHY domains');
  const transport = new TransportDirector({ globalConcurrency: 3, perHostConcurrency: 1, maxRetries: 0, maxRedirects: 3 });
  const signal = AbortSignal.timeout(120000);
  const update = await new FmhyDirectoryProvider(transport).fetchSnapshot(signal);
  if (!update.ok) throw new Error(`${update.failure.code}: ${update.failure.message}`);
  const registry = new SourceRegistry();
  registry.apply(update.snapshot);
  const targets = domains.map((domain) => {
    const source = registry.list().find(candidate => [candidate.canonicalDomain, ...candidate.aliases].includes(domain));
    if (!source) throw new Error(`Domain is not in the current FMHY directory: ${domain}`);
    return { domain, source };
  });
  const results = await Promise.all(targets.map(async ({ domain, source }) => {
    const provenance = { domain, sourceId: source.id, name: source.fmhy.name, section: source.fmhy.section, tags: source.fmhy.tags };
    const startedAt = Date.now();
    try {
      const response = await transport.request({ url: new URL(`https://${domain}/`), expectedContent: 'html', timeoutMs: 15000, maxBytes: 256 * 1024 }, signal);
      const challenge = response.headers['cf-mitigated'] === 'challenge' || /<title>\s*(?:Just a moment|Attention Required)/i.test(response.text());
      const redirected = ![source.canonicalDomain, ...source.aliases].includes(response.finalUrl.hostname.replace(/^www\d*\./, ''));
      return { ...provenance, outcome: challenge ? 'blocked' : redirected ? 'redirected' : response.status >= 200 && response.status < 300 ? 'reachable' : 'failed', status: response.status, finalUrl: sanitizeDiagnosticUrl(response.finalUrl), truncated: response.truncated, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      if (!(error instanceof TransportFailure)) throw error;
      const failure = error.failure;
      return { ...provenance, outcome: failure.code === 'HTTP_FORBIDDEN' || failure.code === 'RATE_LIMITED' ? 'blocked' : failure.code === 'TIMEOUT' ? 'inconclusive' : 'unreachable', failureCode: failure.code, status: failure.diagnostic?.status, elapsedMs: Date.now() - startedAt };
    }
  }));
  process.stdout.write(`${JSON.stringify({ generatedAt: new Date(), revision: process.env['RENDER_GIT_COMMIT'] ?? 'development', directoryFetchedAt: update.snapshot.fetchedAt, playbackTested: false, results }, null, 2)}\n`);
}

void probeReachability().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
