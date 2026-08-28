export type StreamProtocol = 'hls' | 'dash' | 'http' | 'unknown';
export type StreamValidationState = 'validated' | 'unverified' | 'failed';

export interface SubtitleTrack {
  url: URL;
  language?: string;
  label?: string;
  format?: string;
}

export interface StreamCandidate {
  url: URL;
  protocol: StreamProtocol;
  headers?: Readonly<Record<string, string>>;
  referrer?: URL;
  language?: string;
  label?: string;
  sourceId: string;
  sourceExtractor: string;
  hostExtractor?: string;
  providerContentId?: string;
  declaredResolution?: { width: number; height: number };
  discoveredAt: Date;
}

export interface NormalizedStream {
  url: URL;
  protocol: Exclude<StreamProtocol, 'unknown'>;
  validation: StreamValidationState;
  resolution?: { width: number; height: number };
  bitrate?: number;
  videoCodec?: string;
  audioCodec?: string;
  language?: string;
  audioLanguages?: readonly string[];
  subtitles?: readonly SubtitleTrack[];
  isLive?: boolean;
  headers?: Readonly<Record<string, string>>;
  sourceId: string;
  sourceExtractor: string;
  hostExtractor?: string;
  providerContentId?: string;
  structuralFingerprint?: string;
}
