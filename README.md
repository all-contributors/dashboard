# All-Contributors Metrics

This repository contains the metrics for the All-Contributors project.
Right now that means how widely the [All Contributors bot][app] is
installed. It holds the data files, the scripts that create them, and
(eventually) a small dashboard that charts them.

So far it has about three months of history, recovered from old
workflow logs. New data will be added by a scheduled workflow once it's
set up. See [what's next](#whats-next).

## The data

Both files live in [`data/`](data/). They're plain CSV, sorted oldest
first, so new rows can be appended to the end.

### `usage.csv`

One row per stats run.

| Column | What it means |
| --- | --- |
| `date` | Day the stats were collected (UTC) |
| `run_id` | The app repo workflow run the numbers came from |
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
| `run_id` | The app repo workflow run the numbers came from |
| `rank` | 1 to 10 |
| `installation_id` | The installation's ID (not the account's ID) |
| `login` | The user or organization name |
| `stars` | Total stars of the public repos the bot can access |

### A few things to know when reading the numbers

* **Stars only count repos the bot can see.** If an account installed
  the bot on three of its repos, only those three count, not
  everything the account owns. Private repos never add stars.
* **Repositories do include private repos.** So `repositories` and
  `stars` aren't measuring the same set.
* **Suspended installations are counted but not explored.** Their repos
  and stars aren't fetched.
* **Some installations show zero repos.** A handful of organizations
  use IP allow lists that block the stats requests. They're counted as
  installations, but add no repos or stars.
* **This measures reach, not use.** These numbers tell you how many
  places the bot is installed, not how often anyone calls it.

## Where the data comes from

In the `all-contributors/app` repo which houses the code for the All Contributors bot, the stats around all contributor bot installation (per account / org) and repos are collected using the  [`.github/workflows/stats.yml`][stats] in the app repo. The workflow depends on an action in the gr2m account that hasn't been updated in several years and also pushes the data to Logflare and that account token is no long valid and we do not have access to it. The workflow:

* It runs daily at midnight UTC, and can also be triggered by hand // workflow dispatch event.
* It uses [`gr2m/app-stats-action`][action], which logs in as the
  GitHub App and walks through every installation, one at a time,
  counting repos and stars.
* It prints the results to the workflow log, then tries to send them to
  Logflare.

There are a few problems with the current implementation:

* **The Logflare step fails** with a 401 error, so the job fails and
  nothing is saved outside the log. Every run on record since
  2025-09-04 has failed this way.
* **It's slow.** A run takes about 3.5 hours, because the action makes
  roughly 12,000 API requests one after another. Hosted runners stop
  jobs at 6 hours, so there isn't much headroom.
* **The action is out of date.** It was last updated in 2023, and
  GitHub is moving it to a newer Node version.

In short, the data print out in the logs but the data are not being saved anywhere so it's a waste of time and resources. Further, the workflow could be streamlined and made to run faster and more efficiently with a less frequent cadence - perhaps weekly running on sunday nights.

### Recovering history from the logs

Because the workflow printed its numbers before failing, we scraped the data from the Actions logs which has a history of 90 days using [`scripts/backfill-stats.mjs`](scripts/backfill-stats.mjs). This script was vibe-coded using claude code and not verified by lwasser by checking the data against the logs. this was a one time step but hte script is included here for reference and future use.

The script:

1. Lists every run of the stats workflow with the `gh` CLI.
2. Downloads each log that still exists. Older logs return
   `HTTP 410 Gone`, which means GitHub has already deleted them.
3. Picks the four values out of each log.
4. Writes `data/usage.csv` and `data/top-accounts.csv`.

That recovered **90 runs, from 2026-08-01 to 2026-10-29**. The other
331 runs on record had already expired. We checked a few rows by hand
against the logs, and they match.

To run it again you need Node and the [GitHub CLI][gh], logged in with
read access to `all-contributors/app`:

```sh
node scripts/backfill-stats.mjs
```

It saves a copy of each log in `raw-logs/`, and on later runs it reads
those copies instead of downloading again. That folder is gitignored,
because the error output in the logs names individual installations.

The raw data, because account information is included is not committed to this repository.

## What's next

Now that we have preliminary data we can rethink the gr2m account  action and workflow and improve the data collection and storage. We will

1. rewrite the action to use a newer Node version and run in parallel, so a runs more quickly and efficiently.
* Switch the stats workflow to run weekly. The totals change slowly.
* Drop the broken Logflare step and have the workflow append to the
  CSV files in this repo instead.
* Replace the action with our own script that fetches in parallel, so
  a run takes minutes instead of hours.
* Start tracking how often the bot is actually called, using the app's
  webhook delivery counts.
* Build a small js dashboard that reads the CSV files from this repo.

[app]: https://github.com/all-contributors/app
[stats]: https://github.com/all-contributors/app/blob/main/.github/workflows/stats.yml
[action]: https://github.com/gr2m/app-stats-action
[gh]: https://cli.github.com/
