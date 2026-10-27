import type { FamilyHealthCorpus } from './corpus';

const kisahBawahTanahEpisodes = [
  { season: 1, episode: 1, title: 'The Mart' },
  { season: 1, episode: 2, title: 'Toyol Handler' },
  { season: 1, episode: 3, title: 'Who is Dalang?' },
  { season: 1, episode: 4, title: 'Insert' },
  { season: 1, episode: 5, title: 'Amok Salmah the Pontianak' },
  { season: 1, episode: 6, title: 'Holidays in the Swamp' },
  { season: 1, episode: 7, title: 'Where is Tok Mart?' },
  { season: 1, episode: 8, title: 'Air MaXXXwater' },
  { season: 1, episode: 9, title: 'Brain Farm' },
  { season: 1, episode: 10, title: 'Looking for Flowers' },
  { season: 1, episode: 11, title: 'Solomon the Wish-Giver' },
  { season: 1, episode: 12, title: 'Sacred Tomb' },
  { season: 1, episode: 13, title: 'Fog' },
  { season: 1, episode: 14, title: 'Graffiti' },
  { season: 1, episode: 15, title: 'RnR' },
  { season: 1, episode: 16, title: 'Vincent' },
  { season: 1, episode: 17, title: 'Attack of the Clones' },
  { season: 1, episode: 18, title: 'Hospital' },
  { season: 1, episode: 19, title: 'Dracu-LAH' },
  { season: 1, episode: 20, title: 'Chin Oil' },
  { season: 1, episode: 21, title: 'Back to School' },
  { season: 1, episode: 22, title: 'Amok Penanggal' },
  { season: 1, episode: 23, title: 'Yellow Car' },
  { season: 1, episode: 24, title: 'The Mega Fight' },
  { season: 1, episode: 25, title: 'Spirit Building Camp' },
  { season: 1, episode: 26, title: 'Seven Wells' },
];

