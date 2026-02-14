# openclaw-tavily

[![npm version](https://img.shields.io/npm/v/openclaw-tavily.svg)](https://www.npmjs.com/package/openclaw-tavily)
[![license](https://img.shields.io/npm/l/openclaw-tavily.svg)](https://github.com/framix-team/openclaw-tavily/blob/main/LICENSE)

A [Tavily](https://tavily.com) web search plugin for [OpenClaw](https://github.com/openclaw/openclaw).

Exposes a `tavily_search` agent tool that returns structured search results with titles, URLs, content snippets, relevance scores, and an optional AI-generated answer.

## Install

```bash
openclaw plugins install openclaw-tavily
```

Or install from source:

```bash
git clone https://github.com/framix-team/openclaw-tavily.git ~/.openclaw/extensions/openclaw-tavily
cd ~/.openclaw/extensions/openclaw-tavily
npm install --omit=dev
```

Then restart the gateway.

## Configuration

### 1. Set your Tavily API key

Get a key at [app.tavily.com](https://app.tavily.com).

Either set the environment variable:

```bash
export TAVILY_API_KEY=tvly-...
```

Or configure it in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openclaw-tavily": {
        "enabled": true,
        "config": {
          "apiKey": "tvly-..."
        }
      }
    }
  }
}
```

### 2. Optional settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `searchDepth` | `"basic"` \| `"advanced"` | `"advanced"` | Basic is faster/cheaper, advanced is more thorough |
| `maxResults` | `number` (1-20) | `5` | Number of results per search |
| `includeAnswer` | `boolean` | `true` | Include an AI-generated short answer |
| `includeRawContent` | `boolean` | `false` | Include full page content (increases token usage) |
| `timeoutSeconds` | `number` | `30` | Timeout for API requests |
| `cacheTtlMinutes` | `number` | `15` | In-memory cache TTL (0 to disable) |

## Tool: `tavily_search`

The agent can call this tool with the following parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | **yes** | Search query string |
| `count` | no | Number of results (1-20) |
| `search_depth` | no | `"basic"` or `"advanced"` |
| `include_answer` | no | Include AI answer |
| `include_raw_content` | no | Include raw page content |
| `topic` | no | `"general"` or `"news"` |
| `days` | no | Days back for news search |
| `include_domains` | no | Limit to these domains |
| `exclude_domains` | no | Exclude these domains |

### Example response

```json
{
  "query": "OpenClaw AI assistant",
  "provider": "tavily",
  "searchDepth": "advanced",
  "topic": "general",
  "count": 3,
  "tookMs": 1842,
  "answer": "OpenClaw is a personal AI assistant you run on your own devices...",
  "results": [
    {
      "title": "OpenClaw - Personal AI Assistant",
      "url": "https://openclaw.ai",
      "snippet": "...",
      "score": 0.98,
      "siteName": "openclaw.ai"
    }
  ]
}
```

## Features

- **In-memory cache** — deduplicates identical queries within the TTL window
- **Domain filtering** — include/exclude specific domains per query
- **News search** — topic + date range support for news queries
- **AI answers** — optional Tavily-generated summary alongside results
- **Graceful degradation** — goes idle if no API key is configured

## Requirements

- OpenClaw **2025+**
- A [Tavily API key](https://app.tavily.com) (free tier available)

## Links

- **npm**: [openclaw-tavily](https://www.npmjs.com/package/openclaw-tavily)
- **GitHub**: [framix-team/openclaw-tavily](https://github.com/framix-team/openclaw-tavily)
- **Tavily API docs**: [docs.tavily.com](https://docs.tavily.com)
- **OpenClaw plugin docs**: [docs.openclaw.ai/tools/plugin](https://docs.openclaw.ai/tools/plugin)

## Made by

[Framix](https://framix.net/) — Growth Web Presence for Scaling Companies

## License

MIT
