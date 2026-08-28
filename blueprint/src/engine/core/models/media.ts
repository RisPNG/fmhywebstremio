export interface MediaIdentity {
  canonicalId: string;
  type: "movie" | "episode";
  imdbId?: string;
  tmdbId?: number;
  title: string;
  year?: number;
  season?: number;
  episode?: number;
}
