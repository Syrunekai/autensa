/**
 * Per-model capability definitions, consulted by llm.ts before building a
 * request. Models with an entry are validated client-side before the request
 * is sent; models without an entry are not validated and any configured
 * value is passed through to the provider.
 */

export const EFFORT_FULL = ['none', 'low', 'medium', 'high', 'xhigh', 'max'];

export interface ModelDef {
  /** Case-insensitive substring of the model ID (host prefixes tolerated). */
  match: string;
  /** Allowed reasoning_effort values for this model. */
  efforts: string[];
}

export const MODEL_DEFS: ModelDef[] = [
  // GPT-5.6 family
  { match: 'gpt-5.6-sol',   efforts: EFFORT_FULL },
  { match: 'gpt-5.6-terra', efforts: ['none', 'low', 'medium', 'high', 'xhigh'] },
  { match: 'gpt-5.6-luna',  efforts: ['none', 'low', 'medium', 'high'] },
  // GPT-5.5
  { match: 'gpt-5.5',       efforts: EFFORT_FULL },
  // GPT-5.4 family
  { match: 'gpt-5.4-mini',  efforts: ['none', 'low', 'medium', 'high', 'xhigh'] },
  { match: 'gpt-5.4-nano',  efforts: ['none', 'low', 'medium', 'high'] },
  { match: 'gpt-5.4',       efforts: EFFORT_FULL },
];

/**
 * Case-insensitive substring match on the model ID, longest match first, so
 * more specific patterns ("gpt-5.4-mini") take precedence over shorter ones
 * ("gpt-5.4") and host-prefixed IDs still match.
 */
export function findModelDef(modelId: string): ModelDef | undefined {
  const id = modelId.toLowerCase();
  return [...MODEL_DEFS]
    .sort((a, b) => b.match.length - a.match.length)
    .find(def => id.includes(def.match));
}
