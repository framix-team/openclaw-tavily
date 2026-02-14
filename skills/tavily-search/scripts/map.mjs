#!/usr/bin/env node

function usage() {
  console.error('Usage: map.mjs "url" [--depth N] [--breadth N] [--limit N] [--instructions "..."]');
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") usage();

const url = args[0];
let depth = null;
let breadth = null;
let limit = null;
let instructions = null;

for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === "--depth") {
    depth = Number.parseInt(args[i + 1] ?? "2", 10);
    i++;
  } else if (a === "--breadth") {
    breadth = Number.parseInt(args[i + 1] ?? "10", 10);
    i++;
  } else if (a === "--limit") {
    limit = Number.parseInt(args[i + 1] ?? "50", 10);
    i++;
  } else if (a === "--instructions") {
    instructions = args[i + 1] ?? null;
    i++;
  } else {
    console.error(`Unknown arg: ${a}`);
    usage();
  }
}

const apiKey = (process.env.TAVILY_API_KEY ?? "").trim();
if (!apiKey) {
  console.error("Missing TAVILY_API_KEY");
  process.exit(1);
}

const body = { url };
if (depth !== null) body.max_depth = depth;
if (breadth !== null) body.max_breadth = breadth;
if (limit !== null) body.limit = limit;
if (instructions) body.instructions = instructions;

const resp = await fetch("https://api.tavily.com/map", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify(body),
});

if (!resp.ok) {
  const text = await resp.text().catch(() => "");
  console.error(`Tavily Map failed (${resp.status}): ${text}`);
  process.exit(1);
}

const data = await resp.json();

const urls = data.results ?? [];
console.log(`## Site Map: ${url}\n`);
console.log(`Found ${urls.length} URL(s)\n`);

for (const u of urls) {
  console.log(`- ${u}`);
}
console.log();
