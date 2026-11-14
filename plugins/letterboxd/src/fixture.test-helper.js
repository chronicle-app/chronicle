import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** When the export says it was made, in the name Letterboxd gives its folder. */
export const EXPORTED_AT = '2026-03-01T10:30:00.000Z';
const FOLDER = 'letterboxd-pat-2026-03-01-10-30-utc';

// A synthetic export: the real files and header rows, with a made-up member
// and made-up films. Two films share the name Night Shift and the year 1994,
// so the diary entry for one of them doesn't say which.
export const FILES = {
  'profile.csv': `Date Joined,Username,Given Name,Family Name,Email Address,Location,Website,Bio,Pronoun,Favorite Films
2020-01-01,pat,Pat,Example,,,,,,
`,
  'watched.csv': `Date,Name,Year,Letterboxd URI
2025-01-05,The Lighthouse Hours,2019,https://boxd.it/aB1
2024-12-01,Paper Moons,2001,https://boxd.it/cD2
2025-02-10,Night Shift,1994,https://boxd.it/eF3
2025-02-10,Night Shift,1994,https://boxd.it/gH4
`,
  'diary.csv': `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2025-01-05,The Lighthouse Hours,2019,https://boxd.it/k1AAAA,4,,"cinema, 35mm",2025-01-04
2025-06-02,The Lighthouse Hours,2019,https://boxd.it/k2BBBB,4.5,Yes,,2025-06-01
2025-02-10,Night Shift,1994,https://boxd.it/k3CCCC,,,,2025-02-09
`,
  'reviews.csv': `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date
2025-06-02,The Lighthouse Hours,2019,https://boxd.it/k2BBBB,4.5,Yes,"Better the second time, somehow.",,2025-06-01
`,
  'ratings.csv': `Date,Name,Year,Letterboxd URI,Rating
2025-06-02,The Lighthouse Hours,2019,https://boxd.it/aB1,4.5
`,
  'watchlist.csv': `Date,Name,Year,Letterboxd URI
2025-03-03,Salt Road,2022,https://boxd.it/iJ5
`,
  'comments.csv': `Date,Content,Comment
`,
  'likes/films.csv': `Date,Name,Year,Letterboxd URI
2025-01-05,The Lighthouse Hours,2019,https://boxd.it/aB1
`,
  'likes/reviews.csv': `Date,Content
2025-04-04,https://boxd.it/m9ZZZZ
`,
};

/** Write the export under `dir`, in a folder named as Letterboxd names it. Returns the folder. */
export function writeLetterboxdExport(dir, files = FILES) {
  const root = join(dir, FOLDER);
  for (const [name, text] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

const filmPage = (code, imdb, tmdb) =>
  `<html><a href="https://boxd.it/${code}">share</a><a href="http://www.imdb.com/title/${imdb}/maindetails">IMDb</a><a href="https://www.themoviedb.org/${tmdb}/">TMDB</a></html>`;

// What Letterboxd answers for the links the tests follow: where each ends up,
// and the page there. Anything else is a 404.
const PAGES = {
  'https://boxd.it/aB1': {
    url: 'https://letterboxd.com/film/the-lighthouse-hours/',
    html: filmPage('aB1', 'tt0000001', 'movie/101'),
  },
  'https://boxd.it/k3CCCC': {
    url: 'https://letterboxd.com/pat/film/night-shift-1994/',
    html: '<html></html>',
  },
  'https://letterboxd.com/film/night-shift-1994/': {
    url: 'https://letterboxd.com/film/night-shift-1994/',
    html: filmPage('gH4', 'tt0000002', 'tv/202'),
  },
};

/** Stand in for `fetch` for one test, answering from PAGES. Returns the links asked for. */
export function stubLetterboxd(t) {
  const asked = [];
  t.mock.method(globalThis, 'fetch', async url => {
    asked.push(String(url));
    const page = PAGES[String(url)];
    if (!page) return { ok: false, status: 404, url: String(url), text: async () => '' };
    return { ok: true, status: 200, url: page.url, text: async () => page.html };
  });
  return asked;
}
