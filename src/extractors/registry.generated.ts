import type { ExtractorMetadata } from '../engine/registry/types';
import EmbedPageExtractor from './generic/embed-page-extractor';
import MediaExtractor from './generic/media-extractor';
import GxPlayerHostExtractor from './hosts/gxplayer-host-extractor';

export const extractorRegistry = [
  {
    id: 'gxplayer',
    kind: 'host',
    matchers: [{ id: 'gxplayer-page', protocols: ['http', 'https'], hostname: 'gxplayer.xyz', path: '^/', priority: 20, positive: ['https://watch.gxplayer.xyz/watch?v=fixture'], negative: ['https://example.com/watch/1'] }],
    load: async () => ({ default: GxPlayerHostExtractor }),
  },
  {
    id: 'generic-media',
    kind: 'generic',
    matchers: [{ id: 'media-url', protocols: ['http', 'https'], path: '\\.(?:m3u8|mpd|mp4|webm)$', priority: 10, positive: ['https://cdn.example/master.m3u8'], negative: ['https://example.com/watch/1'] }],
    load: async () => ({ default: MediaExtractor }),
  },
  {
    id: 'generic-embed-page',
    kind: 'generic',
    matchers: [{ id: 'html-page', protocols: ['http', 'https'], path: '^/', priority: 1, positive: ['https://example.com/watch/1'], negative: ['synthetic://fixture/watch/1'] }],
    load: async () => ({ default: EmbedPageExtractor }),
  },
] as const satisfies readonly ExtractorMetadata[];
