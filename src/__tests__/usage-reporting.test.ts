import test from "node:test";
import assert from "node:assert/strict";
import { cliResultToOpenai, createDoneChunk, resultUsageToOpenAI } from "../adapter/cli-to-openai.js";
import { annotateClaudeUsage, modelFromResult, usageFromClaudeResult } from "../server/usage.js";
import { recordTokenUsage, renderMetrics, resetMetrics } from "../server/metrics.js";
import type { ClaudeCliResult } from "../types/claude-cli.js";

function resultFixture(): ClaudeCliResult {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 100,
    duration_api_ms: 90,
    num_turns: 1,
    result: "OK",
    session_id: "s",
    total_cost_usd: 0,
    usage: {
      input_tokens: 1_000,
      cache_creation_input_tokens: 100,
      cache_read_input_tokens: 200,
      output_tokens: 50,
    },
    modelUsage: {
      "claude-sonnet-4-6-20260217": {
        inputTokens: 1_000,
        outputTokens: 50,
        costUSD: 0,
      },
    },
  };
}

test("annotates OpenAI usage with estimated Claude cost", () => {
  const result = annotateClaudeUsage(resultFixture(), "claude-sonnet-4-6");
  const response = cliResultToOpenai(result, "req1");

  assert.equal(response.usage.prompt_tokens, 1_300);
  assert.equal(response.usage.completion_tokens, 50);
  assert.equal(response.usage.total_tokens, 1_350);
  assert.equal(response.usage.estimated, false);
  assert.equal(response.usage.estimate_method, "claude_cli_usage");
  assert.equal(response.usage.cost_usd, response.usage.cost?.total_cost_usd);
  assert.equal(response.usage.cost?.model, "claude-sonnet-4-6");
});

test("final streaming chunk can carry usage when include_usage-compatible clients ask for it", () => {
  const result = annotateClaudeUsage(resultFixture(), "claude-sonnet-4-6");
  const chunk = createDoneChunk("req1", "claude-sonnet-4-6", resultUsageToOpenAI(result));

  assert.equal(chunk.choices[0].finish_reason, "stop");
  assert.equal(chunk.usage?.prompt_tokens, 1_300);
  assert.equal(chunk.usage?.cost?.model, "claude-sonnet-4-6");
});

test("modelFromResult picks the requested model, not the first modelUsage key", () => {
  // Regression test: the Claude CLI occasionally makes a small internal side call (e.g.
  // claude-haiku-4-5) in addition to the actual response call. modelUsage is a dict in
  // insertion order, so the side call's key can land before the main call's key.
  // Object.keys(modelUsage)[0] used to report the side model even though the main call
  // (here: 97%+ of the cost) produced the response.
  const result: ClaudeCliResult = {
    ...resultFixture(),
    modelUsage: {
      "claude-haiku-4-5-20251001": { inputTokens: 532, outputTokens: 12, costUSD: 0.000592 },
      "claude-sonnet-4-6": { inputTokens: 2, outputTokens: 7, costUSD: 0.0205011 },
    },
  };

  assert.equal(modelFromResult(result, "claude-sonnet-4-6"), "claude-sonnet-4-6");

  const response = cliResultToOpenai(result, "req1", undefined, "claude-sonnet-4-6");
  assert.equal(response.model, "claude-sonnet-4");
});

test("modelFromResult falls back to the biggest modelUsage entry when the requested model is absent", () => {
  const result: ClaudeCliResult = {
    ...resultFixture(),
    modelUsage: {
      "claude-haiku-4-5-20251001": { inputTokens: 532, outputTokens: 12, costUSD: 0.000592 },
      "claude-sonnet-4-6": { inputTokens: 2, outputTokens: 7, costUSD: 0.0205011 },
    },
  };

  // Requested model is not a key in modelUsage at all -- fall back to the entry with the
  // highest cost (sonnet: $0.0205 vs haiku: $0.0006) instead of Object.keys()[0]. Cost is
  // used over raw token count here because inputTokens/outputTokens do not include the
  // cache-read/cache-creation activity that made the sonnet call expensive in the first place.
  assert.equal(modelFromResult(result, "claude-opus-5"), "claude-sonnet-4-6");
});

test("token and estimated cost metrics are rendered with bounded labels", () => {
  resetMetrics();
  const result = annotateClaudeUsage(resultFixture(), "custom-user-model");
  recordTokenUsage("custom-user-model", usageFromClaudeResult(result), result.cost, false);

  const rendered = renderMetrics();
  assert.match(rendered, /claude_proxy_tokens_total\{direction="input",estimated="false",model="other"\} 1000/);
  assert.match(rendered, /claude_proxy_tokens_total\{direction="cache_creation_input",estimated="false",model="other"\} 100/);
  assert.match(rendered, /claude_proxy_estimated_cost_usd_total\{estimated="false",model="other"\} /);
  assert.doesNotMatch(rendered, /custom-user-model/);
});
