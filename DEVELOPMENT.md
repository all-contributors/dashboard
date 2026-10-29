# Development

This repository tracks how widely the All Contributors bot is installed on
GitHub. A scheduled workflow collects the numbers and saves them as CSV
files in `data/`. A dashboard in `website/` charts those files, built with
Observable.

There are two ways to work here:

* **[Work on the dashboard](#work-on-the-dashboard).** Anyone can do this.
  You don't need any keys or secrets, because the data is already in the
  repo and is updated every week.
* **[Update the data (maintainers only)](#update-the-data-maintainers-only).**
  Running the collection script needs the All Contributors app's
  credentials, which only maintainers have.

## Work on the dashboard

The dashboard is a static page located in the `website/` directory:

* `index.html` is the landing page and currently has a single plot on it
* `dashboard.js` loads the CSV files from `data/` and draws the charts

The data are updated weekly via a cron job (see below for more).

### What you need

* Node.js 22 or newer

### How to preview the dashboard locally

To view the website you need to start a local server. You can do this by running the following commands:

```sh
npm install
npm run dashboard
```

Then open http://localhost:3000/ in your browser.

### How to update the dashboard

1. To update the dashboard, first `website/index.html` or `website/dashboard.js`.
2. Check the result at <http://localhost:3000/>.
3. Open a pull request.

Don't edit the files in the `data/` directory by hand. The weekly workflow maintains
these files. The entire workflow takes about 30-40 minutes to run.

### What the data means

See the [README](README.md#the-data) for the columns in `usage.csv` and
`top-accounts.csv`, and for what the numbers do and don't measure.

### How the dashboard is published

The dashboard is published automatically to GitHub page using GitHub actions on every push to our
`main` branch. .

## Work on the data scripts (maintainers only)

[`scripts/collect-stats.mjs`](scripts/collect-stats.mjs) logs in as the All
Contributors GitHub App, and collects data about all of the installations across GitHub. It then updates two files: `data/usage.csv` and `data/top-accounts.csv`.

To run this script yourself, you need:

* The app's **App ID**
* A **private key** for the app

You also need Node.js 22 or newer.

### Get the App ID

1. Go to the app's settings page on GitHub. An admin of the
   `all-contributors` organization can reach it from the organization's
   Settings > Developer settings > GitHub Apps.
2. Find **App ID** in the "About" section at the top of the page.

The App ID is a number, for example `12345`. It isn't secret. Don't confuse
it with the Client ID, which is a string that starts with `Iv`.

### Get the private key

1. On the same settings page, scroll to the **Private keys** section.
2. Click **Generate a private key**. GitHub downloads a `.pem` file. This is
   the only time you can get it.
3. Move the file somewhere private, outside of the this repository. For example:

   ```sh
   mkdir -p ~/.secrets
   mv ~/Downloads/<downloaded-file>.pem ~/.secrets/all-contributors-app.pem
   chmod 600 ~/.secrets/all-contributors-app.pem
   ```

4. Delete your private key from the app's settings when you no longer need it.

The key is the full contents of the `.pem` file, including the
`-----BEGIN ... PRIVATE KEY-----` and `-----END ... PRIVATE KEY-----` lines.

The app can have several keys at once, and some belong to past
maintainers. Please reach our to the maintainer team before creating a new key
or deleting an old one.

### Run the collect-stats.mjs script locally

The collect-stats.mjs script  reads the App ID and private key from two environment variables:

| Variable | Value |
| --- | --- |
| `APP_ID` | The numeric App ID, such as `12345` |
| `APP_PRIVATE_KEY` | The full text of the `.pem` file |

Install the dependencies once:

```sh
npm install
```

Start with a quick test run. It fetches only 5 installations, prints each
step, and doesn't change any files. It finishes in seconds, so it's an easy
way to check that your App ID and private key work:

```sh
APP_ID=12345 APP_PRIVATE_KEY="$(cat ~/.secrets/all-contributors-app.pem)" \
  npm run collect:test
```

The totals from a test run are partial, so they won't match
`data/usage.csv`. That's expected.

Once the test run works, do the full run. It fetches every installation and
updates the CSV files:

```sh
APP_ID=12345 APP_PRIVATE_KEY="$(cat ~/.secrets/all-contributors-app.pem)" \
  npm run collect
```

### Things to know

* **It takes a while.** There are about 9,000 installations. Progress is
  printed to the terminal: every installation for a short `--limit` run,
  and every 100 installations for a full run.
* **Some installations can't be read.** The script lists their installation
  IDs (not account names) and counts them as zero repos, the same way the
  old action did. A handful is normal.
* **Check the numbers.** Compare the totals with the last row of
  `data/usage.csv`. Installations and repositories change slowly, so a big
  jump or drop means something went wrong.
* **Running twice in one day is safe.** The second run replaces that day's
  rows instead of adding duplicates.

### Repository secrets for the weekly workflow

The weekly workflow,
[`.github/workflows/collect_stats.yml`](.github/workflows/collect_stats.yml),
reads two repository secrets on `all-contributors/metrics`. Both must exist
before its first run:

| Secret | Value |
| --- | --- |
| `APP_ID` | The numeric App ID, such as `12345` |
| `APP_PRIVATE_KEY` | The full text of the `.pem` file |

Paste the whole `.pem` file, including the `BEGIN` and `END` lines. Real
line breaks are fine. A single line with `\n` in place of the breaks is
also fine, because the script turns those back into line breaks.

The workflow uses these two secrets and no others. Its schedule starts only
after the workflow file is on the default branch.

### Turn on GitHub Pages

Do this once, before the first deploy:

1. Open `all-contributors/metrics` on GitHub and go to Settings > Pages.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

The deploy workflow can also be started by hand from the Actions tab.

### Run the backfill again

[`scripts/backfill-stats.mjs`](scripts/backfill-stats.mjs) rebuilt the
early rows from old Actions logs. That was a one-time step, and the story
is in the [README](README.md). To run it again you need Node.js and the
[GitHub CLI][gh], logged in with read access to `all-contributors/app`:

```sh
node scripts/backfill-stats.mjs
```

It saves a copy of each log in `raw-logs/`, and on later runs it reads
those copies instead of downloading again. That folder is gitignored
because the logs include individual account information, so the raw data is
not committed to this repository.

[gh]: https://cli.github.com/
