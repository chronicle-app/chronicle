---
'@chronicle.app/letterboxd': minor
'@chronicle.app/schema': minor
---

Add the Letterboxd plugin. It reads the Letterboxd data export: the films in your diary and your watched films, your ratings and reviews, your watchlist, and the films and reviews you liked. Pass `--film-pages` to fetch each film's page for its link and its IMDb and TMDB ids.

The schema adds `Movie`, and `ratingValue` and `bestRating` on a `Response`. An action can now have `tags`.
