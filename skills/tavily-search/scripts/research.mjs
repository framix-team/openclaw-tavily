#!/usr/bin/env node

function usage() {
  console.error('Usage: research.mjs "question" [--model mini|pro|auto] [--citation-format numbered|mla|apa|chicago]');
  process.exit(2);
}

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "-h" || args[0] === "--help") usage();

const input = args[0];
let model = null;
let citationFormat = null;

for (let i = 1; i < args.length; i++) {
  const a = args[i];
  if (a === "--model") {
    model = args[i + 1] ?? "auto";
    i++;
  } else if (a === "--citation-format") {
    citationFormat = args[i + 1] ?? "numbered";
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

const body = { input };
if (model) body.model = model;
if (citationFormat) body.citation_format = citationFormat;

const resp = await fetch("https://api.tavily.com/research", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify(body),
});

if (!resp.ok) {
  const text = await resp.text().catch(() => "");
  console.error(`Tavily Research failed (${resp.status}): ${text}`);
  process.exit(1);
}

const data = await resp.json();

console.log("## Research Report\n");

if (data.output) {
  console.log(data.output);
  console.log();
}

const sources = data.sources ?? [];
if (sources.length > 0) {
  console.log("---\n");
  console.log("## Sources\n");
  for (const s of sources) {
    const title = String(s?.title ?? "").trim();
    const url = String(s?.url ?? "").trim();
    if (url) {
      console.log(`- ${title ? `**${title}**: ` : ""}${url}`);
    }
  }
  console.log();
}
