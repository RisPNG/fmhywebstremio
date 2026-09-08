import type { SourceRegistryState } from './source-registry';

export const deploymentSourceRegistry: SourceRegistryState = {
  records: [
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
      id: 'vidbox:cinehd.app',
      canonicalDomain: 'vidbox.vc',
      aliases: [
        'cinehd.app',
        'hotflix.to',
      ],
      fmhy: {
        name: 'Vidbox',
        section: '▷ Multi-Server',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      status: 'supported',
      family: {
        id: 'vidbox',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'vidbox-streaming-guide',
          },
          {
            type: 'route-shape',
            value: '/search?type=movie|tv',
          },
          {
            type: 'asset-path',
            value: 'vidbox-next-client',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://vidbox.vc/',
      },
    },
  ],
  health: [
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
      sourceId: 'vidbox:cinehd.app',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
  ],
};
