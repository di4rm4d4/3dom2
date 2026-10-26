import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { schema, normalizeGraph } from './schema.mjs';
import { promptFor } from './research-prompt.mjs';
import { checkEvidence, enrichImages } from './public-web.mjs';

export function findCodex() {
  if (process.env.CODEX_BIN && existsSync(process.env.CODEX_BIN)) return process.env.CODEX_BIN;
  const mac = '/Applications/ChatGPT.app/Contents/Resources/codex';
  if (existsSync(mac)) return mac;
  const result = spawnSync('which', ['codex'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}
export function providerStatus() {
  if (process.env.OPENAI_API_KEY) return { available: true, provider: 'OpenAI API', note: 'Searches use your configured API account.' };
  const bin = findCodex();
  if (bin) {
    const result = spawnSync(bin, ['login', 'status'], { encoding: 'utf8', timeout: 8000 });
    if (result.status === 0) return { available: true, provider: 'Local Codex', note: 'Live research uses your local Codex sign-in and account usage.' };
  }
  return { available: false, provider: null, note: 'Sign in with codex login, or set OPENAI_API_KEY on the server and restart.' };
}


async function apiResearch(prompt, progress, signal) {
  progress('Searching public ownership sources…');
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', signal,
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-6-astra', tools: [{ type: 'web_search' }],
      input: prompt, max_output_tokens: 14000, max_tool_calls: 20,
      text: { format: { type: 'json_schema', name: 'ownership_graph', strict: true, schema } } }) });
  if (!response.ok) throw new Error(`Research service returned ${response.status}. Check the server's API configuration or account allowance.`);
  const result = await response.json();
  const output = result.output?.filter(v => v.type === 'message').flatMap(v => v.content || []).filter(v => v.type === 'output_text').map(v => v.text).join('');
  if (!output) throw new Error('Research returned no structured result. Try again with the publication country included.');
  return JSON.parse(output);
}

async function codexResearch(prompt, directory, progress, signal) {
  await mkdir(directory, { recursive: true });
  const schemaPath = path.join(directory, 'schema.json');
  const outputPath = path.join(directory, 'result.json');
  await writeFile(schemaPath, JSON.stringify(schema));
  const args = ['--search', '-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '-c', 'features.shell_tool=false', '-c', 'features.apply_patch_freeform=false',
    '-c', 'features.multi_agent=false', '-c', 'model_reasoning_effort="medium"',
    '--json', '--output-schema', schemaPath, '--output-last-message', outputPath, '-'];
  return new Promise((resolve, reject) => {
    const child = spawn(findCodex(), args, { cwd: directory, stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    let pending = '', diagnostic = '', finalMessage = '', searches = 0, finished = false;
    const stop = () => { child.kill('SIGTERM'); setTimeout(() => { if (!finished) child.kill('SIGKILL'); }, 1500).unref(); };
    signal.addEventListener('abort', stop, { once: true });
    if(signal.aborted)stop();
    child.stdin.on('error', () => { /* Closing stdin during cancellation is expected. */ });
    child.stdin.end(prompt);
    child.stdout.on('data', chunk => {
      pending += chunk;
      let next;
      while ((next = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, next); pending = pending.slice(next + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === 'item.completed' && event.item?.type === 'web_search') {
            searches++; progress(`Checking public sources · ${searches} research steps`);
          }
          if (event.type === 'item.completed' && event.item?.type === 'agent_message') finalMessage = event.item.text;
          if (event.type === 'error') diagnostic = String(event.message || '').slice(-1200);
        } catch { /* Only structured progress is exposed to the browser. */ }
      }
    });
    child.stderr.on('data', chunk => { diagnostic = (diagnostic + chunk).slice(-3000); });
    child.on('error', error => { finished = true; signal.removeEventListener('abort', stop); reject(error); });
    child.on('close', async code => {
      finished = true; signal.removeEventListener('abort', stop);
      if (signal.aborted) return reject(new Error('Research cancelled or reached its time limit.'));
      try {
        const output = await readFile(outputPath, 'utf8').catch(() => finalMessage);
        if (code !== 0 || !output) {
          // Only log diagnostics to the local terminal. Never expose auth/provider output through HTTP.
          console.error('Research process failed:', diagnostic.slice(-1500));
          throw new Error('Live research could not finish. Check your Codex sign-in/account allowance, then try again.');
        }
        resolve(JSON.parse(output));
      } catch (error) { reject(error); }
    });
  });
}

export async function research(options, directory, progress, signal) {
  progress('Identifying the publication and searching ownership records…');
  const prompt = promptFor(options);
  const raw = process.env.OPENAI_API_KEY ? await apiResearch(prompt, progress, signal) : await codexResearch(prompt, directory, progress, signal);
  if (signal.aborted) throw new Error('Research cancelled.');
  const graph = normalizeGraph(raw, options);
  progress(`Found ${graph.edges.length} proposed connections. Checking citations…`);
  await checkEvidence(graph, progress, signal);
  progress('Adding available entity images…');
  await enrichImages(graph, signal);
  if (signal.aborted) throw new Error('Research cancelled.');
  await rm(directory, { recursive: true, force: true });
  return graph;
}
