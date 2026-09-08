import type { SourceRegistryState } from './source-registry';

export const deploymentSourceRegistry: SourceRegistryState = {
  records: [
    {
      id: 'bingebang:bingebang.tv',
      canonicalDomain: 'bingebang.tv',
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
        finalUrl: 'https://bingebang.tv/',
      },
    },
    {
      id: 'cinego:cinego.co',
      canonicalDomain: 'cinego.co',
      aliases: [],
      fmhy: {
        name: 'CineGo',
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
      id: 'cinemaos:cinemaos.live',
      canonicalDomain: 'cinemaos.live',
      aliases: [
        'cinemaos.tech',
        'cinemaos.me',
        'noirx.me',
        'noirx.live',
      ],
      fmhy: {
        name: 'CinemaOS',
        section: '▷ Stream Aggregators',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
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
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://cinemaos.live/',
      },
    },
    {
      id: 'movies-to-watch:moviestowatch.top',
      canonicalDomain: 'moviestowatch.top',
      aliases: [],
      fmhy: {
        name: 'Movies To Watch',
        section: '▷ Multi-Server (Backups)',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      status: 'supported',
      family: {
        id: 'tmdb-embed-catalog',
        confidence: 1,
        evidence: [
          {
            type: 'api-shape',
            fingerprint: 'tmdb-client-catalog',
          },
          {
            type: 'script-signature',
            fingerprint: 'tmdb-search-season-catalog',
          },
          {
            type: 'route-shape',
            value: 'videasy-movie-episode-players',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://www.moviestowatch.top/',
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
      sourceId: 'bingebang:bingebang.tv',
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
      sourceId: 'movies-to-watch:moviestowatch.top',
      lastOutcome: 'healthy',
      recentSuccesses: 2,
      recentFailures: 1,
      observedAt: new Date(0),
    },
    {
      sourceId: 'soapgo:soapgo.to',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
  ],
};
