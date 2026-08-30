import { SourceRegistry } from '../engine/registry';
import { buildManifest } from './manifest';

describe('buildManifest', () => {
  test('builds the stable addon manifest', () => {
    const manifest = buildManifest({}, new SourceRegistry());

    expect(manifest).toMatchObject({
      name: expect.any(String),
      description: 'Provides video HTTP URLs from streaming websites listed by FMHY.',
      resources: ['stream'],
      types: ['movie', 'series'],
      idPrefixes: ['tmdb:', 'tt'],
      config: [],
    });
  });

  test('lists only runtime-eligible FMHY sources with selection state', () => {
    const registry = new SourceRegistry();
    registry.set({ id: 'healthy:healthy.test', canonicalDomain: 'healthy.test', aliases: [], fmhy: { section: 'Streaming', tags: ['Movies'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'family', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'supported' });
    registry.set({ id: 'degraded:degraded.test', canonicalDomain: 'degraded.test', aliases: [], fmhy: { section: 'Streaming', tags: ['Movies'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'family', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'degraded' });
    registry.set({ id: 'failed:failed.test', canonicalDomain: 'failed.test', aliases: [], fmhy: { section: 'Streaming', tags: ['Movies'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'family', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'degraded' });
    registry.recordHealth({ sourceId: 'healthy:healthy.test', lastOutcome: 'healthy', recentSuccesses: 2, recentFailures: 0, observedAt: new Date(0) });
    registry.recordHealth({ sourceId: 'degraded:degraded.test', lastOutcome: 'degraded', recentSuccesses: 1, recentFailures: 1, observedAt: new Date(0) });
    registry.recordHealth({ sourceId: 'failed:failed.test', lastOutcome: 'failed', recentSuccesses: 0, recentFailures: 2, observedAt: new Date(0) });

    const manifest = buildManifest({ 'disableFmhySource_healthy:healthy.test': 'on' }, registry);

    expect(manifest.config).toEqual([{
      key: 'disableFmhySource_healthy:healthy.test',
      type: 'checkbox',
      title: 'healthy.test',
      default: 'checked',
    }]);
  });
});
