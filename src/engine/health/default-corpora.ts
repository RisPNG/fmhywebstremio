import type { FamilyHealthCorpus } from './corpus';

export const defaultFamilyHealthCorpora = new Map<string, FamilyHealthCorpus>([
  ['bcine', {
    familyId: 'bcine',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['cineby', {
    familyId: 'cineby',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'the-boys-s02e01', media: { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['cinetaro', {
    familyId: 'cinetaro',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['dooplay', {
    familyId: 'dooplay',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable', notes: 'Stable widely distributed movie used to verify title and year discovery.' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable', notes: 'Stable widely distributed episode used to verify season and episode discovery.' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent', notes: 'Synthetic impossible title used to detect search paths that return plausible matches for every query.' },
    ],
  }],
  ['cinego', {
    familyId: 'cinego',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['pstream', {
    familyId: 'pstream',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['sixty-seven-movies', {
    familyId: 'sixty-seven-movies',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
]);
