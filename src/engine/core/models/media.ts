export interface MediaRequest {
  type: 'movie' | 'episode';
  imdbId?: string;
  tmdbId?: number;
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  preferredLanguages?: readonly string[];
}

export interface MediaIdentity extends MediaRequest {
  canonicalId: string;
  title: string;
}
