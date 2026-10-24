---
'@chronicle.app/apple-health': minor
'@chronicle.app/facebook': minor
'@chronicle.app/instagram': minor
'@chronicle.app/linkedin': minor
'@chronicle.app/slack': minor
'@chronicle.app/twitter': minor
'@chronicle.app/youtube': minor
---

Apple Health, Facebook, Instagram, LinkedIn, Slack, Twitter, and YouTube Takeout survey what their exports hold, so `chronicle survey` counts what they would extract, and when each record happened. The exports have no index, so a survey reads the export as a run does, keeping only counts and times. Messages say how many conversations they're in, and YouTube's watches how many videos. Twitter's likes have a count but no dates, since the archive doesn't say when you liked anything. A Slack run's progress total now follows `--since`, `--until`, and `--limit`.
