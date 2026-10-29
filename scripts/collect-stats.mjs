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
// Pass --limit 5 to fetch only that many installations, so you can check
// the run and the CSV update without waiting for every account. A limited
// run still replaces today's rows, and the counts are partial.
// Running twice on the same day replaces that day's rows.
// Progress is printed to stderr, so it stays visible if you pipe stdout.
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

import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {App, Octokit} from 'octokit'

// How many installations to fetch at once. The throttling plugin also
// caps concurrent requests, so raising this has limited effect.
const CONCURRENCY = 10
const TOP_ACCOUNTS = 10

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = join(rootDir, 'data')
const dryRun = process.argv.includes('--dry-run')

function parseLimit(argv) {
  const index = argv.indexOf('--limit')
  if (index === -1) return undefined
  const value = Number(argv[index + 1])
  if (!Number.isInteger(value) || value < 1) {
    console.error('--limit needs a positive integer, for example --limit 5')
    process.exit(1)
  }
  return value
}

const limit = parseLimit(process.argv)

// stderr stays visible when stdout is piped, and flushes a line at a time.
function log(step, message) {
  const clock = new Date().toISOString().slice(11, 19)
  process.stderr.write(`${clock} [${step}] ${message}\n`)
}

function formatSpan(minutes) {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))}s`
  return `${Math.round(minutes)} min`
}

const USAGE_HEADER = [
  'date',
  'run_id',
  'installations',
  'suspended_installations',
  'active_installations',
  'repositories',
]
const TOP_HEADER = [
  'date',
  'run_id',
  'rank',
  'installation_id',
  'login',
  'stars',
]

// Retry on rate limits a few times instead of the default single retry,
// since a run makes thousands of requests.
const PatientOctokit = Octokit.defaults({
  throttle: {
    onRateLimit: (_retryAfter, options, octokit) => {
      octokit.log.warn(`Rate limited on ${options.method} ${options.url}`)
      return options.request.retryCount < 3
    },
    onSecondaryRateLimit: (_retryAfter, options, octokit) => {
      octokit.log.warn(
        `Secondary rate limit on ${options.method} ${options.url}`,
      )
      return options.request.retryCount < 3
    },
  },
})

async function getAppStats({appId, privateKey, limit}) {
  const app = new App({appId, privateKey, Octokit: PatientOctokit})

  log(
    'list',
    limit === undefined
      ? 'fetching installations'
      : `fetching ${limit} installations`,
  )

  const listStarted = Date.now()
  let seen = 0
  let page = 0
  const installations = await app.octokit.paginate(
    'GET /app/installations',
    {per_page: limit === undefined ? 100 : Math.min(100, limit)},
    (response, done) => {
      const batch = response.data.map(({id, account, suspended_at}) => ({
        id,
        login: account.login,
        suspended: Boolean(suspended_at),
      }))
      page++
      const room = limit === undefined ? batch.length : limit - seen
      const kept = batch.slice(0, Math.max(0, room))
      seen += kept.length
      log('list', `page ${page}, ${seen} installations`)
      if (limit !== undefined && seen >= limit) done()
      return kept
    },
  )

  const active = installations.filter(installation => !installation.suspended)
  log(
    'list',
    `${installations.length} installations ` +
      `(${installations.length - active.length} suspended) ` +
      `in ${((Date.now() - listStarted) / 1000).toFixed(1)}s`,
  )

  const accounts = []
  let repositories = 0
  let failed = 0
  let doneCount = 0
  let sampled = false
  const countStarted = Date.now()
  // A short test logs every installation. A full run logs every 100.
  const every = active.length <= 20 ? 1 : 100

  if (active.length > 0) {
    log('count', `reading repositories for ${active.length} installations`)
  }

  // Fetch one installation's repos. Some organizations block the request
  // with an IP allow list; those count as zero repos, as before.
  async function countInstallation(installation) {
    const sample = !sampled
    if (sample) sampled = true
    const t0 = sample ? Date.now() : 0
    try {
      const octokit = await app.getInstallationOctokit(installation.id)
      const repos = await octokit.paginate(
        'GET /installation/repositories',
        {per_page: 100},
        response => response.data,
      )
      const stars = repos
        .filter(repo => !repo.private)
        .reduce((sum, repo) => sum + repo.stargazers_count, 0)
      accounts.push({id: installation.id, login: installation.login, stars})
      repositories += repos.length
    } catch (error) {
      failed++
      accounts.push({id: installation.id, login: installation.login, stars: 0})
      log(
        'count',
        `installation ${installation.id}: ${error.status ?? error.message}`,
      )
    }

    doneCount++
    if (sample) {
      const sec = (Date.now() - t0) / 1000
      const workers = Math.min(CONCURRENCY, active.length)
      const etaMin = (sec * active.length) / workers / 60
      log(
        'count',
        `first installation took ${sec.toFixed(1)}s; ` +
          `about ${formatSpan(etaMin)} for ${active.length} ` +
          `at concurrency ${workers}`,
      )
    }
    if (doneCount % every === 0 || doneCount === active.length) {
      const elapsedSec = Math.max((Date.now() - countStarted) / 1000, 0.001)
      const leftMin =
        (active.length - doneCount) / (doneCount / elapsedSec) / 60
      const left =
        doneCount === active.length ? '' : ` (${formatSpan(leftMin)} left)`
      log('count', `${doneCount} / ${active.length}${left}`)
    }
  }

  let next = 0
  async function worker() {
    while (next < active.length) {
      await countInstallation(active[next++])
    }
  }
  await Promise.all(
    Array.from({length: Math.min(CONCURRENCY, active.length)}, worker),
  )

  return {
    installations: installations.length,
    suspendedInstallations: installations.length - active.length,
    repositories,
    failed,
    topAccounts: accounts
      .sort((a, b) => b.stars - a.stars)
      .slice(0, TOP_ACCOUNTS),
  }
}

function csvValue(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// Append rows to a CSV file, first dropping any rows for the same date.
function writeRows(file, header, date, rows) {
  const path = join(dataDir, file)
  const existing = existsSync(path)
    ? readFileSync(path, 'utf8').trim().split('\n').slice(1)
    : []
  const kept = existing.filter(line => line && !line.startsWith(`${date},`))
  const lines = [
    header.join(','),
    ...kept,
    ...rows.map(row => row.map(csvValue).join(',')),
  ]
  writeFileSync(path, `${lines.join('\n')}\n`)
}

const appId = process.env.APP_ID
const privateKey = process.env.APP_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!appId || !privateKey) {
  console.error(
    "Set APP_ID and APP_PRIVATE_KEY to the app's ID and private key.",
  )
  process.exit(1)
}

log(
  'start',
  dryRun
    ? `dry run${limit === undefined ? '' : `, limit ${limit}`}`
    : `collect${limit === undefined ? '' : `, limit ${limit}`}`,
)

const started = Date.now()
const stats = await getAppStats({appId, privateKey, limit})
const date = new Date().toISOString().slice(0, 10)
const runId = process.env.GITHUB_RUN_ID ?? 'local'
const minutes = ((Date.now() - started) / 60000).toFixed(1)

console.log(
  `${date}: ${stats.installations} installations ` +
    `(${stats.suspendedInstallations} suspended), ` +
    `${stats.repositories} repositories, ` +
    `${stats.failed} installations could not be read, ${minutes} min`,
)

if (dryRun) {
  log('done', 'dry run, files not written')
  console.log('Top accounts:', stats.topAccounts)
} else {
  if (limit !== undefined) {
    log(
      'write',
      `partial counts for ${limit} installations; replacing today's rows`,
    )
  }
  log('write', 'updating data/usage.csv and data/top-accounts.csv')
  writeRows('usage.csv', USAGE_HEADER, date, [
    [
      date,
      runId,
      stats.installations,
      stats.suspendedInstallations,
      stats.installations - stats.suspendedInstallations,
      stats.repositories,
    ],
  ])
  writeRows(
    'top-accounts.csv',
    TOP_HEADER,
    date,
    stats.topAccounts.map((account, index) => [
      date,
      runId,
      index + 1,
      account.id,
      account.login,
      account.stars,
    ]),
  )
  log('done', 'updated data/usage.csv and data/top-accounts.csv')
}
