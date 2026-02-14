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

// Step 1: Create the research task
const createResp = await fetch("https://api.tavily.com/research", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify(body),
});

if (!createResp.ok) {
  const text = await createResp.text().catch(() => "");
  console.error(`Tavily Research failed (${createResp.status}): ${text}`);
  process.exit(1);
}

let data = await createResp.json();

// Step 2: If pending, poll until complete
if (data.status === "pending" && data.request_id) {
  const requestId = data.request_id;
  const pollUrl = `https://api.tavily.com/research/${requestId}`;
  const POLL_INTERVAL = 2000;
  const MAX_WAIT = 150_000; // 2.5 minutes
  const start = Date.now();

  process.stderr.write(`Research task ${requestId}: polling`);

  while (Date.now() - start < MAX_WAIT) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    process.stderr.write(".");

    const pollResp = await fetch(pollUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollResp.ok) {
      const text = await pollResp.text().catch(() => "");
      console.error(`\nPoll failed (${pollResp.status}): ${text}`);
      process.exit(1);
    }

    data = await pollResp.json();

    if (data.status === "completed" || data.output) {
      process.stderr.write(` done (${Math.round((Date.now() - start) / 1000)}s)\n`);
      break;
    }

    if (data.status === "failed" || data.status === "error") {
      console.error(`\nResearch task failed: ${JSON.stringify(data)}`);
      process.exit(1);
    }
  }

  if (data.status === "pending") {
    console.error(`\nResearch task timed out after ${MAX_WAIT / 1000}s. Request ID: ${requestId}`);
    process.exit(1);
  }
}

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
