import { mkdir, readFile, readdir, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// This publishing batch uses the existing ChatGPT/Codex login, never API credits.
delete process.env.OPENAI_API_KEY;
const { research } = await import('../lib/research.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'public/data');
const local = path.join(root, 'runtime/maps');
const publications = [
  ['polska-press', 'Polska Press', ['polskapress']],
  ['the-guardian', 'The Guardian', ['Guardian']],
  ['reuters', 'Reuters', []],
  ['associated-press', 'Associated Press', ['AP', 'The Associated Press']],
  ['bbc', 'BBC', ['BBC News', 'British Broadcasting Corporation']],
  ['financial-times', 'Financial Times', ['FT', 'The Financial Times']],
  ['the-economist', 'The Economist', ['Economist']],
  ['new-york-times', 'The New York Times', ['NYT', 'New York Times']],
  ['washington-post', 'The Washington Post', ['Washington Post', 'WaPo']],
  ['wall-street-journal', 'The Wall Street Journal', ['WSJ', 'Wall Street Journal']],
  ['cnn', 'CNN', ['Cable News Network']],
  ['fox-news', 'Fox News', ['Fox News Channel']],
  ['le-monde', 'Le Monde', []],
  ['le-figaro', 'Le Figaro', []],
  ['der-spiegel', 'Der Spiegel', ['Spiegel']],
  ['el-pais', 'El País', ['El Pais']],
  ['gazeta-wyborcza', 'Gazeta Wyborcza', ['Wyborcza']],
  ['nature', 'Nature', ['Nature (journal)'], 'academic'],
  ['science', 'Science', ['Science (journal)', 'Science Magazine'], 'academic'],
  ['the-lancet', 'The Lancet', ['Lancet'], 'academic']
];
const key = text => text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '');
await mkdir(output, { recursive: true });
await mkdir(local, { recursive: true });
const saved = await Promise.all((await readdir(local)).filter(n => n.endsWith('.json')).map(n => readFile(path.join(local, n), 'utf8').then(JSON.parse)));
const catalog = new Map(); const failed = []; let next = 0;

async function publish(spec) {
  const [slug, name, aliases, kind = 'news'] = spec;
  const target = path.join(output, `${slug}.json`);
  let graph = await readFile(target, 'utf8').then(JSON.parse).catch(() => null);
  if (!graph) graph = saved.find(g => [name, ...aliases].some(v => key(v) === key(g.query)) && Date.now() - Date.parse(g.researchedAt) < 2 * 86400000);
  if (graph) console.log(`${name}: reusing dated research`);
  else {
    console.log(`${name}: starting research`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8 * 60000);
    try {
      const query = kind === 'academic' ? `${name} (academic journal)` : name;
      graph = await research({ query, kind, depth: 3 }, path.join(root, 'runtime/catalog-jobs', slug),
        message => console.log(`${name}: ${message}`), controller.signal);
      graph.id = randomUUID();
      await writeFile(path.join(local, `${graph.id}.json`), JSON.stringify(graph, null, 2));
    } finally { clearTimeout(timer); }
  }
  if (!graph.nodes?.length || !graph.edges?.length || !graph.nodes.some(n => n.id === graph.rootId)) throw new Error('No usable, supported chain returned');
  graph.query = name;
  graph.publishedSnapshot = true;
  graph.edges.forEach(e => { e.status = 'pending'; e.reviewedAt = null; });
  await writeFile(`${target}.tmp`, JSON.stringify(graph, null, 2) + '\n');
  await rename(`${target}.tmp`, target);
  catalog.set(slug, { id: graph.id, slug, name, aliases, researchedAt: graph.researchedAt });
  console.log(`${name}: saved ${graph.nodes.length} entities / ${graph.edges.length} connections (${catalog.size}/20)`);
}

await Promise.all([0, 1].map(async () => {
  while (next < publications.length) {
    const spec = publications[next++];
    try { await publish(spec); }
    catch (error) { failed.push(spec[1]); console.error(`${spec[1]}: FAILED: ${error.message}`); }
  }
}));

if (failed.length) { console.error('Incomplete:', failed.join(', ')); process.exitCode = 1; }
else {
  const entries = publications.map(([slug]) => catalog.get(slug));
  await writeFile(path.join(output, 'catalog.json'), JSON.stringify({ liveResearch: false, maps: entries }, null, 2) + '\n');
  console.log('Catalog complete: 20 publication maps.');
}
