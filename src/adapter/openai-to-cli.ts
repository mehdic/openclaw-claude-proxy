/**
 * Converts OpenAI chat request format to Claude CLI input
 */

import type { OpenAIChatRequest, OpenAIMessageContent } from "../types/openai.js";
import { toolDefsToPrompt, toolResultToPrompt, assistantToolCallsToPrompt, shouldBridgeExternalTools, externalNativeToolDisallowList } from "./tools.js";
import { isPassthroughModelId, registryEntry, stripProviderPrefix } from "../models.js";

export type ClaudeModel = "opus" | "sonnet" | "haiku" | string;

export interface CliInput {
  prompt: string;
  model: ClaudeModel;
  sessionId?: string;
  disallowedTools?: string[];
}

// Short aliases the Claude CLI resolves itself (always to the latest model
// of that family for the account's subscription).
const SHORT_ALIASES = new Set(["opus", "sonnet", "haiku"]);

/**
 * Extract Claude model alias from request model string.
 *
 * Resolution order:
 *   1. Short aliases (opus/sonnet/haiku) pass through — the CLI resolves them.
 *   2. Registry ids (with or without a claude-proxy/ or claude-code-cli/
 *      prefix) resolve to their configured `claude --model` target.
 *   3. Unknown-but-plausible `claude-*` ids pass through verbatim, so newly
 *      released models are routable without a proxy release.
 *   4. Everything else defaults to opus (Claude Max subscription).
 */
export function extractModel(model: string): ClaudeModel {
  const stripped = stripProviderPrefix(model);

  if (SHORT_ALIASES.has(stripped)) {
    return stripped;
  }

  const entry = registryEntry(stripped);
  if (entry) {
    return entry.cliTarget;
  }

  if (isPassthroughModelId(stripped)) {
    return stripped;
  }

  // Default to opus (Claude Max subscription)
  return "opus";
}

/**
 * Extract text from OpenAI message content (handles string, array, and null)
 */
function extractContentText(content: OpenAIMessageContent): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    return content
      .filter((part): part is typeof part & { text: string } =>
        part.type === "text" && typeof part.text === "string"
      )
      .map((part) => part.text)
      .join("\n");
  }
  return String(content);
}

/**
 * Convert OpenAI messages array to a single prompt string for Claude CLI
 *
 * Claude Code CLI in --print mode expects a single prompt, not a conversation.
 * We format the messages into a readable format that preserves context.
 *
 * When external tools are provided, injects tool definitions into the prompt
 * and converts tool-result messages into Claude-readable context.
 */
export function messagesToPrompt(
  messages: OpenAIChatRequest["messages"],
  req?: Pick<OpenAIChatRequest, "tools" | "tool_choice">,
): string {
  const parts: string[] = [];

  // Inject external caller-dispatched tool definitions as a system block.
  if (req && shouldBridgeExternalTools(req)) {
    parts.push(`<system>\n${toolDefsToPrompt(req)}\n</system>\n`);
  }

  for (const msg of messages) {
    switch (msg.role) {
      case "system":
      case "developer": {
        const text = extractContentText(msg.content);
        if (!text) continue;
        parts.push(`<system>\n${text}\n</system>\n`);
        break;
      }

      case "user": {
        const text = extractContentText(msg.content);
        if (!text) continue;
        parts.push(text);
        break;
      }

      case "assistant": {
        // If assistant previously made tool_calls, reproduce them as JSON
        // so Claude sees what it requested.
        const tcBlock = assistantToolCallsToPrompt(msg);
        const text = extractContentText(msg.content);
        const combined = [text, tcBlock].filter(Boolean).join("\n");
        if (!combined) continue;
        parts.push(`<previous_response>\n${combined}\n</previous_response>\n`);
        break;
      }

      case "tool": {
        // Tool result from the external caller
        parts.push(toolResultToPrompt(msg));
        break;
      }
    }
  }

  return parts.join("\n").trim();
}

/**
 * Convert OpenAI chat request to CLI input format
 */
export function openaiToCli(request: OpenAIChatRequest): CliInput {
  const disallowedTools = externalNativeToolDisallowList(request);
  return {
    prompt: messagesToPrompt(request.messages, request),
    model: extractModel(request.model),
    sessionId: request.user, // Use OpenAI's user field for session mapping
    ...(disallowedTools.length > 0 ? { disallowedTools } : {}),
  };
}
