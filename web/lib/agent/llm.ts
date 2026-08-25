// Chat model client for the agent runtime.
//
// Chat Completions (not the Responses API) on purpose: function calling over
// `/v1/chat/completions` is the portable subset every OpenAI-compatible
// provider implements, so pointing LIXTO_LLM_BASE_URL at OpenRouter/Groq/etc.
// is a config change, not a code change. Env names match the Python side
// (src/lixto/settings.py) so one .env drives both runtimes.

import OpenAI from "openai";

export const CHAT_MODEL = process.env.LIXTO_CHAT_MODEL ?? "gpt-5-mini";

/** Built per call, not at module load: the route is `runtime = "nodejs"` and
 * reading env lazily keeps `next build` from needing a key. */
export function getChatClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.LIXTO_LLM_API_KEY ?? process.env.OPENAI_API_KEY,
    baseURL: process.env.LIXTO_LLM_BASE_URL || undefined,
  });
}
