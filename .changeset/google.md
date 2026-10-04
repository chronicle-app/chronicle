---
'@chronicle.app/google': minor
'@chronicle.app/google-calendar': minor
'@chronicle.app/schema': minor
---

Google sources sign in with `chronicle auth login google`, using an OAuth client you make in your own Google Cloud project. The first sign-in walks you through it: gcloud (in a configuration of Chronicle's own) creates the project and turns the APIs on, the Cloud console pages for the consent screen and the client open one at a time, and you paste in the client's ID and secret. Each account you sign in with is kept apart; `--account` picks one, and `--add drive` asks for more access. A Google Calendar plugin reads your calendars' events, newest first, as `PlanAction`s on `Event`s, with their guests as `attendee`s keyed by email address as the mail plugins key people, and descriptions converted from HTML to Markdown. The vocabulary adds `attendee`.
