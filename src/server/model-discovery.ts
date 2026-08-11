/**
 * Optional live model discovery via the Anthropic Models API.
 *
 * When an ANTHROPIC_API_KEY is available, GET /models merges the ids
 * returned by https://api.anthropic.com/v1/models into the static registry
 * list, so newly released models show up without a proxy release. Routing
 * already works without this (unknown `claude-*` ids pass through to the
 * CLI verbatim) — discovery only improves *listing* for clients that pick
 * models from GET /models.
 *
 * Without an API key (the common Claude Max subscription setup) discovery
 * is silently skipped and the static registry list is served.
 *
 * Disable explicitly with CLAUDE_PROXY_MODEL_DISCOVERY=off.
 */

const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models?limit=100";
const SUCCESS_TTL_MS = 60 * 60 * 1000; // re-check hourly
const FAILURE_TTL_MS = 5 * 60 * 1000; // back off 5 min after a failure

interface DiscoveryCache {
  ids: string[];
  expiresAt: number;
}

let cache: DiscoveryCache | null = null;
let inflight: Promise<string[]> | null = null;
let loggedFailure = false;

/** Sync snapshot of the last successful discovery (for /metrics labels). */
const discoveredLabels = new Set<string>();

export function discoveredLabelSet(): ReadonlySet<string> {
  return discoveredLabels;
}

function discoveryEnabled(): boolean {
  if ((process.env.CLAUDE_PROXY_MODEL_DISCOVERY || "").toLowerCase() === "off") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Return dynamically discovered Claude model ids, or [] when discovery is
 * unavailable. Never throws; failures are cached briefly and logged once.
 */
export async function discoverModels(): Promise<string[]> {
  if (!discoveryEnabled()) return [];
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.ids;
  if (inflight) return inflight;

  inflight = fetchModelIds()
    .then((ids) => {
      cache = { ids, expiresAt: Date.now() + SUCCESS_TTL_MS };
      for (const id of ids) discoveredLabels.add(id);
      loggedFailure = false;
      return ids;
    })
    .catch((err) => {
      if (!loggedFailure) {
        console.warn(`[model-discovery] Anthropic Models API unavailable, serving static model list: ${(err as Error).message}`);
        loggedFailure = true;
      }
      const ids = cache?.ids ?? [];
      cache = { ids, expiresAt: Date.now() + FAILURE_TTL_MS };
      return ids;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

async function fetchModelIds(): Promise<string[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(ANTHROPIC_MODELS_URL, {
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY as string,
        "anthropic-version": "2023-06-01",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Array<{ id?: string }> };
    return (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.startsWith("claude-"));
  } finally {
    clearTimeout(timer);
  }
}

/** Test hook — reset the module-level cache. */
export function resetModelDiscoveryCache(): void {
  cache = null;
  inflight = null;
  loggedFailure = false;
  discoveredLabels.clear();
}
