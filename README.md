# openclaw-tavily

[![npm version](https://img.shields.io/npm/v/openclaw-tavily.svg)](https://www.npmjs.com/package/openclaw-tavily)
[![license](https://img.shields.io/npm/l/openclaw-tavily.svg)](https://github.com/framix-team/openclaw-tavily/blob/main/LICENSE)

A [Tavily](https://tavily.com) web tools plugin for [OpenClaw](https://github.com/openclaw/openclaw).

Exposes five agent tools:

| Tool | Description |
|------|-------------|
| `tavily_search` | Web search with structured results, AI answers, domain filtering |
| `tavily_extract` | Extract clean markdown/text content from URLs |
| `tavily_crawl` | Crawl a website and extract content from discovered pages |
| `tavily_map` | Discover and list all URLs from a website |
| `tavily_research` | Deep agentic research returning comprehensive reports |

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

## Tools

### `tavily_search`

Search the web with structured results and optional AI-generated answers.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | **yes** | Search query string |
| `count` | no | Number of results (1-20) |
| `search_depth` | no | `"ultra-fast"`, `"fast"`, `"basic"`, or `"advanced"` |
| `include_answer` | no | Include AI answer (`true`/`false`/`"basic"`/`"advanced"`) |
| `include_raw_content` | no | Include raw page content (`true`/`false`/`"markdown"`/`"text"`) |
| `topic` | no | `"general"`, `"news"`, or `"finance"` |
| `time_range` | no | `"day"`, `"week"`, `"month"`, or `"year"` |
| `start_date` | no | Start date (ISO format, e.g. `"2024-01-01"`) |
| `end_date` | no | End date (ISO format) |
| `include_domains` | no | Limit to these domains |
| `exclude_domains` | no | Exclude these domains |
| `chunks_per_source` | no | Content chunks per source (1-3, advanced depth only) |
| `include_images` | no | Include images in results |
| `include_image_descriptions` | no | Include image descriptions |
| `include_favicon` | no | Include favicon URLs |
| `country` | no | Country code for geo-boosted results |
| `auto_parameters` | no | Let Tavily optimize parameters automatically |

**Example response:**

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

### `tavily_extract`

Extract and clean content from one or more URLs.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `urls` | **yes** | Array of URLs to extract content from |
| `query` | no | Rerank extracted chunks for relevance |
| `chunks_per_source` | no | Max snippets per source |
| `format` | no | `"markdown"` or `"text"` (default: `"markdown"`) |
| `include_favicon` | no | Include favicon URLs |
| `timeout` | no | Max seconds before timeout |

**Example response:**

```json
{
  "results": [
    {
      "url": "https://example.com/article",
      "raw_content": "# Article Title\n\nFull markdown content..."
    }
  ],
  "failed_results": [],
  "provider": "tavily",
  "tookMs": 1234
}
```

### `tavily_crawl`

Crawl a website starting from a root URL, traversing links and extracting content.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | **yes** | Root URL to start crawling |
| `instructions` | no | Natural language guidance for the crawl |
| `max_depth` | no | Crawl depth (1-5) |
| `max_breadth` | no | Max links per level (1-500) |
| `limit` | no | Total URL cap |
| `select_paths` | no | Regex include filters for paths |
| `select_domains` | no | Regex include filters for domains |
| `exclude_paths` | no | Regex exclude filters for paths |
| `exclude_domains` | no | Regex exclude filters for domains |
| `allow_external` | no | Follow external links |
| `include_images` | no | Include images |
| `extract_depth` | no | `"basic"` or `"advanced"` |
| `format` | no | `"markdown"` or `"text"` |
| `include_favicon` | no | Include favicons |
| `timeout` | no | Timeout in seconds (10-150) |

**Example response:**

```json
{
  "base_url": "https://example.com",
  "results": [
    {
      "url": "https://example.com/page1",
      "raw_content": "# Page Title\n\nContent..."
    },
    {
      "url": "https://example.com/page2",
      "raw_content": "# Another Page\n\nMore content..."
    }
  ],
  "provider": "tavily",
  "tookMs": 5678
}
```

### `tavily_map`

Generate a site map — discover and list all URLs from a website.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | **yes** | URL to map |
| `instructions` | no | Natural language guidance |
| `max_depth` | no | Crawl depth (1-5) |
| `max_breadth` | no | Links per level |
| `limit` | no | Total URL cap |
| `select_paths` | no | Include filters for paths |
| `select_domains` | no | Include filters for domains |
| `exclude_paths` | no | Exclude filters for paths |
| `exclude_domains` | no | Exclude filters for domains |
| `allow_external` | no | Follow external links |
| `categories` | no | Category filters |

**Example response:**

```json
{
  "results": [
    "https://example.com/",
    "https://example.com/about",
    "https://example.com/docs",
    "https://example.com/docs/getting-started",
    "https://example.com/pricing"
  ],
  "provider": "tavily",
  "tookMs": 2345
}
```

### `tavily_research`

Run a deep agentic research task with a comprehensive report.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `input` | **yes** | Research question or topic |
| `model` | no | `"mini"`, `"pro"`, or `"auto"` (default: `"auto"`) |
| `output_schema` | no | JSON schema for structured output |
| `citation_format` | no | `"numbered"`, `"mla"`, `"apa"`, or `"chicago"` |

**Example response:**

```json
{
  "output": "# Research Report\n\n## Overview\n\nComprehensive analysis of...",
  "sources": [
    {
      "title": "Source Article",
      "url": "https://example.com/research"
    }
  ],
  "provider": "tavily",
  "tookMs": 45000
}
```

## Features

- **In-memory cache** — deduplicates identical search queries within the TTL window
- **Domain filtering** — include/exclude specific domains per search query
- **News & finance search** — topic + date range support
- **AI answers** — optional Tavily-generated summary alongside search results
- **URL extraction** — get clean markdown/text from any web page
- **Website crawling** — traverse and extract content from entire sites
- **Site mapping** — discover all URLs before targeted extraction
- **Deep research** — multi-step agentic research with comprehensive reports
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
