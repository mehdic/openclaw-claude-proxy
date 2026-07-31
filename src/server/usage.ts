import type { ClaudeCliResult } from "../types/claude-cli.js";
import { estimateCost, normalizeModel, type ClaudeTokenUsageBreakdown } from "./pricing.js";

export function annotateClaudeUsage(result: ClaudeCliResult, requestedModel: string): ClaudeCliResult {
  const usage = usageFromClaudeResult(result);
  const model = modelFromResult(result, requestedModel);
  result.usageEstimated = false;
  result.usageEstimateMethod = "claude_cli_usage";
  result.cost = estimateCost(model, usage);
  return result;
}

export function usageFromClaudeResult(result: ClaudeCliResult): ClaudeTokenUsageBreakdown {
  const inputTokens = Math.max(0, result.usage?.input_tokens || 0);
  const cacheCreationInputTokens = Math.max(0, result.usage?.cache_creation_input_tokens || 0);
  const cachedInputTokens = Math.max(0, result.usage?.cache_read_input_tokens || 0);
  const outputTokens = Math.max(0, result.usage?.output_tokens || 0);
  return {
    inputTokens,
    cacheCreationInputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens: inputTokens + cacheCreationInputTokens + cachedInputTokens + outputTokens,
  };
}

/**
 * Pick the model that actually carried the turn out of `modelUsage`.
 *
 * `modelUsage` is a dict the Claude CLI returns with one entry per model used during the
 * turn, in insertion order (not priority order). Occasionally the CLI makes a small internal
 * side call (e.g. `claude-haiku-4-5`) in addition to the actual response call. If that side
 * call's key happens to land before the main call's key, `Object.keys(modelUsage)[0]` used to
 * report the side model even though the main call (usually 90%+ of the tokens/cost) produced
 * the response. Two criteria, in this order:
 *   1. If the requested model is present in the dict, use it -- this reliably answers the
 *      question the caller actually asked, independent of any side calls.
 *   2. Otherwise, the entry with the highest cost (falling back to token count if cost is
 *      absent or zero for every entry). Cost is the more reliable signal here: `inputTokens`/
 *      `outputTokens` do NOT include cache-read/cache-creation activity, so a cache-heavy main
 *      call can show a *smaller* raw token count than a small uncached side call while still
 *      accounting for the overwhelming majority of the actual cost.
 */
export function pickModelFromUsage(
  modelUsage: ClaudeCliResult["modelUsage"] | undefined,
  requestedModel: string,
): string {
  if (!modelUsage) return "";
  const keys = Object.keys(modelUsage);
  if (keys.length === 0) return "";
  if (requestedModel && Object.prototype.hasOwnProperty.call(modelUsage, requestedModel)) {
    return requestedModel;
  }
  let bestKey = keys[0];
  let bestScore = -1;
  for (const key of keys) {
    const entry = modelUsage[key] || { inputTokens: 0, outputTokens: 0, costUSD: 0 };
    const cost = entry.costUSD || 0;
    const tokens = (entry.inputTokens || 0) + (entry.outputTokens || 0);
    const score = cost > 0 ? cost : tokens;
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  return bestKey;
}

export function modelFromResult(result: ClaudeCliResult, requestedModel: string): string {
  const modelUsageModel = pickModelFromUsage(result.modelUsage, requestedModel);
  return normalizeModel(modelUsageModel || requestedModel);
}
