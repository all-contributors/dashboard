import * as Plot from "https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// usage.csv: one row per stats run, oldest first
const usage = await d3.csv("data/usage.csv", d3.autoType);

const formatDate = d3.utcFormat("%b %-d, %Y");
const formatCount = d3.format(",");

function installationsChart(data, width) {
  return Plot.plot({
    width,
    height: 360,
    marginLeft: 56,
    x: { type: "utc", label: null },
    y: { grid: true, label: "Active installations", tickFormat: "~s" },
    style: { color: "var(--text-secondary)" },
    marks: [
      Plot.lineY(data, {
        x: "date",
        y: "active_installations",
        stroke: "var(--series-1)",
        strokeWidth: 2,
        curve: "linear",
      }),
      Plot.ruleX(data, Plot.pointerX({ x: "date", stroke: "var(--grid)" })),
      Plot.dot(data, Plot.pointerX({
        x: "date",
        y: "active_installations",
        r: 4,
        fill: "var(--series-1)",
        stroke: "var(--surface-1)",
        strokeWidth: 2,
      })),
      Plot.tip(data, Plot.pointerX({
        x: "date",
        y: "active_installations",
        title: (d) => `${formatDate(d.date)}\n${formatCount(d.active_installations)} active installations`,
      })),
    ],
  });
}

// Redraw only when the width changes, so the chart fits the page
const figure = document.getElementById("installations-chart");
let renderedWidth;
new ResizeObserver(() => {
  if (figure.clientWidth === renderedWidth) return;
  renderedWidth = figure.clientWidth;
  figure.replaceChildren(installationsChart(usage, renderedWidth));
}).observe(figure);

document.querySelector("#installations-table tbody").append(
  ...usage.toReversed().map((d) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${formatDate(d.date)}</td><td>${formatCount(d.active_installations)}</td>`;
    return row;
  })
);
