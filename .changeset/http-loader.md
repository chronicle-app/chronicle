---
'@chronicle.app/etl': minor
'@chronicle.app/cli': minor
---

`HttpLoader` sends each record as JSON to an endpoint, by `POST` unless `method` says otherwise, with `token` as a bearer token when one is given. A response that isn't OK fails the record. In the CLI, `--loader http --endpoint <url>` uses it, with `--method` and `--token`.
