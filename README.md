# All-Contributors metrics

Metrics for the All Contributors project. Right now that means how widely
the [All Contributors bot][app] is installed. This repo holds:

* The data files: `data/usage.csv` and `data/top-accounts.csv`
* [`scripts/collect-stats.mjs`](scripts/collect-stats.mjs), which counts
  installations, repositories and stars, and appends the results to the
  CSV files
* A one-time backfill script that recovered about three months of history
  from old workflow logs
* (Eventually) a small dashboard that charts the data

## Collect new data

`scripts/collect-stats.mjs` logs in as the All Contributors GitHub App,
walks through every installation (10 at a time), and adds one row to
`data/usage.csv` and ten rows to `data/top-accounts.csv`. Running it twice
on the same day replaces that day's rows rather than adding duplicates.

### What you need

* Node 22 or newer
* The app's **App ID**
* A **private key** for the app

### Get the App ID

1. Go to the app's settings page on GitHub. An admin of the
   `all-contributors` organization can reach it from the organization's
   Settings > Developer settings > GitHub Apps.
2. Find **App ID** in the "About" section at the top of the page.

The App ID is a number, for example `12345`. Don't confuse it with the
Client ID, which is a string that starts with `Iv`.

### Get the private key

1. On the same settings page, scroll to the **Private keys** section.
2. Click **Generate a private key**. GitHub downloads a `.pem` file.
3. Keep the file outside this repository. Delete the key from the app's
   settings when you no longer need it.

The key is the full contents of the `.pem` file, including the
`-----BEGIN ... PRIVATE KEY-----` and `-----END ... PRIVATE KEY-----`
lines.

### Input format

The script reads two environment variables:

| Variable | Format |
| --- | --- |
| `APP_ID` | The numeric App ID, such as `12345` |
| `APP_PRIVATE_KEY` | The full text of the `.pem` file |

The key can also be on a single line, with `\n` in place of line breaks
(as some secret stores save it). The script converts them back.

### Run it

Install the dependencies once:

```sh
npm install
```

Do a dry run first. It prints the totals and the top accounts but doesn't
change any files:

```sh
APP_ID=12345 APP_PRIVATE_KEY="$(cat ~/path/to/key.pem)" \
  node scripts/collect-stats.mjs --dry-run
```

When the numbers look right, run it again without `--dry-run` to update
the CSV files:

```sh
APP_ID=12345 APP_PRIVATE_KEY="$(cat ~/path/to/key.pem)" npm run collect
```

### Notes

* **It takes a while.** There are about 9,000 installations. The script
  prints progress every 500.
* **Some installations can't be read.** The script lists their
  installation IDs (not account names) and counts them as zero repos,
  the same way the old action did. A handful is normal.
* **Check the numbers.** Compare the totals with the last row of
  `data/usage.csv`. Installations and repositories change slowly, so a
  big jump or drop means something went wrong.

## The data

Both files live in [`data/`](data/). They're plain CSV, sorted oldest
first, so new rows can be appended to the end.

### `usage.csv`

One row per stats run.

