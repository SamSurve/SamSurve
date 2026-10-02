#!/usr/bin/env node
/**
 * GitHub Contribution Galaxy
 * Node 18+, zero npm dependencies.
 *
 * Fetches the real contribution calendar from GitHub GraphQL and renders
 * a self-contained SVG that keeps GitHub's 53x7 contribution geometry,
 * but presents the activity as a clean blue/cyan/purple space field.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const USER = getArg("user", process.env.GALAXY_USER || "SamSurve");
const OUT = getArg("out", "assets/contribution-galaxy.svg");
const INPUT = getArg("input", null);

const W = 896;
const H = 172;
const COLS = 53;
const ROWS = 7;
const PITCH = 16;
const CELL = 12.4;
const X0 = 42;
const Y0 = 30;

const esc = (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const n = (v) => Math.round(v * 100) / 100;

function hash(s) {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ramp = [
  [0.00, "#07101e"],
  [0.12, "#10275b"],
  [0.28, "#1c4ed8"],
  [0.45, "#2491ff"],
  [0.62, "#2dd4f7"],
  [0.78, "#7b61ff"],
  [0.90, "#b58cff"],
  [1.00, "#f2eaff"]
];

const hex = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));

function colorMix(a, b, t) {
  const A = hex(a), B = hex(b);
  return "#" + A.map((v, i) =>
    Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")
  ).join("");
}

function colorAt(t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < ramp.length; i++) {
    const [p1, c1] = ramp[i];
    if (t <= p1) {
      const [p0, c0] = ramp[i - 1];
      return colorMix(c0, c1, (t - p0) / (p1 - p0));
    }
  }
  return ramp.at(-1)[1];
}

async function fetchCalendar(token) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount weekday}}}}}}`;

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "SamSurve-contribution-galaxy"
    },
    body: JSON.stringify({
      query,
      variables: { login: USER }
    })
  });

  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);

  const json = await res.json();
  const weeks = json?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new Error("No contribution calendar returned");

  return weeks.map((w) => w.contributionDays.map((d) => ({
    date: d.date,
    count: d.contributionCount,
    weekday: d.weekday
  })));
}

async function loadCalendar() {
  if (INPUT) return JSON.parse(readFileSync(INPUT, "utf8"));

  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is required");

  return fetchCalendar(token);
}

function render(weeksIn) {
  const weeks = weeksIn.filter(Boolean).slice(-COLS);
  const offset = COLS - weeks.length;

  const cells = [];
  for (let i = 0; i < weeks.length; i++) {
    for (const d of weeks[i]) {
      cells.push({
        ...d,
        col: i + offset,
        // GitHub GraphQL weekday is 1..7 (Mon..Sun).
        // SVG rows are 0..6.
        row: d.weekday - 1
      });
    }
  }

  const active = cells.filter((c) => c.count > 0);
  const max = Math.max(1, ...active.map((c) => c.count));

  const cx = (c) => X0 + c.col * PITCH + CELL / 2;
  const cy = (c) => Y0 + c.row * PITCH + CELL / 2;

  // Labels are derived from the same real calendar data.
  const weekdayLabels = [
    [1, "Mon"],
    [3, "Wed"],
    [5, "Fri"]
  ];

  const weekdayText = weekdayLabels.map(([row, label]) =>
    `<text x="0" y="${n(Y0 + row * PITCH + 9)}" fill="#68758a" font-family="Arial,sans-serif" font-size="8" text-anchor="start">${label}</text>`
  ).join("");

  const monthFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC"
  });

  const monthLabels = [];
  let lastMonth = "";
  weeks.forEach((w, i) => {
    const first = w?.[0];
    if (!first) return;

    const month = monthFmt.format(new Date(first.date + "T00:00:00Z"));
    if (month !== lastMonth) {
      const x = X0 + (i + offset) * PITCH;
      monthLabels.push(
        `<text x="${n(x)}" y="13" fill="#68758a" font-family="Arial,sans-serif" font-size="8" text-anchor="start">${month}</text>`
      );
      lastMonth = month;
    }
  });

  // Background star field: intentionally sparse so it never looks like fake data.
  const dust = [];
  const dustRng = rng(hash(`dust:${USER}`));
  for (let i = 0; i < 62; i++) {
    const x = 8 + dustRng() * (W - 16);
    const y = 18 + dustRng() * (H - 26);
    const r = 0.25 + dustRng() * 0.7;
    const fill = dustRng() > 0.5 ? "#69ddff" : "#a98cff";
    dust.push(
      `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" fill="${fill}" opacity="${n(0.08 + dustRng() * 0.16)}"/>`
    );
  }

  // A very soft space haze behind the grid. It does not alter contribution cells.
  const haze = [
    `<ellipse cx="746" cy="84" rx="220" ry="74" fill="url(#cyanHaze)" opacity=".15"/>`,
    `<ellipse cx="836" cy="88" rx="126" ry="70" fill="url(#violetHaze)" opacity=".14"/>`
  ].join("");

  // Every empty day is explicitly drawn, preventing renderer-specific white grids.
  const empty = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      empty.push(
        `<rect x="${n(X0 + col * PITCH)}" y="${n(Y0 + row * PITCH)}" width="${CELL}" height="${CELL}" rx="2.8" fill="#07101e" stroke="#0e1a31" stroke-width=".45"/>`
      );
    }
  }

  const glow = [];
  const visible = [];
  const particles = [];
  const sparkles = [];

  for (const c of active) {
    const x = X0 + c.col * PITCH;
    const y = Y0 + c.row * PITCH;
    const intensity = Math.sqrt(c.count / max);
    const fill = colorAt(c.count / max);

    // Contribution cell glow.
    glow.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${CELL}" height="${CELL}" rx="3.5" fill="${fill}" opacity="${n(0.32 + intensity * 0.46)}"/>`
    );

    visible.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${CELL}" height="${CELL}" rx="2.8" fill="${fill}"/>`
    );

    // Tiny center bloom for medium/high activity.
    if (c.count >= 3) {
      visible.push(
        `<circle cx="${n(cx(c))}" cy="${n(cy(c))}" r="${n(1.0 + intensity * 2.4)}" fill="#ffffff" opacity="${n(0.18 + intensity * 0.52)}"/>`
      );
    }

    // Only strong contribution cells get nearby particles.
    if (c.count >= 4) {
      const rr = rng(hash(`cell:${c.date}:${c.count}`));
      const count = c.count >= 10 ? 4 : c.count >= 6 ? 3 : 1;

      for (let i = 0; i < count; i++) {
        const a = rr() * Math.PI * 2;
        const d = 8 + rr() * 8;
        particles.push(
          `<circle cx="${n(cx(c) + Math.cos(a) * d)}" cy="${n(cy(c) + Math.sin(a) * d * 0.7)}" r="${n(0.3 + rr() * 0.5)}" fill="${c.count >= 10 ? "#c9b0ff" : "#82eaff"}" opacity="${n(0.35 + rr() * 0.4)}"/>`
        );
      }
    }

    if (c.count >= Math.max(6, Math.ceil(max * 0.6))) {
      const s = 2.4 + intensity * 3.2;
      const k = s * 0.22;
      const px = cx(c), py = cy(c);

      sparkles.push(
        `<path class="tw" d="M${n(px)} ${n(py - s)}L${n(px + k)} ${n(py - k)}L${n(px + s)} ${n(py)}L${n(px + k)} ${n(py + k)}L${n(px)} ${n(py + s)}L${n(px - k)} ${n(py + k)}L${n(px - s)} ${n(py)}L${n(px - k)} ${n(py - k)}Z" fill="#ffffff"/>`
      );
    }
  }

  const labels = weekdayText + monthLabels.join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub contribution galaxy for ${esc(USER)}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop stop-color="#02050d"/>
    <stop offset=".48" stop-color="#050a17"/>
    <stop offset="1" stop-color="#02050d"/>
  </linearGradient>

  <radialGradient id="cyanHaze">
    <stop stop-color="#22d3ee" stop-opacity=".65"/>
    <stop offset="1" stop-color="#22d3ee" stop-opacity="0"/>
  </radialGradient>

  <radialGradient id="violetHaze">
    <stop stop-color="#8b5cf6" stop-opacity=".7"/>
    <stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/>
  </radialGradient>

  <filter id="glow" x="-120%" y="-120%" width="340%" height="340%">
    <feGaussianBlur stdDeviation="3"/>
  </filter>

  <filter id="glowSoft" x="-120%" y="-120%" width="340%" height="340%">
    <feGaussianBlur stdDeviation="6"/>
  </filter>

  <style>
    .tw{transform-origin:center;transform-box:fill-box;animation:twinkle 3.6s ease-in-out infinite alternate}
    @keyframes twinkle{from{opacity:.48}to{opacity:1}}
  </style>
</defs>

<rect width="${W}" height="${H}" rx="12" fill="url(#bg)"/>

<g>${dust.join("")}</g>
<g>${haze}</g>
<g>${labels}</g>
<g>${empty.join("")}</g>

<g filter="url(#glowSoft)" opacity=".42">${glow.join("")}</g>
<g filter="url(#glow)" opacity=".58">${glow.join("")}</g>

<g>${visible.join("")}</g>
<g>${particles.join("")}</g>
<g>${sparkles.join("")}</g>
</svg>`;
}

try {
  const weeks = await loadCalendar();
  const svg = render(weeks);

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, svg);

  console.log(`[galaxy] wrote ${OUT} (${svg.length} bytes)`);
} catch (error) {
  console.warn(`[galaxy] ${error.message}`);

  // Never destroy a known-good asset on a transient API failure.
  if (existsSync(OUT)) {
    console.warn("[galaxy] keeping existing SVG");
    process.exit(0);
  }

  process.exit(1);
}
