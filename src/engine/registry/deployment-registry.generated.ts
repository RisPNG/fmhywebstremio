import type { SourceRegistryState } from './source-registry';

export const deploymentSourceRegistry: SourceRegistryState = {
  records: [
    {
      id: '7movies:7movies.ac',
      canonicalDomain: '7movies.ac',
      aliases: [],
      fmhy: {
        name: '7Movies',
        section: '▷ Stream Aggregators',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      status: 'supported',
      family: {
        id: 'cinrift',
        confidence: 1,
        evidence: [
          {
            type: 'dom-shape',
            fingerprint: 'vidrift-player-preconnect',
          },
          {
            type: 'script-signature',
            fingerprint: 'cinrift-client',
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
        finalUrl: 'https://7movies.ac/',
      },
    },
    {
      id: 'anicine:anicine.xyz',
      canonicalDomain: 'anicine.xyz',
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
      status: 'supported',
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
        finalUrl: 'https://anicine.xyz/',
      },
    },
    {
      id: 'bingebang:bingebang.st',
      canonicalDomain: 'bingebang.st',
      aliases: [],
      fmhy: {
        name: 'BingeBang',
        section: '▷ Stream Aggregators',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      status: 'supported',
      family: {
        id: 'bingebang',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'bingebang-client',
          },
          {
            type: 'api-shape',
            fingerprint: 'bingebang-explore-search',
          },
          {
            type: 'route-shape',
            value: '/movie|tv/watch/{slug}',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://bingebang.st/',
      },
    },
    {
      id: 'cinego:cinego.co',
      canonicalDomain: 'cinego.co',
      aliases: [],
      fmhy: {
        name: 'CineGo',
        section: '▷ Multi-Server',
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
      id: 'soapgo:soapgo.to',
      canonicalDomain: 'soapgo.to',
      aliases: [],
      fmhy: {
        name: 'SoapGo',
        section: '▷ Dedicated-Server',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      status: 'supported',
      family: {
        id: 'soaper',
        confidence: 1,
        evidence: [
          {
            type: 'dom-shape',
            fingerprint: 'soaper-landing-brand',
          },
          {
            type: 'api-shape',
            fingerprint: 'soaper-catalog-search',
          },
          {
            type: 'route-shape',
            value: 'soaper-catalog-navigation',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://soapgo.to/',
      },
    },
  ],
  health: [
    {
      sourceId: '7movies:7movies.ac',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'anicine:anicine.xyz',
      lastOutcome: 'healthy',
      recentSuccesses: 5,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'bingebang:bingebang.st',
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
      sourceId: 'soapgo:soapgo.to',
      lastOutcome: 'healthy',
      recentSuccesses: 2,
      recentFailures: 1,
      observedAt: new Date(0),
    },
  ],
};
