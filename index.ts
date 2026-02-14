/**
 * openclaw-tavily — Tavily web tools plugin for OpenClaw
 *
 * Exposes five tools:
 *   - `tavily_search`    — web search with structured results and AI answers
 *   - `tavily_extract`   — extract clean content from URLs
 *   - `tavily_crawl`     — crawl a website and extract page content
 *   - `tavily_map`       — discover and list URLs from a website
 *   - `tavily_research`  — deep agentic research returning comprehensive reports
 *
 * API reference: https://docs.tavily.com/documentation/api-reference
 *
 * Config (openclaw.json → plugins.entries.openclaw-tavily.config):
 *   apiKey            - Tavily API key (or set TAVILY_API_KEY env var)
 *   searchDepth       - "basic" | "advanced" | "fast" | "ultra-fast" (default: "advanced")
 *   maxResults        - 1-20 (default: 5)
 *   includeAnswer     - boolean | "basic" | "advanced" (default: true)
 *   includeRawContent - boolean | "markdown" | "text" (default: false)
 *   timeoutSeconds    - number (default: 30)
 *   cacheTtlMinutes   - number (default: 15)
 */

import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Use OpenClawPluginApi from the SDK when available; fall back to a minimal
// interface so the plugin works even without openclaw in node_modules.
type PluginApi = {
  pluginConfig?: Record<string, unknown>;
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  registerTool: (tool: unknown, opts?: unknown) => void;
  registerService: (svc: unknown) => void;
};

type TavilySearchResult = {
  title: string;
  url: string;
  content: string; // snippet
  raw_content?: string;
  score: number;
  favicon?: string;
};

type TavilySearchResponse = {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
  response_time: number;
  images?: Array<{ url: string; description?: string }>;
};

