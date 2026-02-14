/**
 * openclaw-tavily — Tavily web search plugin for OpenClaw
 *
 * Exposes a `tavily_search` tool that calls the Tavily Search API v2.
 * Returns structured results (title, url, snippet, optional raw content)
 * plus an optional AI-generated short answer.
 *
 * API reference: https://docs.tavily.com/documentation/api-reference/search
 *
 * Config (openclaw.json → plugins.entries.openclaw-tavily.config):
 *   apiKey            - Tavily API key (or set TAVILY_API_KEY env var)
 *   searchDepth       - "basic" | "advanced" (default: "advanced")
 *   maxResults        - 1-20 (default: 5)
 *   includeAnswer     - boolean (default: true)
 *   includeRawContent - boolean (default: false)
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

function resolveSearchDepth(cfg: Record<string, unknown>): "basic" | "advanced" {
  const v = typeof cfg.searchDepth === "string" ? cfg.searchDepth.trim().toLowerCase() : "";
  return v === "basic" ? "basic" : DEFAULT_SEARCH_DEPTH;
}

function resolveMaxResults(cfg: Record<string, unknown>): number {
  const v = typeof cfg.maxResults === "number" ? cfg.maxResults : DEFAULT_MAX_RESULTS;
  return Math.max(1, Math.min(MAX_RESULTS_CAP, Math.floor(v)));
}

function resolveIncludeAnswer(cfg: Record<string, unknown>): boolean {
  return cfg.includeAnswer !== false; // default true
}

function resolveIncludeRawContent(cfg: Record<string, unknown>): boolean {
  return cfg.includeRawContent === true; // default false
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
        'Search depth: "basic" (fast, cheaper) or "advanced" (thorough). Default: from config.',
    }),
  ),
  include_answer: Type.Optional(
    Type.Boolean({
      description: "Include an AI-generated short answer. Default: from config.",
    }),
  ),
  include_raw_content: Type.Optional(
    Type.Boolean({
      description: "Include raw page content in results. Default: from config.",
    }),
  ),
  topic: Type.Optional(
    Type.String({
      description:
        'Category of search: "general" or "news". Default: "general".',
    }),
  ),
  days: Type.Optional(
    Type.Number({
      description:
        "Number of days back to search (only for topic=news). Default: 3.",
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
});

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const tavilyPlugin = {
  id: "openclaw-tavily",
  name: "Tavily Search",
  description:
    "Web search via Tavily API. Provides structured results with optional AI answers.",
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
            ["basic", "advanced"].includes(params.search_depth)
              ? (params.search_depth as "basic" | "advanced")
              : defaultSearchDepth;

          const includeAnswer =
            typeof params.include_answer === "boolean"
              ? params.include_answer
              : defaultIncludeAnswer;

          const includeRawContent =
            typeof params.include_raw_content === "boolean"
              ? params.include_raw_content
              : defaultIncludeRawContent;

          const topic =
            typeof params.topic === "string" &&
            ["general", "news"].includes(params.topic)
              ? params.topic
              : "general";

          const days =
            topic === "news" && typeof params.days === "number" && params.days > 0
              ? Math.floor(params.days)
              : undefined;

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

          // --- cache ---
          const cacheKey = [
            "tavily",
            query,
            count,
            searchDepth,
            includeAnswer,
            includeRawContent,
            topic,
            days ?? "default",
            (includeDomains ?? []).join(","),
            (excludeDomains ?? []).join(","),
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
            api_key: apiKey,
            search_depth: searchDepth,
            max_results: count,
            include_answer: includeAnswer,
            include_raw_content: includeRawContent,
            topic,
          };
          if (days !== undefined) body.days = days;
          if (includeDomains && includeDomains.length > 0)
            body.include_domains = includeDomains;
          if (excludeDomains && excludeDomains.length > 0)
            body.exclude_domains = excludeDomains;

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
              headers: { "Content-Type": "application/json" },
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
