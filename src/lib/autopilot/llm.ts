/**
 * Lightweight LLM completion via OpenClaw Gateway's OpenAI-compatible endpoint.
 * Uses /v1/chat/completions for stateless prompt→response (no agent sessions).
 */

import { findModelDef } from './model-definitions';

const DEFAULT_TIMEOUT_SECONDS = 900; // 15 minutes
const DEFAULT_MAX_OUTPUT_TOKENS = 32_768; // 32K
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5_000; // 5s, 10s, 20s exponential backoff
const OPENCLAW_GATEWAY_MODEL = process.env.OPENCLAW_GATEWAY_MODEL || 'openclaw/default';

function getGatewayUrl(): string {
  return process.env.OPENCLAW_GATEWAY_URL?.replace('ws://', 'http://').replace('wss://', 'https://') || 'http://127.0.0.1:18789';
}

function getGatewayToken(): string {
  return process.env.OPENCLAW_GATEWAY_TOKEN || '';
}

function getDefaultModel(): string {
  return OPENCLAW_GATEWAY_MODEL;
}

function resolveGatewayModel(model: string): { gatewayModel: string; modelOverride: string | null } {
  if (model === 'openclaw' || model.startsWith('openclaw/')) {
    return { gatewayModel: model, modelOverride: null };
  }

  return { gatewayModel: OPENCLAW_GATEWAY_MODEL, modelOverride: model };
}

/**
 * Max output (completion) tokens per call, from LLM_MAX_OUTPUT_TOKENS.
 * 0 / unset / invalid falls back to DEFAULT_MAX_OUTPUT_TOKENS (never unlimited).
 */
