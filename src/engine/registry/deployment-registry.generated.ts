import type { SourceRegistryState } from './source-registry';

export const deploymentSourceRegistry: SourceRegistryState = {
  records: [
    {
      id: 'cineby:cineby.at',
      canonicalDomain: 'cineby.at',
      aliases: [
        'cineplay.to',
        'fmovies.gd',
      ],
      fmhy: {
        section: '▷ Stream Aggregators',
        tags: [
          'recommended',
        ],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      status: 'supported',
      family: {
        id: 'cineby',
        confidence: 0.8500000000000001,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'cineby-brand',
          },
          {
            type: 'route-shape',
            value: '/movie|tv/{tmdbId}',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://www.cineby.at/',
      },
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
      status: 'supported',
      family: {
        id: 'cinego',
        confidence: 0.8500000000000001,
        evidence: [
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
    },
    {
      id: 'cinetaro:cinetaro.to',
      canonicalDomain: 'cinetaro.to',
      aliases: [],
      fmhy: {
        section: '▷ Stream Aggregators',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      status: 'supported',
      family: {
        id: 'cinetaro',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'cinetaro-search',
          },
          {
            type: 'route-shape',
            value: 'cinetaro-catalog-routes',
          },
          {
            type: 'script-signature',
            fingerprint: 'cinetaro-brand',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://cinetaro.to/',
      },
    },
  ],
  health: [
    {
      sourceId: 'cineby:cineby.at',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
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
    {
      sourceId: 'cinetaro:cinetaro.to',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
  ],
};
