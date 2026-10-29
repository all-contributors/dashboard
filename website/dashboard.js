import * as Plot from 'https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm'
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm'

// usage.csv: one row per stats run, oldest first
const usage = await d3.csv('data/usage.csv', d3.autoType)

const formatDate = d3.utcFormat('%b %-d, %Y')
const formatCount = d3.format(',')

function installationsChart(data, width) {
  return Plot.plot({
    width,
    height: 360,
    marginLeft: 56,
    x: {type: 'utc', label: null},
    y: {grid: true, label: 'Active installations', tickFormat: '~s'},
    style: {color: 'var(--text-secondary)'},
    marks: [
      Plot.lineY(data, {
        x: 'date',
        y: 'active_installations',
        stroke: 'var(--series-1)',
        strokeWidth: 2,
        curve: 'linear',
      }),
      Plot.ruleX(data, Plot.pointerX({x: 'date', stroke: 'var(--grid)'})),
      Plot.dot(
        data,
        Plot.pointerX({
          x: 'date',
          y: 'active_installations',
          r: 4,
          fill: 'var(--series-1)',
          stroke: 'var(--surface-1)',
          strokeWidth: 2,
        }),
      ),
      Plot.tip(
        data,
        Plot.pointerX({
          x: 'date',
          y: 'active_installations',
          title: d =>
            `${formatDate(d.date)}\n${formatCount(d.active_installations)} active installations`,
        }),
      ),
    ],
  })
}

// Redraw only when the width changes, so the chart fits the page
const figure = document.getElementById('installations-chart')
let renderedWidth
new ResizeObserver(() => {
  if (figure.clientWidth === renderedWidth) return
  renderedWidth = figure.clientWidth
  figure.replaceChildren(installationsChart(usage, renderedWidth))
}).observe(figure)

document.querySelector('#installations-table tbody').append(
  ...usage.toReversed().map(d => {
    const row = document.createElement('tr')
    row.innerHTML = `<td>${formatDate(d.date)}</td><td>${formatCount(d.active_installations)}</td>`
    return row
  }),
)

// bot-prs-weekly.csv: one row per week (Monday start), oldest first.
// Only finished weeks are recorded. Weeks are summed into the month they
// start in, so the newest month is partial until a week starts in the next.
const weekly = await d3.csv('data/bot-prs-weekly.csv', d3.autoType)
const monthly = d3
  .rollups(
    weekly,
    weeks => d3.sum(weeks, d => d.prs_opened),
    d => d3.utcMonth.floor(d.week_start),
  )
  .map(([month, prs]) => ({month, prs}))
  .sort((a, b) => a.month - b.month)
const lastWeek = weekly.at(-1)?.week_start
const nextWeekMonth =
  lastWeek && d3.utcMonth.floor(d3.utcDay.offset(lastWeek, 7))
const partialMonth = monthly.find(
  d => d.month.getTime() === nextWeekMonth?.getTime(),
)?.month

const formatMonth = d3.utcFormat('%B %Y')

function prsChart(data, width) {
  const isPartial = d => d.month === partialMonth
  return Plot.plot({
    width,
    height: 360,
    marginLeft: 56,
    x: {type: 'utc', label: null},
    y: {grid: true, label: 'Pull requests per month', tickFormat: '~s'},
    style: {color: 'var(--text-secondary)'},
    marks: [
      Plot.rectY(data, {
        x: 'month',
        y: 'prs',
        interval: 'month',
        fill: 'var(--series-1)',
        fillOpacity: d => (isPartial(d) ? 0.45 : 1),
        // 1px each side leaves a 2px gap between bars
        insetLeft: 1,
        insetRight: 1,
        ry2: 4,
      }),
      Plot.ruleY([0], {stroke: 'var(--grid)'}),
      Plot.tip(
        data,
        Plot.pointerX({
          x: d => d3.utcDay.offset(d.month, 15),
          y: 'prs',
          title: d =>
            `${formatMonth(d.month)}${isPartial(d) ? ' (so far)' : ''}\n` +
            `${formatCount(d.prs)} pull requests opened`,
        }),
      ),
    ],
  })
}

const prsFigure = document.getElementById('prs-chart')
let prsRenderedWidth
new ResizeObserver(() => {
  if (prsFigure.clientWidth === prsRenderedWidth) return
  prsRenderedWidth = prsFigure.clientWidth
  prsFigure.replaceChildren(prsChart(monthly, prsRenderedWidth))
}).observe(prsFigure)

document.querySelector('#prs-table tbody').append(
  ...monthly.toReversed().map(d => {
    const row = document.createElement('tr')
    row.innerHTML = `<td>${formatMonth(d.month)}${d.month === partialMonth ? ' (so far)' : ''}</td><td>${formatCount(d.prs)}</td>`
    return row
  }),
)
