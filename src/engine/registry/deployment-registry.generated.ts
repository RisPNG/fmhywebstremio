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
        finalUrl: 'https://67movies.st/',
      },
      status: 'supported',
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
    {
      id: 'arrowtv:arrowtv.net',
      canonicalDomain: 'arrowtv.net',
      aliases: [
        'neonflix.st',
        'cinezo.st',
        'flikhub.net',
      ],
      fmhy: {
        name: 'ArrowTV',
        section: '▷ Stream Aggregators',
        tags: [
          'recommended',
        ],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      family: {
        id: 'arrowtv',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'arrowtv-catalog-description',
          },
          {
            type: 'route-shape',
            value: 'arrowtv-tmdb-watch-routes',
          },
          {
            type: 'route-shape',
            value: 'arrowtv-catalog-nav',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://arrowtv.net/',
      },
      status: 'supported',
    },
    {
      id: 'kkphim:kkphim.com',
      canonicalDomain: 'kkphim.com',
      aliases: [],
      fmhy: {
        name: 'kkphim',
        section: '▷ Streaming / Phát trực tuyến',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      status: 'supported',
      family: {
        id: 'kkphim',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'kkphim-brand',
          },
          {
            type: 'route-shape',
            value: 'kkphim-api-catalog',
          },
          {
            type: 'asset-path',
            value: 'kkphim-main-client',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://kkphim.com/',
      },
    },
    {
      id: 'milkbox:milkbox.zapto.org',
      canonicalDomain: 'milkbox.zapto.org',
      aliases: [],
      fmhy: {
        name: 'MilkBox',
        section: '▷ Multi-Server',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      family: {
        id: 'milkbox',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'milkbox-brand',
          },
          {
            type: 'dom-shape',
            fingerprint: 'milkbox-catalog-player',
          },
          {
            type: 'asset-path',
            value: 'milkbox-app-client',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://milkbox.zapto.org/',
      },
      status: 'supported',
    },
    {
      id: 'movienerds:movienerds.site',
      canonicalDomain: 'movienerds.site',
      aliases: [
        'vidflix.live',
        'movieplex.online',
      ],
      fmhy: {
        name: 'MovieNerds',
        section: '▷ Stream Aggregators',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      family: {
        id: 'movienerds',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'movienerds-brand',
          },
          {
            type: 'script-signature',
            fingerprint: 'movienerds-canonical-host',
          },
          {
            type: 'dom-shape',
            fingerprint: 'movienerds-vite-client',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://movienerds.site/',
      },
      status: 'supported',
    },
    {
      id: 'pressplay:pressplayx.to',
      canonicalDomain: 'pressplayx.to',
      aliases: [],
      fmhy: {
        name: 'PressPlay',
        section: '▷ Dedicated-Server',
        tags: [
          'recommended',
        ],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      family: {
        id: 'pressplayx',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'pressplayx-brand',
          },
          {
            type: 'generator-meta',
            value: 'pressplayx-astro',
          },
          {
            type: 'route-shape',
            value: 'pressplayx-watch-slug',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://pressplayx.to/',
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
    {
      sourceId: 'arrowtv:arrowtv.net',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'kkphim:kkphim.com',
      lastOutcome: 'healthy',
      recentSuccesses: 4,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'milkbox:milkbox.zapto.org',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'movienerds:movienerds.site',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'pressplay:pressplayx.to',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
  ],
};
