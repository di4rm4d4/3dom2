const text = { type: 'string' };
const nullableText = { type: ['string', 'null'] };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const schema = object({
  rootId: text,
  title: text,
  summary: text,
  nodes: { type: 'array', items: object({
    id: text, name: text,
    type: { type: 'string', enum: ['publication', 'publisher', 'company', 'person', 'state', 'trust', 'fund', 'aggregate', 'unknown'] },
    description: text, country: nullableText, website: nullableText, wikidataId: nullableText,
    endpoint: { type: 'string', enum: ['continue', 'individual', 'state', 'dispersed_shareholders', 'unresolved', 'depth_limit'] },
    endpointNote: text
  }) },
  edges: { type: 'array', items: object({
    id: text, from: text, to: text,
    relationship: { type: 'string', enum: ['owned_by', 'parent_company', 'published_by', 'controlled_by', 'appointment_rights', 'managed_by'] },
    percentage: { type: ['number', 'null'] }, asOf: nullableText, description: text,
    evidence: { type: 'array', items: object({ url: text, title: text, excerpt: text,
      sourceType: { type: 'string', enum: ['primary', 'secondary'] }, publishedAt: nullableText }) }
  }) },
  gaps: { type: 'array', items: text }
});

export function safeURL(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.') || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) || host.includes(':') || /^[\d.]+$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}

// Model output is untrusted. The server owns IDs, review states and timestamps.
export function normalizeGraph(raw, { query, kind, depth }) {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !raw.nodes.length || raw.nodes.some(n => !n || typeof n !== 'object')) throw new Error('Research did not return a usable graph. Try a more specific publication name.');
  const clean = (v, length = 1000) => typeof v === 'string' ? v.trim().slice(0, length) : '';
  const nodeTypes = new Set(schema.properties.nodes.items.properties.type.enum);
  const edgeTypes = new Set(schema.properties.edges.items.properties.relationship.enum);
  const endpointTypes = new Set(schema.properties.nodes.items.properties.endpoint.enum);
  const seen = new Set();
  const nodes = raw.nodes.slice(0, 24).map((n, index) => {
    const id = clean(n.id, 80);
    if (!id || seen.has(id) || !clean(n.name)) throw new Error('Research returned ambiguous entity identifiers. Please try again.');
    seen.add(id);
    return { id, name: clean(n.name, 160), type: nodeTypes.has(n.type) ? n.type : 'unknown',
      description: clean(n.description), country: clean(n.country, 80) || null,
      website: safeURL(n.website), wikidataId: /^Q\d+$/.test(n.wikidataId) ? n.wikidataId : null,
      endpoint: endpointTypes.has(n.endpoint) ? n.endpoint : 'unresolved', endpointNote: clean(n.endpointNote), image: null };
  });
  if (!seen.has(raw.rootId)) throw new Error('The publication could not be identified reliably. Please include its country.');
  const duplicates = new Set();
  const edges = [];
  for (const e of raw.edges.slice(0, 48)) {
    if (!e || typeof e !== 'object') continue;
    if (!seen.has(e.from) || !seen.has(e.to) || e.from === e.to || !edgeTypes.has(e.relationship)) continue;
    const key = JSON.stringify([e.from, e.to, e.relationship, e.asOf]);
    if (duplicates.has(key)) continue;
    const evidence = (Array.isArray(e.evidence) ? e.evidence : []).filter(s => s && typeof s === 'object').slice(0, 3).map(s => ({ url: safeURL(s.url), title: clean(s.title, 240),
      excerpt: clean(s.excerpt, 800), sourceType: s.sourceType === 'primary' ? 'primary' : 'secondary',
      publishedAt: clean(s.publishedAt, 80) || null, accessedAt: new Date().toISOString(), validation: 'not_checked' })).filter(s => s.url);
    if (!evidence.length) continue;
    duplicates.add(key);
    edges.push({ id: `edge-${edges.length + 1}`, from: e.from, to: e.to, relationship: e.relationship,
      percentage: typeof e.percentage === 'number' && e.percentage >= 0 && e.percentage <= 100 ? e.percentage : null,
      asOf: clean(e.asOf, 80) || null, description: clean(e.description, 2000), evidence,
      status: 'pending', reviewedAt: null });
  }
  // Only keep the requested root and ancestors reachable within the selected bound.
  const reachable = new Set([raw.rootId]);
  for (let i = 0; i < depth; i++) {
    const previous = new Set(reachable);
    for (const e of edges) if (previous.has(e.from)) reachable.add(e.to);
  }
  const keptEdges = edges.filter(e => reachable.has(e.from) && reachable.has(e.to));
  const graph = { query, kind, depth, title: clean(raw.title, 200) || query, rootId: raw.rootId,
    summary: clean(raw.summary, 2000), nodes: nodes.filter(n => reachable.has(n.id)), edges: keptEdges,
    gaps: (Array.isArray(raw.gaps) ? raw.gaps : []).filter(v => typeof v === 'string').slice(0, 20).map(v => clean(v)),
    researchedAt: new Date().toISOString(), coverage: 'partial', engine: 'AI web research', revision: 1 };
  for (const node of graph.nodes) {
    if (!keptEdges.some(e => e.from === node.id) && node.endpoint === 'continue') {
      node.endpoint = 'unresolved'; node.endpointNote ||= 'No further supported relationship was returned within this research run.';
    }
  }
  if (!keptEdges.length) graph.gaps.push('No supported ownership or publishing relationship was found. This does not establish independence.');
  return graph;
}
