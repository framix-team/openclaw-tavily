---
name: tavily-search
description: Web search via Tavily API. Returns structured results with AI-generated answers. Use for current events, research, fact-checking, and finding URLs.
metadata:
  {
    "openclaw":
      {
        "emoji": "🔍",
        "requires": { "env": ["TAVILY_API_KEY"] },
        "primaryEnv": "TAVILY_API_KEY",
      },
  }
---

# Tavily Search

AI-optimized web search using the [Tavily API](https://tavily.com). Returns clean, relevant results designed for AI agents.

## When to use

- Current events, news, recent information
- Fact-checking or verifying claims
- Research on topics, companies, people
- Finding URLs, documentation, or references
- Anything the agent's training data might not cover

## Native tool (preferred)

If the `openclaw-tavily` plugin is installed, use the `tavily_search` tool directly — it has caching, typed schemas, and domain filtering built in.

## Script fallback

### Search

```bash
node {baseDir}/scripts/search.mjs "query"
node {baseDir}/scripts/search.mjs "query" -n 10
node {baseDir}/scripts/search.mjs "query" --deep
node {baseDir}/scripts/search.mjs "query" --topic news --days 7
```

Options:
- `-n <count>`: Number of results (default: 5, max: 20)
- `--deep`: Advanced search for deeper research (slower, more thorough)
- `--topic <topic>`: `general` (default) or `news`
- `--days <n>`: For news, limit to last n days

### Extract content from URLs

```bash
node {baseDir}/scripts/extract.mjs "https://example.com/article"
node {baseDir}/scripts/extract.mjs "url1" "url2" "url3"
```

Extracts clean text content from one or more URLs.

## Setup

Get an API key at [app.tavily.com](https://app.tavily.com) (free tier available).

Set `TAVILY_API_KEY` in your environment, or configure via the plugin:

```json
{
  "plugins": {
    "entries": {
      "openclaw-tavily": {
        "enabled": true,
        "config": { "apiKey": "tvly-..." }
      }
    }
  }
}
```

## Links

- Plugin: [openclaw-tavily on npm](https://www.npmjs.com/package/openclaw-tavily)
- Source: [github.com/framix-team/openclaw-tavily](https://github.com/framix-team/openclaw-tavily)
- Tavily API: [docs.tavily.com](https://docs.tavily.com)
