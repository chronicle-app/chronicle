# @chronicle.app/google

Google sign-in for Chronicle's Google sources: Gmail (`chronicle extract gmail`) and Google Calendar (`chronicle extract google-calendar`). Chronicle ships no Google OAuth client. You make one in your own Google Cloud project, once, and `chronicle auth login google` walks you through it.

## Signing in

```sh
chronicle auth login google
```

The first time, this sets up your client in three steps:

1. **A Google Cloud project, with the Gmail and Calendar APIs on.** With [gcloud](https://cloud.google.com/sdk/docs/install) installed, Chronicle creates it for you. Without it, you create it in the browser and paste its ID.
2. **A consent screen**, made External and published. Published, your sign-in lasts; left in testing, Google signs you out after 7 days. Google doesn't review an app only you use, so it stays unverified, and the sign-in page says so. Click Continue (or Advanced, then Go to Chronicle).
3. **A Desktop app OAuth client.** The window Google shows after you create it has the client ID and secret. Copy each one into the terminal when it asks. (A path to the client's downloaded JSON file works in place of the ID.)

Then you sign in in the browser. The consent page lists each kind of access with its own box, so tick them all.

Each step is saved as it finishes, so you can stop and run the command again later. After that, `chronicle auth login google` goes straight to the sign-in.

### Several accounts

Run `chronicle auth login google` again and sign in with another account. One client works for all your accounts, personal or Workspace. Pick one for a run with `--account`:

```sh
chronicle extract google-calendar --account you@work.example
```

Without `--account`, a run uses the account that signed in last. `chronicle auth status google` lists them.

A Workspace admin can block apps their organization hasn't approved from Gmail and Drive. If sign-in says access is blocked, ask them to trust your client ID (Admin console, Security, API controls).

### More access

The first sign-in asks for Gmail and Calendar. `--add` asks for more, keeping what you have, and turns the API on in your project:

```sh
chronicle auth login google --add drive
```

### Without the walkthrough

- `--client-file <path>` signs in with a client you downloaded.
- `--client-id <id> --client-secret <secret>` signs in with a client you already have.
- `--setup` starts the walkthrough over, with a new project and client.

## What it keeps

- **The client and the setup's progress**: `google/setup.json` in Chronicle's config directory (`~/.config/chronicle`), readable only by you.
- **Tokens**, one entry per account: Chronicle's `credentials.json`, beside it.
- **gcloud's sign-in**: `google/gcloud`, a gcloud configuration of Chronicle's own (`CLOUDSDK_CONFIG`). Your usual gcloud accounts, project, and application default credentials stay as they were.

## For sources

A Google source imports this package, which registers the `google` provider. It reads through `GoogleApi`, with `googleAccountOptions` in its schema:

```ts
const api = new GoogleApi({ service: 'calendar', baseURL, account, accessToken });
await api.initialize();
for await (const item of api.pages('/users/me/calendarList')) …
```

`GoogleApi` turns Google's refusals into errors that say what to run. A missing scope says to run `chronicle auth login google --add <service>`, an API that's off in the project says the same (which turns it on), and a rejected token says to sign in again. Services, their scopes, and their APIs are listed in `GOOGLE_SERVICES`.

## Tests

The tests run setup against a fake gcloud and a temporary config directory, and Google's API against a server on 127.0.0.1. They never run gcloud or read the host's accounts or files.
