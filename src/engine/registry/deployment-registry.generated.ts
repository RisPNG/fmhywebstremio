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
      status: 'supported',
    },
    {
      id: 'cinego:cinego.co',
      canonicalDomain: 'cinego.co',
      aliases: [],
      fmhy: {
        section: '▷ Multi-Server (Backups)',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      family: {
        id: 'cinego',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'cinego-client',
          },
          {
            type: 'route-shape',
            value: 'cinego-catalog-routes',
          },
          {
            type: 'script-signature',
            fingerprint: 'cinego-player-grant',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://cinego.co/',
      },
      status: 'supported',
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
    {
      sourceId: 'cinego:cinego.co',
      lastOutcome: 'healthy',
      recentSuccesses: 2,
      recentFailures: 0,
      observedAt: new Date(0),
    },
  ],
};
