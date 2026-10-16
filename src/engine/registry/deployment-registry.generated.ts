import type { SourceRegistryState } from './source-registry';

export const deploymentSourceRegistry: SourceRegistryState = {
  records: [
    {
      id: '67movies:67movies.st',
      canonicalDomain: '67movies.st',
      aliases: [
        'phantomflix.net',
      ],
      fmhy: {
        name: '67Movies',
        section: '▷ Multi-Server',
        tags: [
          'recommended',
        ],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://67movies.st/',
      },
      status: 'supported',
      family: {
        id: 'sixty-seven-movies',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'sixty-seven-movies-brand',
          },
          {
            type: 'route-shape',
            value: 'sixty-seven-movies-catalog',
          },
          {
            type: 'asset-path',
            value: 'sixty-seven-movies-next-client',
          },
        ],
        lastProbedAt: new Date(0),
      },
    },
    {
      id: 'anicine:anicine.sbs',
      canonicalDomain: 'anicine.sbs',
      aliases: [],
      fmhy: {
        name: 'AniCine',
        section: '▷ Multi-Server',
        tags: [
          'recommended',
        ],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      family: {
        id: 'anicine',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'anicine-catalog-brand',
          },
          {
            type: 'route-shape',
            value: 'anicine-catalog-navigation',
          },
          {
            type: 'dom-shape',
            fingerprint: 'anicine-watch-catalog',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://anicine.sbs/',
      },
      status: 'supported',
    },
  ],
  health: [
    {
      sourceId: '67movies:67movies.st',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'anicine:anicine.sbs',
      lastOutcome: 'healthy',
      recentSuccesses: 5,
      recentFailures: 0,
      observedAt: new Date(0),
    },
  ],
};