type CacheEntry = {
  value: Record<string, unknown>;
  expiresAt: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const TAVILY_EXTRACT_ENDPOINT = "https://api.tavily.com/extract";
const TAVILY_CRAWL_ENDPOINT = "https://api.tavily.com/crawl";
const TAVILY_MAP_ENDPOINT = "https://api.tavily.com/map";
const TAVILY_RESEARCH_ENDPOINT = "https://api.tavily.com/research";
const DEFAULT_SEARCH_DEPTH = "advanced";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 20;
const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_CACHE_TTL_MINUTES = 15;
const MAX_CACHE_ENTRIES = 100;

// ---------------------------------------------------------------------------
// Cache (in-memory, same pattern as built-in web_search)
// ---------------------------------------------------------------------------

const SEARCH_CACHE = new Map<string, CacheEntry>();

function readCache(key: string): Record<string, unknown> | null {
  const entry = SEARCH_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    SEARCH_CACHE.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key: string, value: Record<string, unknown>, ttlMs: number): void {
  if (ttlMs <= 0) return;
  if (SEARCH_CACHE.size >= MAX_CACHE_ENTRIES) {
    const oldest = SEARCH_CACHE.keys().next();
    if (!oldest.done) SEARCH_CACHE.delete(oldest.value);
  }
  SEARCH_CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveApiKey(cfg: Record<string, unknown>): string | undefined {
  const fromConfig =
    typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
  const fromEnv = (process.env.TAVILY_API_KEY ?? "").trim();
  return fromConfig || fromEnv || undefined;
}

type SearchDepth = "basic" | "advanced" | "fast" | "ultra-fast";

function resolveSearchDepth(cfg: Record<string, unknown>): SearchDepth {
  const v = typeof cfg.searchDepth === "string" ? cfg.searchDepth.trim().toLowerCase() : "";
  if (v === "basic" || v === "fast" || v === "ultra-fast") return v as SearchDepth;
  return DEFAULT_SEARCH_DEPTH;
}

function resolveMaxResults(cfg: Record<string, unknown>): number {
  const v = typeof cfg.maxResults === "number" ? cfg.maxResults : DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(MAX_RESULTS_CAP, Math.floor(v)));
}

function resolveIncludeAnswer(cfg: Record<string, unknown>): boolean | string {
  const v = cfg.includeAnswer;
  if (typeof v === "string" && ["basic", "advanced"].includes(v)) return v;
  if (v === false) return false;
  return true; // default true
}

function resolveIncludeRawContent(cfg: Record<string, unknown>): boolean | string {
  const v = cfg.includeRawContent;
  if (typeof v === "string" && ["markdown", "text"].includes(v)) return v;
  if (v === true) return true;
  return false; // default false
}

function resolveTimeout(cfg: Record<string, unknown>): number {
  const v = typeof cfg.timeoutSeconds === "number" ? cfg.timeoutSeconds : DEFAULT_TIMEOUT_SECONDS;
  return Math.max(1, Math.floor(v));
}

function resolveCacheTtlMs(cfg: Record<string, unknown>): number {
  const minutes =
    typeof cfg.cacheTtlMinutes === "number" ? Math.max(0, cfg.cacheTtlMinutes) : DEFAULT_CACHE_TTL_MINUTES;
  return Math.round(minutes * 60_000);
}

function siteName(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

const TavilySearchSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  count: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-20). Default: 5.",
      minimum: 1,
      maximum: MAX_RESULTS_CAP,
    }),
  ),
  search_depth: Type.Optional(
    Type.String({
      description:
        'Search depth: "ultra-fast", "fast", "basic", or "advanced" (thorough). Default: from config.',
    }),
  ),
  include_answer: Type.Optional(
    Type.Union([Type.Boolean(), Type.String()], {
      description:
        'Include an AI-generated short answer. Boolean or "basic"/"advanced". Default: from config.',
    }),
  ),
  include_raw_content: Type.Optional(
    Type.Union([Type.Boolean(), Type.String()], {
      description:
        'Include raw page content. Boolean or "markdown"/"text". Default: from config.',
    }),
  ),
  topic: Type.Optional(
    Type.String({
      description:
        'Category of search: "general", "news", or "finance". Default: "general".',
    }),
  ),
  time_range: Type.Optional(
    Type.String({
      description:
        'Time range filter: "day", "week", "month", or "year".',
    }),
  ),
  start_date: Type.Optional(
    Type.String({
      description: "Start date for results (ISO date string, e.g. \"2024-01-01\").",
    }),
  ),
  end_date: Type.Optional(
    Type.String({
      description: "End date for results (ISO date string, e.g. \"2024-12-31\").",
    }),
  ),
  include_domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Limit results to these domains (e.g. [\"arxiv.org\", \"github.com\"]).",
    }),
  ),
  exclude_domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude results from these domains.",
    }),
  ),
  chunks_per_source: Type.Optional(
    Type.Number({
      description: "Number of content chunks per source (1-3, only for advanced depth).",
      minimum: 1,
      maximum: 3,
    }),
  ),
  include_images: Type.Optional(
    Type.Boolean({
      description: "Include images in results. Default: false.",
    }),
  ),
  include_image_descriptions: Type.Optional(
    Type.Boolean({
      description: "Include descriptions for images. Default: false.",
    }),
  ),
  include_favicon: Type.Optional(
    Type.Boolean({
      description: "Include favicon URLs for each result. Default: false.",
    }),
  ),
  country: Type.Optional(
    Type.String({
      description: "Country code for geo-boosted results (only for general topic), e.g. \"us\", \"gb\".",
    }),
  ),
  auto_parameters: Type.Optional(
    Type.Boolean({
      description: "Let Tavily automatically set optimal search parameters. Default: false.",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Extract schema
// ---------------------------------------------------------------------------

const TavilyExtractSchema = Type.Object({
  urls: Type.Array(Type.String(), {
    description: "URLs to extract content from.",
  }),
  query: Type.Optional(
    Type.String({
      description: "Optional query to rerank extracted chunks for relevance.",
    }),
  ),
  chunks_per_source: Type.Optional(
    Type.Number({
      description: "Max content snippets per source.",
    }),
  ),
  format: Type.Optional(
    Type.String({
      description: 'Output format: "markdown" or "text". Default: "markdown".',
    }),
  ),
  include_favicon: Type.Optional(
    Type.Boolean({
      description: "Include favicon URLs. Default: false.",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: "Max seconds before timeout.",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Crawl schema
// ---------------------------------------------------------------------------

const TavilyCrawlSchema = Type.Object({
  url: Type.String({ description: "Root URL to start crawling from." }),
  instructions: Type.Optional(
    Type.String({
      description: "Natural language guidance for the crawl.",
    }),
  ),
  max_depth: Type.Optional(
    Type.Number({
      description: "Crawl depth (1-5).",
      minimum: 1,
      maximum: 5,
    }),
  ),
  max_breadth: Type.Optional(
    Type.Number({
      description: "Max links to follow per level (1-500).",
      minimum: 1,
      maximum: 500,
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Total URL cap.",
    }),
  ),
  select_paths: Type.Optional(
    Type.Array(Type.String(), {
      description: "Regex include filters for URL paths.",
    }),
  ),
  select_domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Regex include filters for domains.",
    }),
  ),
  exclude_paths: Type.Optional(
    Type.Array(Type.String(), {
      description: "Regex exclude filters for URL paths.",
    }),
  ),
  exclude_domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Regex exclude filters for domains.",
    }),
  ),
  allow_external: Type.Optional(
    Type.Boolean({
      description: "Follow external links. Default: false.",
    }),
  ),
  include_images: Type.Optional(
    Type.Boolean({
      description: "Include images in results. Default: false.",
    }),
  ),
  extract_depth: Type.Optional(
    Type.String({
      description: 'Extraction depth: "basic" or "advanced".',
    }),
  ),
  format: Type.Optional(
    Type.String({
      description: 'Output format: "markdown" or "text".',
    }),
  ),
  include_favicon: Type.Optional(
    Type.Boolean({
      description: "Include favicons. Default: false.",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({
      description: "Timeout in seconds (10-150).",
      minimum: 10,
      maximum: 150,
    }),
  ),
});

// ---------------------------------------------------------------------------
// Map schema
// ---------------------------------------------------------------------------

const TavilyMapSchema = Type.Object({
  url: Type.String({ description: "URL to map." }),
  instructions: Type.Optional(
    Type.String({
      description: "Natural language guidance for the map.",
    }),
  ),
  max_depth: Type.Optional(
    Type.Number({
      description: "Crawl depth (1-5).",
      minimum: 1,
      maximum: 5,
    }),
  ),
  max_breadth: Type.Optional(
    Type.Number({
      description: "Max links to follow per level.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Total URL cap.",
    }),
  ),
  select_paths: Type.Optional(
    Type.Array(Type.String(), {
      description: "Include filters for URL paths.",
    }),
  ),
  select_domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Include filters for domains.",
    }),
  ),
  exclude_paths: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude filters for URL paths.",
    }),
  ),
  exclude_domains: Type.Optional(
    Type.Array(Type.String(), {
      description: "Exclude filters for domains.",
    }),
  ),
  allow_external: Type.Optional(
    Type.Boolean({
      description: "Follow external links. Default: false.",
    }),
  ),
  categories: Type.Optional(
    Type.String({
      description: "Category filters.",
    }),
  ),
});

