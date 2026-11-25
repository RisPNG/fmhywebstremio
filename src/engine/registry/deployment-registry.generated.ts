import type { SourceRegistryState } from './source-registry';

export const deploymentSourceRegistry: SourceRegistryState = {
  records: [
    {
      id: 'atlantic:atlantic.bz',
      canonicalDomain: 'atlantic.bz',
      aliases: [],
      fmhy: {
        name: 'Atlantic',
        section: '▷ Android TV / Firestick',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      family: {
        id: 'atlantic',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'atlantic-brand',
          },
          {
            type: 'dom-shape',
            fingerprint: 'atlantic-title',
          },
          {
            type: 'asset-path',
            value: 'atlantic-vite-client',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://atlantic.bz/',
      },
      status: 'supported',
    },
    {
      id: 'bilibili:bilibili.com',
      canonicalDomain: 'bilibili.tv',
      aliases: [
        'bilibili.com',
        'mikuinv.apicalshark.dedyn.io',
        'github.com',
        'watch.typetype.video',
        'typetype.video',
        'reddit.com',
      ],
      fmhy: {
        name: 'BiliBili',
        section: '▷ Video Streaming',
        tags: [
          'recommended',
        ],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      family: {
        id: 'bilibili',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'bilibili-international-brand',
          },
          {
            type: 'script-signature',
            fingerprint: 'bilibili-bstar-metadata',
          },
          {
            type: 'asset-path',
            value: 'bilibili-bstar-client',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://www.bilibili.tv/',
      },
      status: 'supported',
    },
    {
      id: 'cinefork:cinefork.net',
      canonicalDomain: 'cinefork.net',
      aliases: [],
      fmhy: {
        name: 'Cinefork',
        section: '▷ P-Stream Forks',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      family: {
        id: 'cinefork',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'cinefork-brand',
          },
          {
            type: 'dom-shape',
            fingerprint: 'cinefork-runtime-config',
          },
          {
            type: 'asset-path',
            value: 'cinefork-vite-client',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://cinefork.net/',
      },
      status: 'supported',
    },
    {
      id: 'cineruv:cineruv.website',
      canonicalDomain: 'cineruv.website',
      aliases: [],
      fmhy: {
        name: 'cineruv',
        section: '▷ Stream Aggregators',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
      family: {
        id: 'cineruv',
        confidence: 1,
        evidence: [
          {
            type: 'script-signature',
            fingerprint: 'cineruv-brand',
          },
          {
            type: 'dom-shape',
            fingerprint: 'cineruv-catalog-identity',
          },
          {
            type: 'asset-path',
            value: 'cineruv-vite-client',
          },
        ],
        lastProbedAt: new Date(0),
      },
      probe: {
        outcome: 'matched',
        observedAt: new Date(0),
        finalUrl: 'https://cineruv.website/',
      },
      status: 'supported',
    },
    {
      id: 'kkphim:kkphim.com',
      canonicalDomain: 'kkphim.com',
      aliases: [
        'kkphim2.com',
      ],
      fmhy: {
        name: 'kkphim',
        section: '▷ Streaming / Phát trực tuyến',
        tags: [],
        firstSeenAt: new Date(0),
        lastSeenAt: new Date(0),
      },
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
      status: 'supported',
    },
    {
      id: 'milkbox:milkbox.fyi',
      canonicalDomain: 'milkbox.fyi',
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
        finalUrl: 'https://milkbox.fyi/',
      },
      status: 'supported',
    },
    {
      id: 'sweetfox:67movies.st',
      canonicalDomain: '67movies.st',
      aliases: [
        'sweetfox.st',
        'sweetfox.app',
      ],
      fmhy: {
        name: 'SweetFox',
        section: '▷ Stream Aggregators',
        tags: [],
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
  ],
  health: [
    {
      sourceId: 'atlantic:atlantic.bz',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'bilibili:bilibili.com',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'cinefork:cinefork.net',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'cineruv:cineruv.website',
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
      sourceId: 'milkbox:milkbox.fyi',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
    {
      sourceId: 'sweetfox:67movies.st',
      lastOutcome: 'healthy',
      recentSuccesses: 3,
      recentFailures: 0,
      observedAt: new Date(0),
    },
  ],
};
