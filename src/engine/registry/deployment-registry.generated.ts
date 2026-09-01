import type { SourceRegistryState } from './source-registry';

export const deploymentSourceRegistry: SourceRegistryState = {
  records: [
    {
      id: '67movies:67movies.net',
      canonicalDomain: '67movies.nl',
      aliases: [
        '67movies.net',
        'shows.st',
        'phantomflix.net',
        'ravenflix.net',
      ],
      fmhy: {
        section: '▷ Stream Aggregators',
        tags: [
          'recommended',
        ],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
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
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://67movies.nl/',
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
      status: 'supported',
    },
    {
      id: 'cinemaos:cinemaos.live',
      canonicalDomain: 'cinemaos.live',
      aliases: [
        'cinemaos.tech',
        'cinemaos.me',
        'noirx.me',
        'noirx.live',
      ],
      fmhy: {
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
        finalUrl: 'https://cinemaos.live/',
      },
      status: 'supported',
      family: {
        id: 'cinemaos',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'cinemaos-brand',
          },
          {
            type: 'route-shape',
            value: '/movie|tv/watch/{tmdbId}',
          },
          {
            type: 'asset-path',
            value: 'cinemaos-next-client',
          },
        ],
        lastProbedAt: new Date(0),
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
      status: 'supported',
    },
  ],
  health: [
    {
      sourceId: '67movies:67movies.net',
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
      sourceId: 'cinemaos:cinemaos.live',
      lastOutcome: 'healthy',
      recentSuccesses: 2,
      recentFailures: 1,
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
