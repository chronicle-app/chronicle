---
'@chronicle.app/youtube': minor
'@chronicle.app/google': minor
---

YouTube signs in with the Google sign-in Gmail and Google Calendar use, instead of a sign-in and OAuth client of its own. Run `chronicle auth login google --add youtube` to add it, which turns the YouTube Data API on in your Google Cloud project. A YouTube sign-in made before is no longer read. A YouTube run takes `--account` to pick one of several Google accounts, and Google's refusals say what to run, as Gmail's do.
