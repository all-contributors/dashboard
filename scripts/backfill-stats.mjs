// One-time backfill of app stats from the Stats workflow's Actions logs.
//
// The Stats workflow has been failing at its Logflare step, so the counts
// only live in the Actions logs, which GitHub deletes after ~90 days. This
// script downloads every log that still exists, keeps a raw copy, and
// writes two CSV files:
//
//   data/usage.csv         one row per run
//   data/top-accounts.csv  ten rows per run, one per ranked account
//
// Usage (needs the `gh` CLI, logged in with read access to the app repo):
//
//   node scripts/backfill-stats.mjs
//
// Re-running is safe. Logs already saved in raw-logs/ are not
// downloaded again, so older data survives after GitHub expires it.

import {execFileSync} from 'node:child_process'
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const REPO = 'all-contributors/app'
const WORKFLOW = 'stats.yml'
const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(rootDir, 'data')
const logDir = join(rootDir, 'raw-logs')
mkdirSync(outDir, {recursive: true})
mkdirSync(logDir, {recursive: true})

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

// Fetch a run's log, using the saved copy when there is one.
// Returns null when GitHub has already expired the log (HTTP 410).
function getLog(runId) {
  const file = join(logDir, `${runId}.log`)
  if (existsSync(file)) return readFileSync(file, 'utf8')
  try {
    const log = gh(['run', 'view', String(runId), '--log', '-R', REPO])
    writeFileSync(file, log)
    return log
  } catch (error) {
    const message = String(error.stderr || error.message)
    if (message.includes('410')) return null
    throw error
  }
}

// Each log line is "job<TAB>step<TAB>timestamp text". Continuation lines
// (like the Logflare metadata JSON) have no timestamp.
const linePattern = /^[^\t]*\t[^\t]*\t(?:(\d{4}-\d{2}-\d{2})T\S+ )?(.*)$/
// biome-ignore lint/suspicious/noControlCharactersInRegex: matches ANSI color codes
const ansiPattern = /\x1b\[[0-9;]*m/g

function parseLog(log) {
  const result = {}
  for (const raw of log.split('\n')) {
    const match = raw.replace(ansiPattern, '').match(linePattern)
    if (!match) continue
    const [, date, text] = match

    let m
    // biome-ignore-start lint/suspicious/noAssignInExpressions: match-and-capture chain
    if ((m = text.match(/^installations: (\d+)$/))) {
      result.installations = Number(m[1])
      result.date = date
    } else if ((m = text.match(/^\s*message: stats: (\d+) \/ (\d+)$/))) {
      result.repositories = Number(m[2])
    } else if ((m = text.match(/"num_suspended_installations": (\d+)/))) {
      result.suspended = Number(m[1])
    } else if ((m = text.match(/^most popular repositories: (\[.*\])$/))) {
      result.top = JSON.parse(m[1])
    }
    // biome-ignore-end lint/suspicious/noAssignInExpressions: match-and-capture chain
  }
  return result
}

function csvValue(value) {
  if (value === undefined || value === null) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(header, rows) {
  const lines = [header.join(',')]
  for (const row of rows) lines.push(row.map(csvValue).join(','))
  return `${lines.join('\n')}\n`
}

const runs = JSON.parse(
  gh([
    'run',
    'list',
    '-R',
    REPO,
    '--workflow',
    WORKFLOW,
    '--limit',
    '1000',
    '--json',
    'databaseId,createdAt,status',
  ]),
).filter(run => run.status === 'completed')

console.log(`${runs.length} completed runs on record`)

const usageRows = []
const topRows = []
let expired = 0
let incomplete = 0

for (const run of runs) {
  const log = getLog(run.databaseId)
  if (log === null) {
    expired++
    continue
  }

  const stats = parseLog(log)
  if (stats.installations === undefined) {
    // The run stopped before the stats step finished (timeout, cancel).
    incomplete++
    console.warn(`run ${run.databaseId}: no stats in log`)
    continue
  }

  const date = stats.date || run.createdAt.slice(0, 10)
  const active =
    stats.suspended === undefined
      ? undefined
      : stats.installations - stats.suspended

  usageRows.push([
    date,
    run.databaseId,
    stats.installations,
    stats.suspended,
    active,
    stats.repositories,
  ])

  ;(stats.top || []).forEach((account, index) => {
    topRows.push([
      date,
      run.databaseId,
      index + 1,
      account.id,
      account.login,
      account.stars,
    ])
  })
}

// Oldest first, so new rows can simply be appended later.
const byDateThenRun = (a, b) =>
  a[0].localeCompare(b[0]) || a[1] - b[1] || (a[2] ?? 0) - (b[2] ?? 0)
usageRows.sort(byDateThenRun)
topRows.sort(byDateThenRun)

writeFileSync(
  join(outDir, 'usage.csv'),
  toCsv(
    [
      'date',
      'run_id',
      'installations',
      'suspended_installations',
      'active_installations',
      'repositories',
    ],
    usageRows,
  ),
)
writeFileSync(
  join(outDir, 'top-accounts.csv'),
  toCsv(
    ['date', 'run_id', 'rank', 'installation_id', 'login', 'stars'],
    topRows,
  ),
)

console.log(
  `wrote ${usageRows.length} usage rows and ${topRows.length} top-account ` +
    `rows (${expired} logs expired, ${incomplete} runs without stats)`,
)