export const defaultFamilyHealthCorpora = new Map<string, FamilyHealthCorpus>([
  ['cineruv', {
    familyId: 'cineruv',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 2147483647, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['flyflix', {
    familyId: 'flyflix',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 2147483647, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['cinefork', {
    familyId: 'cinefork',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 2147483647, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['bilibili', {
    familyId: 'bilibili',
    cases: [
      { id: 'kisah-bawah-tanah-s01e01', media: { canonicalId: 'tmdb:310817:1:1', type: 'episode', tmdbId: 310817, imdbId: 'tt33269221', title: 'Kisah Bawah Tanah', year: 2026, season: 1, episode: 1, episodes: kisahBawahTanahEpisodes }, expected: 'discoverable' },
      { id: 'kisah-bawah-tanah-s01e02', media: { canonicalId: 'tmdb:310817:1:2', type: 'episode', tmdbId: 310817, imdbId: 'tt33269221', title: 'Kisah Bawah Tanah', year: 2026, season: 1, episode: 2, episodes: kisahBawahTanahEpisodes }, expected: 'discoverable' },
      { id: 'kisah-bawah-tanah-s01e26', media: { canonicalId: 'tmdb:310817:1:26', type: 'episode', tmdbId: 310817, imdbId: 'tt33269221', title: 'Kisah Bawah Tanah', year: 2026, season: 1, episode: 26, episodes: kisahBawahTanahEpisodes }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'episode', tmdbId: 2147483647, title: 'FMHY Extractability Probe 7b18e49a', year: 1874, season: 1, episode: 1, episodes: [{ season: 1, episode: 1, title: 'FMHY Extractability Probe 7b18e49a' }] }, expected: 'absent' },
    ],
  }],
  ['kkphim', {
    familyId: 'kkphim',
    cases: [
      { id: 'lightyear-2022', media: { canonicalId: 'tmdb:718789', type: 'movie', tmdbId: 718789, imdbId: 'tt10298810', title: 'Lightyear', year: 2022 }, expected: 'discoverable' },
      { id: 'kisah-bawah-tanah-s01e01', media: { canonicalId: 'tmdb:310817:1:1', type: 'episode', tmdbId: 310817, imdbId: 'tt33269221', title: 'Kisah Bawah Tanah', year: 2026, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'kisah-bawah-tanah-s01e02', media: { canonicalId: 'tmdb:310817:1:2', type: 'episode', tmdbId: 310817, imdbId: 'tt33269221', title: 'Kisah Bawah Tanah', year: 2026, season: 1, episode: 2 }, expected: 'discoverable' },
      { id: 'kisah-bawah-tanah-s01e26', media: { canonicalId: 'tmdb:310817:1:26', type: 'episode', tmdbId: 310817, imdbId: 'tt33269221', title: 'Kisah Bawah Tanah', year: 2026, season: 1, episode: 26 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 2147483647, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['cinrift', {
    familyId: 'cinrift',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'the-boys-s02e01', media: { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['anicine', {
    familyId: 'anicine',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'the-boys-s02e01', media: { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 }, expected: 'discoverable' },
      { id: 'attack-on-titan-s01e01', media: { canonicalId: 'tmdb:1429:1:1', type: 'episode', tmdbId: 1429, imdbId: 'tt2560140', title: 'Attack on Titan', year: 2013, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'attack-on-titan-s02e01', media: { canonicalId: 'tmdb:1429:2:1', type: 'episode', tmdbId: 1429, imdbId: 'tt2560140', title: 'Attack on Titan', year: 2013, season: 2, episode: 1 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['arrowtv', {
    familyId: 'arrowtv',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['bingebang', {
    familyId: 'bingebang',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'the-boys-s02e01', media: { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 }, expected: 'discoverable' },
      { id: 'kahar-kapla-high-council-2024', media: { canonicalId: 'tmdb:1303517', type: 'movie', tmdbId: 1303517, imdbId: 'tt31242447', title: 'Kahar: Kapla High Council', year: 2024 }, expected: 'discoverable' },
      { id: 'kudrat-1968-high-council-s01e01', media: { canonicalId: 'tmdb:334097:1:1', type: 'episode', tmdbId: 334097, imdbId: 'tt35052365', title: 'Kudrat 1968: High Council', year: 2026, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'project-high-council-s01e01', media: { canonicalId: 'tmdb:218507:1:1', type: 'episode', tmdbId: 218507, imdbId: 'tt21841200', title: 'Project: High Council', year: 2023, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'project-high-council-s01e10', media: { canonicalId: 'tmdb:218507:1:10', type: 'episode', tmdbId: 218507, imdbId: 'tt21841200', title: 'Project: High Council', year: 2023, season: 1, episode: 10 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['greybox', {
    familyId: 'greybox',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'the-boys-s02e01', media: { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 }, expected: 'discoverable' },
      { id: 'kahar-kapla-high-council-2024', media: { canonicalId: 'tmdb:1303517', type: 'movie', tmdbId: 1303517, imdbId: 'tt31242447', title: 'Kahar: Kapla High Council', year: 2024 }, expected: 'discoverable' },
      { id: 'kudrat-1968-high-council-s01e01', media: { canonicalId: 'tmdb:334097:1:1', type: 'episode', tmdbId: 334097, imdbId: 'tt35052365', title: 'Kudrat 1968: High Council', year: 2026, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'kudrat-1968-high-council-s01e04', media: { canonicalId: 'tmdb:334097:1:4', type: 'episode', tmdbId: 334097, imdbId: 'tt35052365', title: 'Kudrat 1968: High Council', year: 2026, season: 1, episode: 4 }, expected: 'discoverable' },
      { id: 'project-high-council-s01e01', media: { canonicalId: 'tmdb:218507:1:1', type: 'episode', tmdbId: 218507, imdbId: 'tt21841200', title: 'Project: High Council', year: 2023, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 2147483647, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['soaper', {
    familyId: 'soaper',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'the-boys-s02e01', media: { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['cinemaos', {
    familyId: 'cinemaos',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'the-boys-s02e01', media: { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['tmdb-embed-catalog', {
    familyId: 'tmdb-embed-catalog',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
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
  ['milkbox', {
    familyId: 'milkbox',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['movienerds', {
    familyId: 'movienerds',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
  ['pressplayx', {
    familyId: 'pressplayx',
    cases: [
      { id: 'inception-2010', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'breaking-bad-s01e01', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'breaking-bad-s05e16', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, imdbId: 'tt0903747', title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'known-absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ],
  }],
]);