function getConfiguredMaxTokens(): number {
  const n = parseInt(process.env.LLM_MAX_OUTPUT_TOKENS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Max wall-clock time per call, from LLM_REQUEST_TIMEOUT_SECONDS (seconds).
 * 0 / unset / invalid falls back to DEFAULT_TIMEOUT_SECONDS (never unlimited). Returns ms.
 */
function getConfiguredTimeoutMs(): number {
  const s = parseInt(process.env.LLM_REQUEST_TIMEOUT_SECONDS ?? '', 10);
  const seconds = Number.isFinite(s) && s > 0 ? s : DEFAULT_TIMEOUT_SECONDS;
  return seconds * 1000;
}

/**
 * Response streaming, from LLM_STREAM. Defaults to true when unset;
 * "false"/"0"/"off"/"no" (case-insensitive) disables it.
 */
function getConfiguredStream(): boolean {
  const raw = (process.env.LLM_STREAM ?? '').trim().toLowerCase();
  if (raw === '') return true;
  return !['false', '0', 'off', 'no'].includes(raw);
}

/**
 * Optional sampling temperature, from LLM_TEMPERATURE. Returns undefined when
 * unset, empty, or non-numeric (logged); undefined omits the field from the
 * request. 0 is a valid value.
 */
function getConfiguredTemperature(): number | undefined {
  const raw = process.env.LLM_TEMPERATURE;
  if (raw === undefined || raw.trim() === '') return undefined;
  const v = Number(raw);
  if (!Number.isFinite(v)) {
    console.warn(`[LLM] Ignoring invalid LLM_TEMPERATURE="${raw}" — omitting temperature`);
    return undefined;
  }
  return v;
}

/**
 * Optional reasoning effort, from LLM_REASONING_EFFORT. Returns undefined
 * when unset or empty; undefined omits the field from the request. Values
 * are validated against model-definitions.ts entries in complete().
 */
function getConfiguredReasoningEffort(): string | undefined {
  const raw = process.env.LLM_REASONING_EFFORT;
  if (raw === undefined || raw.trim() === '') return undefined;
  return raw.trim();
}

export interface CompletionOptions {
  model?: string;
  systemPrompt?: string;
  /** Sampling temperature. Unset → omitted from the request (provider default). */
  temperature?: number;
  /** Reasoning/thinking effort (e.g. "low", "high"). Unset → omitted from the request. */
  reasoningEffort?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface CompletionResult {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Send a prompt and get a completion response.
 * Uses the Gateway's /v1/chat/completions endpoint — stateless, no agent session.
 */
export async function complete(prompt: string, options: CompletionOptions = {}): Promise<CompletionResult> {
  const {
    model = getDefaultModel(),
    systemPrompt,
    maxTokens = getConfiguredMaxTokens(),
    timeoutMs = getConfiguredTimeoutMs(),
  } = options;
  // Precedence: per-call option, then env, then omit. ?? preserves an explicit 0.
  const temperature = options.temperature ?? getConfiguredTemperature();
  const reasoningEffort = options.reasoningEffort ?? getConfiguredReasoningEffort();
  const useStream = getConfiguredStream();
  const { gatewayModel, modelOverride } = resolveGatewayModel(model);
  const effectiveModel = modelOverride || gatewayModel;

  // Validate reasoning effort against the model definition, if one exists.
  // Models without a definition are not validated client-side.
  if (reasoningEffort !== undefined) {
    const def = findModelDef(effectiveModel);
    if (def && !def.efforts.includes(reasoningEffort)) {
      throw new Error(
        `[LLM] Misconfiguration: model "${effectiveModel}" does not support reasoning_effort ` +
        `"${reasoningEffort}" (supported: ${def.efforts.join(', ')}). ` +
        `Fix LLM_REASONING_EFFORT or the model.`
      );
    }
  }

  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`[LLM] Retry ${attempt}/${MAX_RETRIES} after ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    const controller = new AbortController();
    let timeout = setTimeout(() => controller.abort(), timeoutMs);
    // Streaming mode re-arms this timer on every chunk received, making
    // timeoutMs an idle timeout rather than a total-duration limit.
    // Buffered mode never re-arms it, so timeoutMs caps total duration.
    const armTimer = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => controller.abort(), timeoutMs);
    };

    try {
      const response = await fetch(`${getGatewayUrl()}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getGatewayToken()}`,
          ...(modelOverride ? { 'x-openclaw-model': modelOverride } : {}),
        },
        body: JSON.stringify({
          model: gatewayModel,
          messages,
          max_tokens: maxTokens,
          // Optional fields are omitted entirely when undefined; some APIs
          // reject requests that include them.
          ...(temperature !== undefined && { temperature }),
          ...(reasoningEffort !== undefined && { reasoning_effort: reasoningEffort }),
          ...(useStream && { stream: true, stream_options: { include_usage: true } }),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM completion failed (${response.status}): ${errorText}`);
      }

      if (!useStream) {
        // Buffered mode: parse the complete JSON response.
        const data = await response.json() as {
          model: string;
          choices: Array<{ message: { content: string } }>;
          usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        };

        const content = data.choices?.[0]?.message?.content || '';
        const resolvedModel = modelOverride || data.model || gatewayModel;

        console.log(`[LLM] Response usage:`, JSON.stringify(data.usage || null), `model: ${resolvedModel}`);

        return {
          content,
          model: resolvedModel,
          usage: {
            promptTokens: data.usage?.prompt_tokens || 0,
            completionTokens: data.usage?.completion_tokens || 0,
            totalTokens: data.usage?.total_tokens || 0,
          },
        };
      }

      // Streaming mode: accumulate SSE deltas into a single result.
      if (!response.body) {
        throw new Error('LLM streaming response had no body');
      }

      let content = '';
      let finish: string | null = null;
      let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
      let modelRet: string | undefined;
      let buffer = '';
      let sawDone = false;
      const decoder = new TextDecoder();
      const reader = response.body.getReader();

      while (!sawDone) {
        const { done: readDone, value } = await reader.read();
        if (readDone) break;
        armTimer(); // reset the idle timeout
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // retain any partial trailing line
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') { sawDone = true; break; }
          let ev: {
            model?: string;
            usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            choices?: Array<{ finish_reason?: string | null; delta?: { content?: string } }>;
          };
          try { ev = JSON.parse(payload); } catch { continue; } // skip non-JSON lines
          if (ev.usage) usage = ev.usage;
          if (ev.model) modelRet = ev.model;
          for (const choice of ev.choices ?? []) {
            if (choice.finish_reason) finish = choice.finish_reason;
            if (choice.delta?.content) content += choice.delta.content;
          }
        }
      }

      const resolvedModel = modelOverride || modelRet || gatewayModel;
      console.log(`[LLM] Streamed usage:`, JSON.stringify(usage ?? null), `model: ${resolvedModel} finish: ${finish}`);

      return {
        content,
        model: resolvedModel,
        usage: {
          promptTokens: usage?.prompt_tokens || 0,
          completionTokens: usage?.completion_tokens || 0,
          totalTokens: usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isAbort = lastError.name === 'AbortError' || lastError.message.includes('aborted');
      const isNetwork = lastError.message.includes('fetch failed') || lastError.message.includes('ECONNREFUSED') || lastError.message.includes('ECONNRESET');
      // 502/503/504 gateway responses are retried; other non-2xx are not.
      const isGateway5xx = /LLM completion failed \((?:502|503|504)\)/.test(lastError.message);

      if (isAbort || isNetwork || isGateway5xx) {
        console.error(`[LLM] Attempt ${attempt + 1} failed (${isAbort ? 'timeout/abort' : isNetwork ? 'network' : 'gateway 5xx'}): ${lastError.message}`);
        continue; // retry
      }

      // Non-retryable error (e.g. 400 bad request, parse error)
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('LLM completion failed after retries');
}

/**
 * Send a prompt and parse the response as JSON.
 * Handles markdown code blocks and embedded JSON.
 */
export async function completeJSON<T = unknown>(prompt: string, options: CompletionOptions = {}): Promise<{ data: T; raw: string; model: string; usage: CompletionResult['usage'] }> {
  const result = await complete(prompt, options);

  // Try direct parse
  try {
    return { data: JSON.parse(result.content.trim()) as T, raw: result.content, model: result.model, usage: result.usage };
  } catch {
    // Continue
  }

  // Try markdown code block
  const codeBlockMatch = result.content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return { data: JSON.parse(codeBlockMatch[1].trim()) as T, raw: result.content, model: result.model, usage: result.usage };
    } catch {
      // Continue
    }
  }

  // Try first { to last }
  const firstBrace = result.content.indexOf('{');
  const lastBrace = result.content.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return { data: JSON.parse(result.content.slice(firstBrace, lastBrace + 1)) as T, raw: result.content, model: result.model, usage: result.usage };
    } catch {
      // Continue
    }
  }

  // Try first [ to last ]
  const firstBracket = result.content.indexOf('[');
  const lastBracket = result.content.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return { data: JSON.parse(result.content.slice(firstBracket, lastBracket + 1)) as T, raw: result.content, model: result.model, usage: result.usage };
    } catch {
      // Continue
    }
  }

  throw new Error(`Failed to parse JSON from LLM response. Raw content (first 500 chars): ${result.content.slice(0, 500)}`);
}
