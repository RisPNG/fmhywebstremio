import type { SourceRegistryState } from './source-registry';

export const deploymentSourceRegistry: SourceRegistryState = {
  records: [
    {
      id: '7movies:7movies.in',
      canonicalDomain: '7movies.in',
      aliases: [],
      fmhy: {
        section: '▷ Stream Aggregators',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      status: 'supported',
      family: {
        id: 'cinrift',
        confidence: 0.8500000000000001,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'vidrift-player',
          },
          {
            type: 'script-signature',
            fingerprint: 'cinrift-brand',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://7movies.in/',
      },
    },
  ],
  health: [
    {
      sourceId: '7movies:7movies.in',
      lastOutcome: 'healthy',
      recentSuccesses: 2,
      recentFailures: 0,
      observedAt: new Date(0),
    },
  ],
};