// ---------------------------------------------------------------------------
// Research schema
// ---------------------------------------------------------------------------

const TavilyResearchSchema = Type.Object({
  input: Type.String({ description: "Research question or topic." }),
  model: Type.Optional(
    Type.String({
      description: 'Research model: "mini", "pro", or "auto". Default: "auto".',
    }),
  ),
  output_schema: Type.Optional(
    Type.Object({}, {
      description: "JSON schema for structured output.",
      additionalProperties: true,
    }),
  ),
  citation_format: Type.Optional(
    Type.String({
      description: 'Citation format: "numbered", "mla", "apa", or "chicago".',
    }),
  ),
});

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const tavilyPlugin = {
  id: "openclaw-tavily",
  name: "Tavily Search",
  description:
    "Web search, extraction, crawling, mapping, and research via Tavily API. Provides tavily_search, tavily_extract, tavily_crawl, tavily_map, and tavily_research tools.",
  kind: "tools" as const,

  register(api: PluginApi) {
    const cfg = api.pluginConfig ?? {};
    const apiKey = resolveApiKey(cfg);

    if (!apiKey) {
      api.logger.warn(
        "tavily: no API key found. Set TAVILY_API_KEY env var or plugins.entries.openclaw-tavily.config.apiKey. Plugin idle.",
      );
      api.registerService({
        id: "openclaw-tavily",
        start: () => api.logger.info("tavily: idle (no API key)"),
        stop: () => {},
      });
      return;
    }

    const defaultSearchDepth = resolveSearchDepth(cfg);
    const defaultMaxResults = resolveMaxResults(cfg);
    const defaultIncludeAnswer = resolveIncludeAnswer(cfg);
    const defaultIncludeRawContent = resolveIncludeRawContent(cfg);
    const defaultTimeout = resolveTimeout(cfg);
    const cacheTtlMs = resolveCacheTtlMs(cfg);

    api.logger.info(
      `tavily: initialized (depth=${defaultSearchDepth}, maxResults=${defaultMaxResults}, ` +
        `answer=${defaultIncludeAnswer}, rawContent=${defaultIncludeRawContent}, ` +
        `timeout=${defaultTimeout}s, cacheTtl=${Math.round(cacheTtlMs / 60000)}min)`,
    );

    api.registerTool(
      {
        name: "tavily_search",
        label: "Tavily Search",
        description:
          "Search the web using Tavily Search API. Returns structured results with titles, URLs, " +
          "content snippets, relevance scores, and an optional AI-generated answer. Supports " +
          "domain filtering and news-specific search.",
        parameters: TavilySearchSchema,
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          // --- resolve per-call params ---
          const query =
            typeof params.query === "string" ? params.query.trim() : "";
          if (!query) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: "missing_query",
                    message: "A non-empty query string is required.",
                  }),
                },
              ],
              details: {},
            };
          }

          const count =
            typeof params.count === "number" && Number.isFinite(params.count)
              ? Math.max(1, Math.min(MAX_RESULTS_CAP, Math.floor(params.count)))
              : defaultMaxResults;

          const searchDepth =
            typeof params.search_depth === "string" &&
            ["basic", "advanced", "fast", "ultra-fast"].includes(params.search_depth)
              ? (params.search_depth as SearchDepth)
              : defaultSearchDepth;

          const includeAnswer: boolean | string =
            typeof params.include_answer === "string" &&
            ["basic", "advanced"].includes(params.include_answer)
              ? params.include_answer
              : typeof params.include_answer === "boolean"
                ? params.include_answer
                : defaultIncludeAnswer;

          const includeRawContent: boolean | string =
            typeof params.include_raw_content === "string" &&
            ["markdown", "text"].includes(params.include_raw_content)
              ? params.include_raw_content
              : typeof params.include_raw_content === "boolean"
                ? params.include_raw_content
                : defaultIncludeRawContent;

          const topic =
            typeof params.topic === "string" &&
            ["general", "news", "finance"].includes(params.topic)
              ? params.topic
              : "general";

          const timeRange =
            typeof params.time_range === "string" &&
            ["day", "week", "month", "year"].includes(params.time_range)
              ? params.time_range
              : undefined;

          const startDate =
            typeof params.start_date === "string" ? params.start_date.trim() : undefined;

          const endDate =
            typeof params.end_date === "string" ? params.end_date.trim() : undefined;

          const includeDomains = Array.isArray(params.include_domains)
            ? (params.include_domains as string[]).filter(
                (d) => typeof d === "string" && d.trim(),
              )
            : undefined;

          const excludeDomains = Array.isArray(params.exclude_domains)
            ? (params.exclude_domains as string[]).filter(
                (d) => typeof d === "string" && d.trim(),
              )
            : undefined;

          const chunksPerSource =
            typeof params.chunks_per_source === "number" &&
            searchDepth === "advanced"
              ? Math.max(1, Math.min(3, Math.floor(params.chunks_per_source)))
              : undefined;

          const includeImages =
            typeof params.include_images === "boolean" ? params.include_images : undefined;

          const includeImageDescriptions =
            typeof params.include_image_descriptions === "boolean"
              ? params.include_image_descriptions
              : undefined;

          const includeFavicon =
            typeof params.include_favicon === "boolean" ? params.include_favicon : undefined;

          const country =
            typeof params.country === "string" && topic === "general"
              ? params.country.trim()
              : undefined;

          const autoParameters =
            typeof params.auto_parameters === "boolean" ? params.auto_parameters : undefined;

          // --- cache ---
          const cacheKey = [
            "tavily",
            query,
            count,
            searchDepth,
            includeAnswer,
            includeRawContent,
            topic,
            timeRange ?? "",
            startDate ?? "",
            endDate ?? "",
            (includeDomains ?? []).join(","),
            (excludeDomains ?? []).join(","),
            chunksPerSource ?? "",
            includeImages ?? "",
            includeImageDescriptions ?? "",
            includeFavicon ?? "",
            country ?? "",
            autoParameters ?? "",
          ]
            .join(":")
            .toLowerCase();

          const cached = readCache(cacheKey);
          if (cached) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({ ...cached, cached: true }, null, 2),
                },
              ],
              details: {},
            };
          }

          // --- build Tavily API request body ---
          const body: Record<string, unknown> = {
            query,
            search_depth: searchDepth,
            max_results: count,
            include_answer: includeAnswer,
            include_raw_content: includeRawContent,
            topic,
          };
          if (timeRange !== undefined) body.time_range = timeRange;
          if (startDate) body.start_date = startDate;
          if (endDate) body.end_date = endDate;
          if (includeDomains && includeDomains.length > 0)
            body.include_domains = includeDomains;
          if (excludeDomains && excludeDomains.length > 0)
            body.exclude_domains = excludeDomains;
          if (chunksPerSource !== undefined) body.chunks_per_source = chunksPerSource;
          if (includeImages !== undefined) body.include_images = includeImages;
          if (includeImageDescriptions !== undefined)
            body.include_image_descriptions = includeImageDescriptions;
          if (includeFavicon !== undefined) body.include_favicon = includeFavicon;
          if (country) body.country = country;
          if (autoParameters !== undefined) body.auto_parameters = autoParameters;

          // --- call Tavily ---
          const start = Date.now();
          let data: TavilySearchResponse;
          try {
            const controller = new AbortController();
            const timer = setTimeout(
              () => controller.abort(),
              defaultTimeout * 1000,
            );

            const res = await fetch(TAVILY_SEARCH_ENDPOINT, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            });

            clearTimeout(timer);

            if (!res.ok) {
              let detail = "";
              try {
                detail = await res.text();
              } catch {}
              const errPayload = {
                error: "tavily_api_error",
                status: res.status,
                message: detail || res.statusText,
              };
              api.logger.warn(
                `tavily: API error ${res.status}: ${detail || res.statusText}`,
              );
              return {
                content: [
                  { type: "text" as const, text: JSON.stringify(errPayload, null, 2) },
                ],
                details: {},
              };
            }

            data = (await res.json()) as TavilySearchResponse;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            api.logger.warn(`tavily: fetch error: ${msg}`);
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      error: "tavily_fetch_error",
                      message: msg,
                    },
                    null,
                    2,
                  ),
                },
              ],
              details: {},
            };
          }

          const tookMs = Date.now() - start;

          // --- format results ---
          const results = (data.results ?? []).map((r) => ({
            title: r.title || "",
            url: r.url || "",
            snippet: r.content || "",
            ...(includeRawContent && r.raw_content
              ? { rawContent: r.raw_content }
              : {}),
            score: r.score,
            siteName: siteName(r.url) || undefined,
            ...(includeFavicon && r.favicon ? { favicon: r.favicon } : {}),
          }));

          const payload: Record<string, unknown> = {
            query: data.query ?? query,
            provider: "tavily",
            searchDepth,
            topic,
            count: results.length,
            tookMs,
            tavilyResponseTime: data.response_time,
            results,
          };

          if (includeAnswer && data.answer) {
            payload.answer = data.answer;
          }

          if (data.images && data.images.length > 0) {
            payload.images = data.images;
          }

          // --- cache + return ---
          writeCache(cacheKey, payload, cacheTtlMs);

          api.logger.info(
            `tavily: "${query}" → ${results.length} results in ${tookMs}ms (depth=${searchDepth})`,
          );

          return {
            content: [
              { type: "text" as const, text: JSON.stringify(payload, null, 2) },
            ],
            details: {},
          };
        },
      },
      { source: "openclaw-tavily" },
    );

    // -----------------------------------------------------------------
    // tavily_extract
    // -----------------------------------------------------------------
    api.registerTool(
      {
        name: "tavily_extract",
        label: "Tavily Extract",
        description:
          "Extract and clean content from one or more URLs. Returns markdown or text content. " +
          "Use when you need the full content of specific web pages.",
        parameters: TavilyExtractSchema,
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const urls = Array.isArray(params.urls)
            ? (params.urls as string[]).filter((u) => typeof u === "string" && u.trim())
            : [];
          if (urls.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    error: "missing_urls",
                    message: "At least one URL is required.",
                  }),
                },
              ],
              details: {},
            };
          }

          const body: Record<string, unknown> = { urls };
          if (typeof params.query === "string" && params.query.trim())
            body.query = params.query.trim();
          if (typeof params.chunks_per_source === "number")
            body.chunks_per_source = params.chunks_per_source;
          if (typeof params.format === "string" && ["markdown", "text"].includes(params.format))
            body.format = params.format;
          if (typeof params.include_favicon === "boolean")
            body.include_favicon = params.include_favicon;
          if (typeof params.timeout === "number")
            body.timeout = params.timeout;

          const start = Date.now();
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), defaultTimeout * 1000);

            const res = await fetch(TAVILY_EXTRACT_ENDPOINT, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            clearTimeout(timer);

            if (!res.ok) {
              let detail = "";
              try { detail = await res.text(); } catch {}
              api.logger.warn(`tavily extract: API error ${res.status}: ${detail || res.statusText}`);
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({ error: "tavily_api_error", status: res.status, message: detail || res.statusText }, null, 2),
                }],
                details: {},
              };
            }

            const data = await res.json() as Record<string, unknown>;
            const tookMs = Date.now() - start;
            const payload = { ...data, provider: "tavily", tookMs };

            api.logger.info(`tavily extract: ${urls.length} URL(s) in ${tookMs}ms`);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
              details: {},
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            api.logger.warn(`tavily extract: fetch error: ${msg}`);
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ error: "tavily_fetch_error", message: msg }, null, 2),
              }],
              details: {},
            };
          }
        },
      },
      { source: "openclaw-tavily" },
    );

    // -----------------------------------------------------------------
    // tavily_crawl
    // -----------------------------------------------------------------
    api.registerTool(
      {
        name: "tavily_crawl",
        label: "Tavily Crawl",
        description:
          "Crawl a website starting from a root URL. Traverses links and extracts content " +
          "from discovered pages. Use for comprehensive site analysis.",
        parameters: TavilyCrawlSchema,
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const url = typeof params.url === "string" ? params.url.trim() : "";
          if (!url) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ error: "missing_url", message: "A non-empty url is required." }),
              }],
              details: {},
            };
          }

          const body: Record<string, unknown> = { url };
          if (typeof params.instructions === "string" && params.instructions.trim())
            body.instructions = params.instructions.trim();
          if (typeof params.max_depth === "number")
            body.max_depth = Math.max(1, Math.min(5, Math.floor(params.max_depth)));
          if (typeof params.max_breadth === "number")
            body.max_breadth = Math.max(1, Math.min(500, Math.floor(params.max_breadth)));
          if (typeof params.limit === "number")
            body.limit = Math.floor(params.limit);
          if (Array.isArray(params.select_paths) && params.select_paths.length > 0)
            body.select_paths = params.select_paths;
          if (Array.isArray(params.select_domains) && params.select_domains.length > 0)
            body.select_domains = params.select_domains;
          if (Array.isArray(params.exclude_paths) && params.exclude_paths.length > 0)
            body.exclude_paths = params.exclude_paths;
          if (Array.isArray(params.exclude_domains) && params.exclude_domains.length > 0)
            body.exclude_domains = params.exclude_domains;
          if (typeof params.allow_external === "boolean")
            body.allow_external = params.allow_external;
          if (typeof params.include_images === "boolean")
            body.include_images = params.include_images;
          if (typeof params.extract_depth === "string" && ["basic", "advanced"].includes(params.extract_depth))
            body.extract_depth = params.extract_depth;
          if (typeof params.format === "string" && ["markdown", "text"].includes(params.format))
            body.format = params.format;
          if (typeof params.include_favicon === "boolean")
            body.include_favicon = params.include_favicon;
          if (typeof params.timeout === "number")
            body.timeout = Math.max(10, Math.min(150, params.timeout));

          const start = Date.now();
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), defaultTimeout * 1000);

            const res = await fetch(TAVILY_CRAWL_ENDPOINT, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            clearTimeout(timer);

            if (!res.ok) {
              let detail = "";
              try { detail = await res.text(); } catch {}
              api.logger.warn(`tavily crawl: API error ${res.status}: ${detail || res.statusText}`);
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({ error: "tavily_api_error", status: res.status, message: detail || res.statusText }, null, 2),
                }],
                details: {},
              };
            }

            const data = await res.json() as Record<string, unknown>;
            const tookMs = Date.now() - start;
            const payload = { ...data, provider: "tavily", tookMs };

            const resultCount = Array.isArray(data.results) ? data.results.length : 0;
            api.logger.info(`tavily crawl: ${url} → ${resultCount} pages in ${tookMs}ms`);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
              details: {},
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            api.logger.warn(`tavily crawl: fetch error: ${msg}`);
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ error: "tavily_fetch_error", message: msg }, null, 2),
              }],
              details: {},
            };
          }
        },
      },
      { source: "openclaw-tavily" },
    );

    // -----------------------------------------------------------------
    // tavily_map
    // -----------------------------------------------------------------
    api.registerTool(
      {
        name: "tavily_map",
        label: "Tavily Map",
        description:
          "Generate a site map — discover and list all URLs from a website. " +
          "Use to understand site structure before targeted extraction.",
        parameters: TavilyMapSchema,
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const url = typeof params.url === "string" ? params.url.trim() : "";
          if (!url) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ error: "missing_url", message: "A non-empty url is required." }),
              }],
              details: {},
            };
          }

          const body: Record<string, unknown> = { url };
          if (typeof params.instructions === "string" && params.instructions.trim())
            body.instructions = params.instructions.trim();
          if (typeof params.max_depth === "number")
            body.max_depth = Math.max(1, Math.min(5, Math.floor(params.max_depth)));
          if (typeof params.max_breadth === "number")
            body.max_breadth = Math.floor(params.max_breadth);
          if (typeof params.limit === "number")
            body.limit = Math.floor(params.limit);
          if (Array.isArray(params.select_paths) && params.select_paths.length > 0)
            body.select_paths = params.select_paths;
          if (Array.isArray(params.select_domains) && params.select_domains.length > 0)
            body.select_domains = params.select_domains;
          if (Array.isArray(params.exclude_paths) && params.exclude_paths.length > 0)
            body.exclude_paths = params.exclude_paths;
          if (Array.isArray(params.exclude_domains) && params.exclude_domains.length > 0)
            body.exclude_domains = params.exclude_domains;
          if (typeof params.allow_external === "boolean")
            body.allow_external = params.allow_external;
          if (typeof params.categories === "string" && params.categories.trim())
            body.categories = params.categories.trim();

          const start = Date.now();
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), defaultTimeout * 1000);

            const res = await fetch(TAVILY_MAP_ENDPOINT, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
              signal: controller.signal,
            });
            clearTimeout(timer);

            if (!res.ok) {
              let detail = "";
              try { detail = await res.text(); } catch {}
              api.logger.warn(`tavily map: API error ${res.status}: ${detail || res.statusText}`);
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({ error: "tavily_api_error", status: res.status, message: detail || res.statusText }, null, 2),
                }],
                details: {},
              };
            }

            const data = await res.json() as Record<string, unknown>;
            const tookMs = Date.now() - start;
            const payload = { ...data, provider: "tavily", tookMs };

            const urlCount = Array.isArray(data.results) ? data.results.length : 0;
            api.logger.info(`tavily map: ${url} → ${urlCount} URLs in ${tookMs}ms`);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
              details: {},
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            api.logger.warn(`tavily map: fetch error: ${msg}`);
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ error: "tavily_fetch_error", message: msg }, null, 2),
              }],
              details: {},
            };
          }
        },
      },
      { source: "openclaw-tavily" },
    );

    // -----------------------------------------------------------------
    // tavily_research
    // -----------------------------------------------------------------
    api.registerTool(
      {
        name: "tavily_research",
        label: "Tavily Research",
        description:
          "Run a deep agentic research task. Tavily performs multi-step search and analysis, " +
          "returning a comprehensive report. Use for complex research questions.",
        parameters: TavilyResearchSchema,
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          const input = typeof params.input === "string" ? params.input.trim() : "";
          if (!input) {
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ error: "missing_input", message: "A non-empty input is required." }),
              }],
              details: {},
            };
          }

          const body: Record<string, unknown> = { input };
          if (typeof params.model === "string" && ["mini", "pro", "auto"].includes(params.model))
            body.model = params.model;
          if (params.output_schema && typeof params.output_schema === "object")
            body.output_schema = params.output_schema;
          if (typeof params.citation_format === "string" && ["numbered", "mla", "apa", "chicago"].includes(params.citation_format))
            body.citation_format = params.citation_format;

          // Research is async — POST to create, then poll GET until complete
          const RESEARCH_POLL_INTERVAL = 2000; // 2s between polls
          const RESEARCH_MAX_WAIT = defaultTimeout * 5 * 1000; // 5x default timeout

          const start = Date.now();
          try {
            // Step 1: Create the research task
            const createRes = await fetch(TAVILY_RESEARCH_ENDPOINT, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
            });

            if (!createRes.ok) {
              let detail = "";
              try { detail = await createRes.text(); } catch {}
              api.logger.warn(`tavily research: API error ${createRes.status}: ${detail || createRes.statusText}`);
              return {
                content: [{
                  type: "text" as const,
                  text: JSON.stringify({ error: "tavily_api_error", status: createRes.status, message: detail || createRes.statusText }, null, 2),
                }],
                details: {},
              };
            }

            const createData = await createRes.json() as Record<string, unknown>;
            const requestId = createData.request_id as string | undefined;

            // If the response already has output (not pending), return it
            if (createData.status !== "pending" || !requestId) {
              const tookMs = Date.now() - start;
              const payload = { ...createData, provider: "tavily", tookMs };
              api.logger.info(`tavily research: "${input.slice(0, 60)}" immediate in ${tookMs}ms`);
              return {
                content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
                details: {},
              };
            }

            // Step 2: Poll until complete or timeout
            api.logger.info(`tavily research: polling ${requestId} for "${input.slice(0, 60)}"...`);
            const pollUrl = `${TAVILY_RESEARCH_ENDPOINT}/${requestId}`;

            while (Date.now() - start < RESEARCH_MAX_WAIT) {
              await new Promise((r) => setTimeout(r, RESEARCH_POLL_INTERVAL));

              const pollRes = await fetch(pollUrl, {
                method: "GET",
                headers: { Authorization: `Bearer ${apiKey}` },
              });

              if (!pollRes.ok) {
                let detail = "";
                try { detail = await pollRes.text(); } catch {}
                api.logger.warn(`tavily research: poll error ${pollRes.status}: ${detail || pollRes.statusText}`);
                return {
                  content: [{
                    type: "text" as const,
                    text: JSON.stringify({ error: "tavily_api_error", status: pollRes.status, message: detail || pollRes.statusText }, null, 2),
                  }],
                  details: {},
                };
              }

              const pollData = await pollRes.json() as Record<string, unknown>;

              if (pollData.status === "completed" || pollData.output) {
                const tookMs = Date.now() - start;
                const payload = { ...pollData, provider: "tavily", tookMs };
                api.logger.info(`tavily research: "${input.slice(0, 60)}" completed in ${tookMs}ms`);
                return {
                  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
                  details: {},
                };
              }

              if (pollData.status === "failed" || pollData.status === "error") {
                api.logger.warn(`tavily research: task failed: ${JSON.stringify(pollData)}`);
                return {
                  content: [{
                    type: "text" as const,
                    text: JSON.stringify({ error: "tavily_research_failed", ...pollData }, null, 2),
                  }],
                  details: {},
                };
              }
              // still pending — continue polling
            }

            // Timeout
            const tookMs = Date.now() - start;
            api.logger.warn(`tavily research: timed out after ${tookMs}ms for "${input.slice(0, 60)}"`);
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  error: "tavily_research_timeout",
                  message: `Research task ${requestId} still pending after ${Math.round(tookMs / 1000)}s. Try again later.`,
                  requestId,
                }, null, 2),
              }],
              details: {},
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            api.logger.warn(`tavily research: fetch error: ${msg}`);
            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({ error: "tavily_fetch_error", message: msg }, null, 2),
              }],
              details: {},
            };
          }
        },
      },
      { source: "openclaw-tavily" },
    );

    api.registerService({
      id: "openclaw-tavily",
      start: () => api.logger.info("tavily: service started"),
      stop: () => {
        SEARCH_CACHE.clear();
        api.logger.info("tavily: service stopped, cache cleared");
      },
    });
  },
};

export default tavilyPlugin;
