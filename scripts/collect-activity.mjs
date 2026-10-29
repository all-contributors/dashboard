// Count pull requests opened by the All Contributors bot each week and
// write them to data/bot-prs-weekly.csv:
//
//   week_start,prs_opened
//   2019-01-07,1
//
// Weeks run Monday to Sunday (UTC). week_start is the Monday. Only
// finished weeks are recorded, so the last row is the week that ended
// most recently, never a partial week.
//
// Every bot request that succeeds ends in a pull request being opened or
// updated, so this is the closest public measure of how often people use
// the bot. It only sees public repos, and it misses requests that update
// a pull request that's already open.
//
// Usage (any GitHub token works; the search API only reads public data):
//
//   GITHUB_TOKEN="$(gh auth token)" node scripts/collect-activity.mjs
//
// By default only finished weeks missing from the file are fetched, since
// a finished week's count doesn't change. Pass --backfill to fetch every
// week since the bot's first pull request (January 2019); that takes
// about 17 minutes because search allows 30 requests a minute. Pass
// --dry-run to print the counts without writing the file.

import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Octokit} from 'octokit'

// The Monday of the week of the bot's first pull request (2019-01-13).
const FIRST_WEEK = '2019-01-07'
const QUERY = 'is:pr author:app/allcontributors'
// The search API allows 30 requests a minute.
const PAUSE_MS = 2500
const HEADER = ['week_start', 'prs_opened']
const DAY_MS = 24 * 60 * 60 * 1000

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const csvPath = join(rootDir, 'data', 'bot-prs-weekly.csv')
const dryRun = process.argv.includes('--dry-run')
const backfill = process.argv.includes('--backfill')

function log(step, message) {
  const clock = new Date().toISOString().slice(11, 19)
  process.stderr.write(`${clock} [${step}] ${message}\n`)
}

const isoDate = ms => new Date(ms).toISOString().slice(0, 10)

// Mondays as YYYY-MM-DD strings, from start through the last week that
// has ended (UTC). The current, unfinished week is left out.
function finishedWeeksFrom(start) {
  const now = Date.now()
  const weeks = []
  for (let t = Date.parse(start); t + 7 * DAY_MS <= now; t += 7 * DAY_MS) {
    weeks.push(isoDate(t))
  }
  return weeks
}

const token = process.env.GITHUB_TOKEN
if (!token) {
  console.error('Set GITHUB_TOKEN, for example GITHUB_TOKEN="$(gh auth token)"')
  process.exit(1)
}

const existing = new Map()
if (existsSync(csvPath)) {
  for (const line of readFileSync(csvPath, 'utf8')
    .trim()
    .split('\n')
    .slice(1)) {
    const [week, count] = line.split(',')
    if (week) existing.set(week, Number(count))
  }
}

const allWeeks = finishedWeeksFrom(FIRST_WEEK)
const toFetch = backfill
  ? allWeeks
  : allWeeks.filter(week => !existing.has(week))

const minutes = Math.ceil((toFetch.length * PAUSE_MS) / 60000)
log(
  'start',
  `fetching ${toFetch.length} weeks, about ${minutes} min` +
    (dryRun ? ' (dry run)' : ''),
)

const octokit = new Octokit({auth: token})
// Drop any unfinished week left in the file by an older version of this
// script.
const finished = new Set(allWeeks)
const counts = new Map([...existing].filter(([week]) => finished.has(week)))

function write() {
  const rows = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
  const lines = [HEADER.join(','), ...rows.map(row => row.join(','))]
  writeFileSync(csvPath, `${lines.join('\n')}\n`)
  return rows.length
}

for (const [index, week] of toFetch.entries()) {
  if (index > 0) await new Promise(resolve => setTimeout(resolve, PAUSE_MS))
  const end = isoDate(Date.parse(week) + 6 * DAY_MS)
  const q = `${QUERY} created:${week}..${end}`
  const {data} = await octokit.request('GET /search/issues', {q, per_page: 1})
  if (data.incomplete_results) {
    log(
      'search',
      `${week}: GitHub returned incomplete results, count may be low`,
    )
  }
  counts.set(week, data.total_count)
  log('search', `${week}: ${data.total_count}`)
  // Save as we go, so a long backfill that stops partway keeps its work.
  if (!dryRun && (index + 1) % 50 === 0) write()
}

if (dryRun) {
  log('done', 'dry run, file not written')
} else {
  log('done', `wrote ${write()} weeks to data/bot-prs-weekly.csv`)
}
