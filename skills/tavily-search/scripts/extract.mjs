#!/usr/bin/env node

function usage() {
  console.error('Usage: extract.mjs "url1" ["url2" ...] [--format markdown|text] [--query "..."]');
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") usage();

const urls = [];
let format = "markdown";
let query = null;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--format") {
    format = args[i + 1] ?? "markdown";
    i++;
  } else if (a === "--query") {
    query = args[i + 1] ?? null;
    i++;
  } else if (!a.startsWith("-")) {
    urls.push(a);
  } else {
    console.error(`Unknown arg: ${a}`);
    usage();
  }
}

if (urls.length === 0) {
  console.error("No URLs provided");
  usage();
}

const apiKey = (process.env.TAVILY_API_KEY ?? "").trim();
if (!apiKey) {
  console.error("Missing TAVILY_API_KEY");
  process.exit(1);
}

const extractBody = { urls, format };
if (query) extractBody.query = query;

const resp = await fetch("https://api.tavily.com/extract", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify(extractBody),
});

if (!resp.ok) {
  const text = await resp.text().catch(() => "");
  console.error(`Tavily Extract failed (${resp.status}): ${text}`);
  process.exit(1);
}

const data = await resp.json();

for (const r of data.results ?? []) {
  const url = String(r?.url ?? "").trim();
  const content = String(r?.raw_content ?? "").trim();
  console.log(`# ${url}\n`);
  console.log(content || "(no content extracted)");
  console.log("\n---\n");
}

const failed = data.failed_results ?? [];
if (failed.length > 0) {
  console.log("## Failed URLs\n");
  for (const f of failed) {
    console.log(`- ${f.url}: ${f.error}`);
  }
}
