# Development

This is how you collect stats on your own machine, and how the weekly
workflow is set up. The history of the data is in
[README.md](README.md).

## What you need

* Node.js 22 or newer
* The app's App ID
* A private key for the app

## Get the App ID

1. Go to the app's settings page on GitHub. An admin of the
   `all-contributors` organization can reach it from the organization's
   Settings > Developer settings > GitHub Apps.
2. Find **App ID** in the "About" section at the top of the page.

The App ID is a number, for example `12345`. Don't confuse it with the
Client ID, which is a string that starts with `Iv`.

## Get the private key

1. On the same settings page, scroll to the **Private keys** section.
2. Click **Generate a private key**. GitHub downloads a `.pem` file.
3. Keep the file outside this repository. Delete the key from the app's
   settings when you no longer need it.

The key is the full contents of the `.pem` file, including the
`-----BEGIN ... PRIVATE KEY-----` and `-----END ... PRIVATE KEY-----`
lines.

## Repository secrets

The weekly workflow reads two repository secrets on
`all-contributors/metrics`. You need both of them before the first run.

| Secret | Value |
| --- | --- |
| `APP_ID` | The numeric App ID, such as `12345` |
| `APP_PRIVATE_KEY` | The full text of the `.pem` file |

`APP_PRIVATE_KEY` is that PEM file. Paste the whole file, including the
`BEGIN` and `END` lines. Real line breaks are fine. A single line with
`\n` in place of the breaks is also fine. The script turns those `\n`
sequences back into line breaks.

[`.github/workflows/collect_stats.yml`](.github/workflows/collect_stats.yml)
uses these two secrets and no others. The schedule starts only after
that workflow file is on the default branch.

## Run it locally

The script reads the same two names as environment variables.

Install the dependencies once:

```sh
npm install
```

Do a dry run first. It prints the totals and the top accounts but
doesn't change any files:

```sh
APP_ID=12345 APP_PRIVATE_KEY="$(cat ~/path/to/key.pem)" \
  node scripts/collect-stats.mjs --dry-run
```

When the numbers look right, run it again without `--dry-run` to update
the CSV files:

```sh
APP_ID=12345 APP_PRIVATE_KEY="$(cat ~/path/to/key.pem)" npm run collect
```

To check the file update without a full run, pass `--limit` with a
small number. This fetches that many installations, writes today's
rows, and prints each step as it goes. The counts are partial, so
restore the CSV files afterward if you do not want to keep that result:

```sh
APP_ID=12345 APP_PRIVATE_KEY="$(cat ~/path/to/key.pem)" \
  node scripts/collect-stats.mjs --limit 5
```

## Notes

* **It takes a while.** There are about 9,000 installations. Progress is
  printed to the terminal: every installation for a short `--limit` run,
  and every 100 installations for a full run.
* **Some installations can't be read.** The script lists their
  installation IDs (not account names) and counts them as zero repos,
  the same way the old action did. A handful is normal.
* **Check the numbers.** Compare the totals with the last row of
  `data/usage.csv`. Installations and repositories change slowly, so a
  big jump or drop means something went wrong.

## Run the backfill again

[`scripts/backfill-stats.mjs`](scripts/backfill-stats.mjs) rebuilt the
early rows from Actions logs. That was a one-time step. The story is in
the README.

To run it again you need Node.js and the [GitHub CLI][gh], logged in
with read access to `all-contributors/app`:

```sh
node scripts/backfill-stats.mjs
```

It saves a copy of each log in `raw-logs/`, and on later runs it reads
those copies instead of downloading again. That folder is gitignored
because the logs include individual account information, so the raw
data is not committed to this repository.

[gh]: https://cli.github.com/
