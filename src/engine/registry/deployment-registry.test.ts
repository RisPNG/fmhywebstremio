import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDeploymentSourceRegistry } from './deployment-registry';
import { SourceRegistry } from './source-registry';

describe('writeDeploymentSourceRegistry', () => {
  test('deterministically ships only runtime-eligible sources', async () => {
    const registry = new SourceRegistry();
    registry.set({ id: 'healthy:healthy.test', canonicalDomain: 'healthy.test', aliases: [], fmhy: { section: 'Streaming', tags: ['Movies'], firstSeenAt: new Date('2026-01-01'), lastSeenAt: new Date('2026-01-02') }, family: { id: 'family', confidence: 1, evidence: [], lastProbedAt: new Date('2026-01-02') }, status: 'supported' });
    registry.set({ id: 'degraded:degraded.test', canonicalDomain: 'degraded.test', aliases: [], fmhy: { section: 'Streaming', tags: [], firstSeenAt: new Date('2026-01-01'), lastSeenAt: new Date('2026-01-02') }, status: 'degraded' });
    registry.set({ id: 'failed:failed.test', canonicalDomain: 'failed.test', aliases: [], fmhy: { section: 'Streaming', tags: [], firstSeenAt: new Date('2026-01-01'), lastSeenAt: new Date('2026-01-02') }, status: 'degraded' });
    registry.recordHealth({ sourceId: 'healthy:healthy.test', lastOutcome: 'healthy', recentSuccesses: 2, recentFailures: 0, observedAt: new Date('2026-01-02') });
    registry.recordHealth({ sourceId: 'degraded:degraded.test', lastOutcome: 'degraded', recentSuccesses: 1, recentFailures: 1, observedAt: new Date('2026-01-02') });
    registry.recordHealth({ sourceId: 'failed:failed.test', lastOutcome: 'failed', recentSuccesses: 0, recentFailures: 2, observedAt: new Date('2026-01-02') });
    const path = join(await mkdtemp(join(tmpdir(), 'deployment-registry-')), 'registry.ts');

    await writeDeploymentSourceRegistry(registry, path);

    const generated = await readFile(path, 'utf8');
    expect(generated).toContain('healthy:healthy.test');
    expect(generated).not.toContain('degraded:degraded.test');
    expect(generated).not.toContain('failed:failed.test');
    expect(generated).not.toContain('2026-01-02');
    expect(generated.match(/new Date\(0\)/g)).toHaveLength(4);
  });
});
