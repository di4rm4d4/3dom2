import { schema, normalizeGraph } from '../lib/schema.mjs';
import { promptFor } from '../lib/research-prompt.mjs';

export class PublicError extends Error {
  constructor(message, status = 502, uncertain = false) { super(message); this.status = status; this.uncertain = uncertain; }
}

// Only this fixed origin receives the secret. Provider diagnostics never reach the browser.
export async function providerRequest(env, path = '', body, send = fetch) {
  let response;
  try {
    response = await send(`https://api.openai.com/v1/responses${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
  } catch { throw new PublicError('The research service could not be reached. Please try again later.', 502, true); }
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new PublicError('Research is unavailable. The site owner needs to check the API key and model access.', 503);
    if (response.status === 429) throw new PublicError('The research service has reached its account limit. Please try again later.', 503);
    throw new PublicError('The research service could not complete this request. Please try again later.', 502, response.status >= 500);
  }
  let result;
  try { result = await response.json(); } catch { throw new PublicError('The research service returned invalid data. Please try again later.', 502, true); }
  if (!result || !/^resp_[\w-]+$/.test(result.id || '') || !['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete'].includes(result.status)) {
    throw new PublicError('The research service returned an incomplete response. Please try again later.', 502, true);
  }
  return result;
}

export function researchBody(options, env) {
  return {
    model: env.OPENAI_MODEL || 'gpt-5.4-mini', background: true, store: false,
    input: promptFor(options), tools: [{ type: 'web_search' }],
    max_output_tokens: 6000, max_tool_calls: 12,
    text: { format: { type: 'json_schema', name: 'ownership_graph', strict: true, schema } }
  };
}

export function resultGraph(result, options) {
  if (result.status === 'incomplete') throw new PublicError('Research reached its output limit. Try a more specific publication name.');
  if (result.status !== 'completed') throw new PublicError('Research could not finish. Please try again later.');
  const output = Array.isArray(result.output) ? result.output : [];
  const text = output.filter(v => v?.type === 'message').flatMap(v => Array.isArray(v.content) ? v.content : [])
    .filter(v => v?.type === 'output_text' && typeof v.text === 'string').map(v => v.text).join('');
  if (!text) throw new PublicError('Research returned no ownership data. Try including the publication’s country.');
  try {
    const graph = normalizeGraph(JSON.parse(text), options);
    // These citations came from AI research; cloud mode does not independently check excerpts.
    return graph;
  } catch { throw new PublicError('Research returned an invalid ownership map. Please try a more specific name.'); }
}
