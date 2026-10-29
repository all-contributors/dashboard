// Collect install stats for the All Contributors GitHub App and append
// them to the CSV files in data/:
//
//   data/usage.csv         one row per run
//   data/top-accounts.csv  ten rows per run, one per ranked account
//
// Usage (needs the app's ID and private key):
//
//   APP_ID=... APP_PRIVATE_KEY="$(cat key.pem)" node scripts/collect-stats.mjs
//
// Pass --dry-run to print the results without writing the CSV files.
// Running twice on the same day replaces that day's rows.
//
// The counting logic is adapted from gr2m/app-stats-action
// (https://github.com/gr2m/app-stats-action), which is under this license:
//
//   ISC License
//
//   Copyright (c) 2020 Gregor Martynus
//
//   Permission to use, copy, modify, and/or distribute this software for any
//   purpose with or without fee is hereby granted, provided that the above
//   copyright notice and this permission notice appear in all copies.
//
//   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
//   WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
//   MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
//   ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
//   WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
//   ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
//   OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { App, Octokit } from "octokit";

// How many installations to fetch at once. The throttling plugin also
// caps concurrent requests, so raising this has limited effect.
const CONCURRENCY = 10;
const TOP_ACCOUNTS = 10;

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(rootDir, "data");
const dryRun = process.argv.includes("--dry-run");

const USAGE_HEADER = [
  "date", "run_id", "installations", "suspended_installations",
  "active_installations", "repositories",
];
const TOP_HEADER = ["date", "run_id", "rank", "installation_id", "login", "stars"];

// Retry on rate limits a few times instead of the default single retry,
// since a run makes thousands of requests.
const PatientOctokit = Octokit.defaults({
  throttle: {
    onRateLimit: (retryAfter, options, octokit) => {
      octokit.log.warn(`Rate limited on ${options.method} ${options.url}`);
      return options.request.retryCount < 3;
    },
    onSecondaryRateLimit: (retryAfter, options, octokit) => {
      octokit.log.warn(`Secondary rate limit on ${options.method} ${options.url}`);
      return options.request.retryCount < 3;
    },
  },
});

async function getAppStats({ appId, privateKey }) {
  const app = new App({ appId, privateKey, Octokit: PatientOctokit });

  const installations = await app.octokit.paginate(
    "GET /app/installations",
    { per_page: 100 },
    (response) =>
      response.data.map(({ id, account, suspended_at }) => ({
        id,
        login: account.login,
        suspended: Boolean(suspended_at),
      }))
  );

  const active = installations.filter((installation) => !installation.suspended);
  const accounts = [];
  let repositories = 0;
  let failed = 0;

  // Fetch one installation's repos. Some organizations block the request
  // with an IP allow list; those count as zero repos, as before.
  async function countInstallation(installation) {
    try {
      const octokit = await app.getInstallationOctokit(installation.id);
      const repos = await octokit.paginate(
        "GET /installation/repositories",
        { per_page: 100 },
        (response) => response.data
      );
      const stars = repos
        .filter((repo) => !repo.private)
        .reduce((sum, repo) => sum + repo.stargazers_count, 0);
      accounts.push({ id: installation.id, login: installation.login, stars });
      repositories += repos.length;
    } catch (error) {
      failed++;
      accounts.push({ id: installation.id, login: installation.login, stars: 0 });
      console.warn(`installation ${installation.id}: ${error.status ?? error.message}`);
    }
  }

  let next = 0;
  async function worker() {
    while (next < active.length) {
      await countInstallation(active[next++]);
      if (next % 500 === 0) console.log(`${next} / ${active.length} installations`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return {
    installations: installations.length,
    suspendedInstallations: installations.length - active.length,
    repositories,
    failed,
    topAccounts: accounts
      .sort((a, b) => b.stars - a.stars)
      .slice(0, TOP_ACCOUNTS),
  };
}

function csvValue(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Append rows to a CSV file, first dropping any rows for the same date.
function writeRows(file, header, date, rows) {
  const path = join(dataDir, file);
  const existing = existsSync(path)
    ? readFileSync(path, "utf8").trim().split("\n").slice(1)
    : [];
  const kept = existing.filter((line) => line && !line.startsWith(`${date},`));
  const lines = [header.join(","), ...kept, ...rows.map((row) => row.map(csvValue).join(","))];
  writeFileSync(path, lines.join("\n") + "\n");
}

const appId = process.env.APP_ID;
const privateKey = process.env.APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
if (!appId || !privateKey) {
  console.error("Set APP_ID and APP_PRIVATE_KEY to the app's ID and private key.");
  process.exit(1);
}

const started = Date.now();
const stats = await getAppStats({ appId, privateKey });
const date = new Date().toISOString().slice(0, 10);
const runId = process.env.GITHUB_RUN_ID ?? "local";
const minutes = ((Date.now() - started) / 60000).toFixed(1);

console.log(
  `${date}: ${stats.installations} installations ` +
    `(${stats.suspendedInstallations} suspended), ` +
    `${stats.repositories} repositories, ` +
    `${stats.failed} installations could not be read, ${minutes} min`
);

if (dryRun) {
  console.log("Top accounts:", stats.topAccounts);
} else {
  writeRows("usage.csv", USAGE_HEADER, date, [[
    date, runId, stats.installations, stats.suspendedInstallations,
    stats.installations - stats.suspendedInstallations, stats.repositories,
  ]]);
  writeRows("top-accounts.csv", TOP_HEADER, date, stats.topAccounts.map(
    (account, index) => [date, runId, index + 1, account.id, account.login, account.stars]
  ));
  console.log("Updated data/usage.csv and data/top-accounts.csv");
}
