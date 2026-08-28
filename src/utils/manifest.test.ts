import winston from 'winston';
import { SourceRegistry } from '../engine/registry';
import { DoodStream } from '../extractor/DoodStream';
import { ExternalUrl } from '../extractor/ExternalUrl';
import { SuperVideo } from '../extractor/SuperVideo';
import { createSources } from '../source';
import { FourKHDHub } from '../source/FourKHDHub';
import { MeineCloud } from '../source/MeineCloud';
import { VerHdLink } from '../source/VerHdLink';
import { VixSrc } from '../source/VixSrc';
import { FetcherMock } from './FetcherMock';
import { buildManifest } from './manifest';

const fetcher = new FetcherMock('/dev/null');
const logger = winston.createLogger({ transports: [new winston.transports.Console({ level: 'nope' })] });

describe('buildManifest', () => {
  test('default manifest', async () => {
    const manifest = buildManifest(createSources(fetcher), [], {});

    expect(manifest).toMatchSnapshot({
      version: expect.any(String),
    });
  });

  test('has unchecked source without a config', () => {
    const sources = [
      new FourKHDHub(fetcher),
      new VixSrc(fetcher),
      new VerHdLink(fetcher),
      new MeineCloud(fetcher),
    ];

    const manifest = buildManifest(sources, [], {});

    expect(manifest.config).toMatchSnapshot();
  });

  test('has checked source with appropriate config', () => {
    const sources = [
      new VerHdLink(fetcher),
      new MeineCloud(fetcher),
    ];
    const manifest = buildManifest(sources, [], { de: 'on', includeExternalUrls: 'on' });

    expect(manifest.config).toMatchSnapshot();
  });

  test('showErrors and includeExternalUrls are unchecked by default', () => {
    const manifest = buildManifest([], [], {});

    expect(manifest.config).toMatchSnapshot();
  });

  test('has checked showErrors', () => {
    const manifest = buildManifest([], [], { showErrors: 'on' });

    expect(manifest.config).toMatchSnapshot();
  });

  test('has checked includeExternalUrls', () => {
    const manifest = buildManifest([], [], { includeExternalUrls: 'on' });

    expect(manifest.config).toMatchSnapshot();
  });

  test('disable extractors', () => {
    const extractors = [
      new DoodStream(fetcher, logger),
      new SuperVideo(fetcher, logger),
      new ExternalUrl(fetcher, logger),
    ];
    const manifest = buildManifest([], extractors, { disableExtractor_doodstream: 'on' });

    expect(manifest.config).toMatchSnapshot();
  });

  test('has checked excludeResolution_2160p', () => {
    const manifest = buildManifest([], [], { excludeResolution_2160p: 'on' });

    expect(manifest.config).toMatchSnapshot();
  });

  test('lists runtime-eligible FMHY sources with health and selection state', () => {
    const registry = new SourceRegistry();
    registry.set({ id: 'aether:aether.test', canonicalDomain: 'aether.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'pstream', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'supported' });
    registry.set({ id: 'new:new.test', canonicalDomain: 'new.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'pstream', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'supported' });
    registry.set({ id: 'stagnant:stagnant.test', canonicalDomain: 'stagnant.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'pstream', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'degraded' });
    registry.set({ id: 'failed:failed.test', canonicalDomain: 'failed.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'pstream', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'degraded' });
    registry.recordHealth({ sourceId: 'aether:aether.test', lastOutcome: 'healthy', recentSuccesses: 2, recentFailures: 0, observedAt: new Date(0) });
    registry.recordHealth({ sourceId: 'failed:failed.test', lastOutcome: 'failed', recentSuccesses: 0, recentFailures: 2, observedAt: new Date(0) });
    registry.recordHealth({ sourceId: 'stagnant:stagnant.test', lastOutcome: 'degraded', recentSuccesses: 0, recentFailures: 1, observedAt: new Date(0) });
    const manifest = buildManifest([], [], { 'disableFmhySource_aether:aether.test': 'on' }, registry);
    expect(manifest.config.filter(config => config.key.startsWith('disableFmhySource_'))).toEqual([{ key: 'disableFmhySource_aether:aether.test', type: 'checkbox', title: 'aether.test — healthy', default: 'checked' }]);
  });
});