| Column | What it means |
| --- | --- |
| `date` | Day the stats were collected (UTC) |
| `run_id` | The workflow run the numbers came from. See [reading the numbers](#reading-the-numbers) |
| `installations` | Accounts that installed the bot, suspended included |
| `suspended_installations` | Installations that are suspended |
| `active_installations` | `installations` minus `suspended_installations` |
| `repositories` | Repos across active installations, private included |

### `top-accounts.csv`

Ten rows per stats run: the ten accounts whose installations have the
most stars.

| Column | What it means |
| --- | --- |
| `date` | Day the stats were collected (UTC) |
| `run_id` | The workflow run the numbers came from. See [reading the numbers](#reading-the-numbers) |
| `rank` | 1 to 10 |
| `installation_id` | The installation's ID (not the account's ID) |
| `login` | The user or organization name |
| `stars` | Total stars of the public repos the bot can access |

### Reading the numbers

* **Stars only count repos the bot can see.** If an account installed
  the bot on three of its repos, only those three count, not everything
  the account owns. Private repos never add stars.
* **Repositories do include private repos.** So `repositories` and
  `stars` aren't measuring the same set.
* **Suspended installations are counted but not explored.** Their repos
  and stars aren't fetched.
* **Some installations show zero repos.** A handful of organizations use
  IP allow lists that block the stats requests. They're counted as
  installations, but add no repos or stars.
* **`run_id` points to different places over time.** Rows recovered from
  the old logs (2026-08-01 to 2026-10-29) are workflow runs in the
  `all-contributors/app` repo. Newer rows are runs in this repo, or
  `local` when someone ran the script by hand.
* **This measures reach, not use.** The numbers show how many places the
  bot is installed, not how often anyone calls it.

## What's next

The collection script is done. Next:

* Switch the stats workflow to run weekly (Sunday night). The totals
  change slowly.
* Drop the broken Logflare step and have the workflow append to the CSV
  files in this repo instead.
* Start tracking how often the bot is actually called, using the app's
  webhook delivery counts.
* Build a small JS dashboard that reads the CSV files from this repo.

## History and background

### The original stats workflow

Stats were collected by [`.github/workflows/stats.yml`][stats] in the
`all-contributors/app` repo. The workflow:

* Ran daily at midnight UTC, and could be triggered by hand
  (`workflow_dispatch`).
* Used [`gr2m/app-stats-action`][action], which logs in as the GitHub App
  and walks through every installation one at a time, counting repos and
  stars.
* Printed the results to the workflow log, then tried to send them to
  Logflare.

It had three problems:

* **The Logflare step failed with a 401 error.** The token belongs to an
  account we no longer have access to. Every run on record since
  2025-09-04 failed this way, so nothing was saved outside the log.
* **It was slow.** A run took about 3.5 hours, because the action made
  roughly 12,000 API requests one after another. Hosted runners stop jobs
  at 6 hours, so there wasn't much headroom.
* **The action is out of date.** It was last updated in 2023, and GitHub
  is moving it to a newer Node version.

In short, the numbers were printed to logs but never saved, which wasted
time and resources. `scripts/collect-stats.mjs` replaces the action, and
the workflow can now run less often.

### Recovering history from the logs

Because the workflow printed its numbers before failing, the data was
recovered from the Actions logs (GitHub keeps 90 days of them) using
[`scripts/backfill-stats.mjs`](scripts/backfill-stats.mjs). This was a
one-time step. The script is kept for reference and future use.

The script:

1. Lists every run of the stats workflow with the `gh` CLI.
2. Downloads each log that still exists. Older logs return
   `HTTP 410 Gone`, which means GitHub has already deleted them.
3. Picks the four values out of each log.
4. Writes `data/usage.csv` and `data/top-accounts.csv`.

That recovered **90 runs, from 2026-08-01 to 2026-10-29**. The other 331
runs on record had already expired.

The script was written with Claude Code. A few rows were checked by hand
against the logs and match, but the full output has not been verified.

To run it again you need Node and the [GitHub CLI][gh], logged in with
read access to `all-contributors/app`:

```sh
node scripts/backfill-stats.mjs
```

It saves a copy of each log in `raw-logs/`, and on later runs it reads
those copies instead of downloading again. That folder is gitignored
because the logs include individual account information, so the raw data
is not committed to this repository.

### Credits

The counting logic is adapted from [`gr2m/app-stats-action`][action] by
Gregor Martynus, under the ISC license. The license notice is at the top
of the script.

[app]: https://github.com/all-contributors/app
[stats]: https://github.com/all-contributors/app/blob/main/.github/workflows/stats.yml
[action]: https://github.com/gr2m/app-stats-action
[gh]: https://cli.github.com/
