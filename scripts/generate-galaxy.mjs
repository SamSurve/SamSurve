#!/usr/bin/env node
/**
 * GitHub Contribution Galaxy
 * Node 18+, zero npm dependencies.
 *
 * Fetches the real contribution calendar from GitHub GraphQL and renders
 * a self-contained 896x150 SVG. The workflow passes GITHUB_TOKEN and
 * writes assets/contribution-galaxy.svg.
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
const H = 166;
const COLS = 53;
const ROWS = 7;
const PITCH = 16;
const CELL = 12.4;
const GRID_W = (COLS - 1) * PITCH + CELL;
const GRID_H = (ROWS - 1) * PITCH + CELL;
const X0 = 42;
const Y0 = 24;

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
  [0, "#0b1226"], [1, "#1b3aa8"], [2, "#2246c4"], [3, "#2563eb"],
  [5, "#3b82f6"], [6, "#1fb6f0"], [10, "#3fdcf7"],
  [11, "#7c5cf6"], [16, "#a45bf7"], [22, "#d8bcff"], [28, "#ffffff"]
];

const hex = (x) => [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
const colorMix = (a, b, t) => {
  const A = hex(a), B = hex(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
};

function colorFor(count) {
  if (count <= 0) return ramp[0][1];
  for (let i = 1; i < ramp.length; i++) {
    if (count <= ramp[i][0]) {
      const [c0, a,] = ramp[i - 1];
      const [c1, b] = ramp[i];
      return colorMix(a, b, (count - c0) / (c1 - c0));
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
    body: JSON.stringify({ query, variables: { login: USER } })
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  const weeks = json?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new Error("No contribution calendar returned");
  return weeks.map(w => w.contributionDays.map(d => ({
    date: d.date, count: d.contributionCount, weekday: d.weekday
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
    for (const d of weeks[i]) cells.push({
      ...d, col: i + offset, row: d.weekday - 1
    });
  }

  // GitHub-style weekday and month labels, derived from the actual calendar dates.
  const weekdayLabels = [
    [1, "Mon"], [3, "Wed"], [5, "Fri"]
  ];
  const weekdayText = weekdayLabels.map(([row, label]) =>
    `<text x="0" y="${n(Y0 + row * PITCH + CELL * 0.78)}" fill="#64748b" font-family="Arial,sans-serif" font-size="8" text-anchor="start">${label}</text>`
  ).join("");

  const monthFmt = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
  const monthLabels = [];
  let lastMonth = "";
  for (const w of weeks) {
    const first = w?.[0];
    if (!first) continue;
    const month = monthFmt.format(new Date(first.date + "T00:00:00Z"));
    const col = weeks.indexOf(w) + offset;
    if (month !== lastMonth) {
      const tx = X0 + col * PITCH;
      monthLabels.push(`<text x="${n(tx)}" y="12" fill="#64748b" font-family="Arial,sans-serif" font-size="8" text-anchor="start">${month}</text>`);
      lastMonth = month;
    }
  }
  const labels = weekdayText + monthLabels.join("");

  const max = Math.max(1, ...cells.map(c => c.count));
  const active = cells.filter(c => c.count > 0);
  const cx = c => X0 + c.col * PITCH + CELL / 2;
  const cy = c => Y0 + c.row * PITCH + CELL / 2;

  const dust = [];
  const r = rng(hash(`dust:${USER}`));
  for (let i = 0; i < 115; i++) {
    dust.push(`<circle cx="${n(r()*W)}" cy="${n(r()*H)}" r="${n(.25+r()*.75)}" fill="${r()>.55?"#6ee7ff":"#8b5cf6"}" opacity="${n(.08+r()*.22)}"/>`);
  }

  const empty = Array.from({ length: COLS }, (_, col) =>
    Array.from({ length: ROWS }, (_, row) =>
      `<rect x="${n(X0 + col * PITCH)}" y="${n(Y0 + row * PITCH)}" width="${CELL}" height="${CELL}" rx="2.6" fill="#0b1226"/>`
    ).join("")
  ).join("");
  const nebula = [];
  const glow = [];
  const cellsOut = [];
  const particles = [];
  const sparkles = [];
  const lines = [];

  for (let col = 0; col < COLS; col += 2) {
    for (let row = 0; row < ROWS; row += 2) {
      let energy = 0;
      for (const c of active) {
        const d = Math.hypot(c.col - col, c.row - row);
        if (d < 5) energy += ((1 - d / 5) ** 2) * Math.sqrt(c.count);
      }
      if (energy > .35) {
        nebula.push(`<circle cx="${n(X0+col*PITCH+CELL/2)}" cy="${n(Y0+row*PITCH+CELL/2)}" r="${n(20+Math.min(energy,6)*6)}" fill="url(#${energy>3?"violet":"cyan"})" opacity="${n(Math.min(.28,.06+energy*.035))}"/>`);
      }
    }
  }

  const strong = active.filter(c => c.count >= 5);
  for (let i=0;i<strong.length;i++) for (let j=i+1;j<strong.length;j++) {
    const a=strong[i], b=strong[j], d=Math.hypot(a.col-b.col,a.row-b.row);
    if (d <= 2.2) lines.push(`<line x1="${n(cx(a))}" y1="${n(cy(a))}" x2="${n(cx(b))}" y2="${n(cy(b))}"/>`);
  }

  for (const c of cells) {
    const x = X0 + c.col * PITCH;
    const y = Y0 + c.row * PITCH;
    if (!c.count) continue;
    const col = colorFor(c.count);
    const intensity = Math.min(1, c.count / max);
    glow.push(`<rect x="${n(x)}" y="${n(y)}" width="${CELL}" height="${CELL}" rx="3" fill="${c.count>=11?"#8b5cf6":"#2f6df0"}" opacity="${n(.26+intensity*.6)}"/>`);
    cellsOut.push(`<rect x="${n(x)}" y="${n(y)}" width="${CELL}" height="${CELL}" rx="2.6" fill="${col}"/>`);
    if (c.count >= 3) {
      cellsOut.push(`<circle cx="${n(cx(c))}" cy="${n(cy(c))}" r="${n(1.7+intensity*3.8)}" fill="url(#core)" opacity="${n(.5+intensity*.5)}"/>`);
    }
    const rr = rng(hash(`${c.date}:${c.count}`));
    const particleCount = c.count >= 11 ? 5 : c.count >= 6 ? 3 : 2;
    for (let i=0;i<particleCount;i++) {
      const a=rr()*Math.PI*2, d=CELL+rr()*12;
      particles.push(`<circle cx="${n(cx(c)+Math.cos(a)*d)}" cy="${n(cy(c)+Math.sin(a)*d*.7)}" r="${n(.3+rr()*.6)}" fill="${c.count>=11?"#c4a5ff":"#7fe3ff"}" opacity="${n(.45+rr()*.5)}"/>`);
    }
    if (c.count >= 6) {
      const s=2.5+intensity*3.6, k=s*.22, px=cx(c), py=cy(c);
      sparkles.push(`<path class="tw" d="M${n(px)} ${n(py-s)}L${n(px+k)} ${n(py-k)}L${n(px+s)} ${n(py)}L${n(px+k)} ${n(py+k)}L${n(px)} ${n(py+s)}L${n(px-k)} ${n(py+k)}L${n(px-s)} ${n(py)}L${n(px-k)} ${n(py-k)}Z" fill="#fff"/>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub contribution galaxy for ${esc(USER)}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#02040a"/><stop offset=".5" stop-color="#040916"/><stop offset="1" stop-color="#02040a"/></linearGradient>
  <radialGradient id="cyan"><stop stop-color="#22d3ee" stop-opacity=".6"/><stop offset="1" stop-color="#2563eb" stop-opacity="0"/></radialGradient>
  <radialGradient id="violet"><stop stop-color="#8b5cf6" stop-opacity=".7"/><stop offset="1" stop-color="#5b21b6" stop-opacity="0"/></radialGradient>
  <radialGradient id="core"><stop stop-color="#fff"/><stop offset=".45" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <linearGradient id="sheen"><stop stop-color="#fff" stop-opacity=".35"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
  <pattern id="grid" width="${PITCH}" height="${PITCH}" patternUnits="userSpaceOnUse"><rect x="0" y="0" width="${CELL}" height="${CELL}" rx="2.6" fill="#0b1226"/></pattern>
  <filter id="blur6" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="6"/></filter>
  <filter id="blur2" x="-30%" y="-100%" width="160%" height="300%"><feGaussianBlur stdDeviation="2.4"/></filter>
  <style>.tw{transform-origin:center;transform-box:fill-box;animation:twinkle 3.8s ease-in-out infinite alternate}@keyframes twinkle{from{opacity:.45}to{opacity:1}}</style>
</defs>
<rect width="${W}" height="${H}" rx="10" fill="url(#bg)"/>
<g>${labels}</g>
<g>${dust.join("")}</g>
<g>${nebula.join("")}</g>
<g>${empty}</g>
<g stroke="#7fb0ff" stroke-opacity=".2" stroke-width=".6" stroke-linecap="round">${lines.join("")}</g>
<g filter="url(#blur6)">${glow.join("")}</g>
<g filter="url(#blur2)">${glow.map((x,i)=>i%2?x:"").join("")}</g>
<g>${cellsOut.join("")}</g>
<g opacity=".5">${cells.filter(c=>c.count>0).map(c=>`<rect x="${n(X0+c.col*PITCH)}" y="${n(Y0+c.row*PITCH)}" width="${CELL}" height="${CELL}" rx="2.6" fill="url(#sheen)"/>`).join("")}</g>
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
  if (existsSync(OUT)) {
    console.warn("[galaxy] keeping existing SVG");
    process.exit(0);
  }
  process.exit(1);
}
