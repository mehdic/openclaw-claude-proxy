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

test("OpenAI response model prefers the requested model when Claude reports multiple modelUsage entries", () => {
  const result = annotateClaudeUsage({
    ...resultFixture(),
    modelUsage: {
      "claude-haiku-4-5-20251001": {
        inputTokens: 537,
        outputTokens: 12,
        costUSD: 0.000597,
      },
      "claude-sonnet-4-6": {
        inputTokens: 3,
        outputTokens: 14,
        costUSD: 0.0484512,
      },
    },
  }, "claude-sonnet-4-6");
  const response = cliResultToOpenai(result, "req1", {
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hi" }],
  } as Parameters<typeof cliResultToOpenai>[2]);

  assert.equal(response.model, "claude-sonnet-4");
  assert.equal(response.usage.cost?.model, "claude-sonnet-4-6");
});

test("usage model selection prefers requested model when modelUsage contains warmup entries first", () => {
  const result: ClaudeCliResult = {
    ...resultFixture(),
    modelUsage: {
      "claude-haiku-4-5-20251001": {
        inputTokens: 537,
        outputTokens: 12,
        costUSD: 0.000597,
      },
      "claude-sonnet-4-6": {
        inputTokens: 3,
        outputTokens: 14,
        costUSD: 0.0484512,
      },
    },
  };

  assert.equal(modelFromResult(result, "claude-sonnet-4-6"), "claude-sonnet-4-6");
});

test("final streaming chunk can carry usage when include_usage-compatible clients ask for it", () => {
  const result = annotateClaudeUsage(resultFixture(), "claude-sonnet-4-6");
  const chunk = createDoneChunk("req1", "claude-sonnet-4-6", resultUsageToOpenAI(result));

  assert.equal(chunk.choices[0].finish_reason, "stop");
  assert.equal(chunk.usage?.prompt_tokens, 1_300);
  assert.equal(chunk.usage?.cost?.model, "claude-sonnet-4-6");
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
