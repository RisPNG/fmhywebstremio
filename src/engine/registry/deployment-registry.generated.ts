import type { SourceRegistryState } from './source-registry';

export const deploymentSourceRegistry: SourceRegistryState = {
  records: [
    {
      id: 'bilibili:bilibili.com',
      canonicalDomain: 'bilibili.tv',
      aliases: [
        'bilibili.com',
        'watch.typetype.video',
        'typetype.video',
        'github.com',
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
      status: 'supported',
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
      status: 'supported',
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
      sourceId: 'greybox:greyboxtv.pages.dev',
      lastOutcome: 'healthy',
      recentSuccesses: 7,
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
