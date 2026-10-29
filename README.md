# All-Contributors Dashboard

Welcome to the dashboard repo for the All Contributors project. This repo stores
the [All Contributors bot // app's][app] usage data across GitHub.

## how to run the dashboard locally

To run the dashboard locally, you need to:

1. Clone the repository
2. Install the dependencies
3. Run the dashboard
4. npm run dev

## Repo structure

The structure of the repo includes:
* The data files: `data/usage.csv`, `data/top-accounts.csv`, and
  `data/bot-prs-weekly.csv`. See [the data](#the-data) for what's in each
* [`scripts/collect-stats.mjs`](scripts/collect-stats.mjs), which counts
  installations, repositories and stars, and appends the results to the
  CSV files
* [`scripts/collect-activity.mjs`](scripts/collect-activity.mjs), which
  counts the pull requests the bot opens each week
* A one-time backfill script that recovered about three months of history that collects the number of installations, repositories and stars associated with those installations from the `stats.yml` workflow. That workflow (as of october 29 2026) is running in the app reposioty daily and takes 3-4 hours to complete. it also is failing when it tries to transfer the data to LogFlare due to a token issue (and we do not have access to it). So instead this workflow repo and dashboard will replace the dated and slow stats.yml workflow in the app repo.
* A static dashboard in [`website/`](website/), published by the
  [deploy workflow](.github/workflows/deploy_dashboard.yml)

Local setup is in [DEVELOPMENT.md](DEVELOPMENT.md).

## Collect new data

[`.github/workflows/collect_stats.yml`](.github/workflows/collect_stats.yml)
runs at 1:00am Monday, Mountain time. During daylight saving time that
is 2:00am. It logs in as the All Contributors GitHub App, counts
installations, repositories, and stars, then commits the CSV files on
the default branch. A second run on the same UTC day replaces that
day's rows.

A second workflow,
[`.github/workflows/collect_activity.yml`](.github/workflows/collect_activity.yml),
runs at 1:00am Saturday, Mountain time (2:00am during daylight saving
time). It counts the pull requests the bot opened and commits
`data/bot-prs-weekly.csv`. It only needs the workflow's built-in token,
so it finishes in a minute or two.

You can also start either workflow by hand using the workflow dispatch
event from the Actions tab.

## View the dashboard

The chart is published to GitHub Pages from `main`:

<https://all-contributors.github.io/dashboard/>

The [deploy workflow](.github/workflows/deploy_dashboard.yml) runs
when the page or the CSV files change, and you can start it by hand
from the Actions tab. The first run needs Pages set to **GitHub
Actions** under Settings > Pages. A weekly stats commit on `main`
publishes the new numbers. Local viewing is in
[DEVELOPMENT.md](DEVELOPMENT.md).

## The data

All three files live in [`data/`](data/). They're plain CSV, sorted
oldest first, so new rows can be appended to the end.

| File | What it tracks | How often | Written by |
| --- | --- | --- | --- |
| `usage.csv` | Installations and repositories | Weekly | `collect-stats.mjs` |
| `top-accounts.csv` | The ten accounts with the most stars | Weekly | `collect-stats.mjs` |
| `bot-prs-weekly.csv` | Pull requests the bot opened | Weekly | `collect-activity.mjs` |

The first two show the bot's reach: where it's installed. The third
shows how often people actually use it.

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

### `bot-prs-weekly.csv`

One row per week, from the bot's first pull request in January 2019 to
now. Each count comes from a GitHub search for
`is:pr author:app/allcontributors` limited to that week.

| Column | What it means |
| --- | --- |
| `week_start` | The Monday the week starts on (UTC). Weeks run Monday to Sunday |
| `prs_opened` | Pull requests the bot opened that week, in public repos |

The dashboard groups these weeks into months, by the month each week
starts in.

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
* **`usage.csv` measures reach, not use.** The numbers show how many
  places the bot is installed, not how often anyone calls it. Use
  `bot-prs-weekly.csv` for that.
* **Pull request counts are a close measure of use, not an exact one.**
  When someone asks the bot to add a contributor, it opens a pull
  request, or updates one that's already open. Updates aren't counted,
  and neither are private repos.
* **The last week is partial.** The newest row in `bot-prs-weekly.csv`
  is the current week, so its count grows until the week ends. Each run
  fetches the last two weeks again to fill them in.

## What's next

The weekly collection workflow is in place. Next:

* Turn off `.github/workflows/stats.yml` in `all-contributors/app`
  once a weekly run here looks right.
* Get a fuller picture of use, including private repos, from the app's
  webhook delivery counts.

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

The data were printed to logs but never saved, which wasted
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
How to run it again is in [DEVELOPMENT.md](DEVELOPMENT.md).

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
