import http from 'node:http';
import { readFile, writeFile, rename, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { providerStatus, research } from './lib/research.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const storage = path.join(root, 'runtime', 'maps');
await mkdir(storage, { recursive: true });
const port = Number(process.env.PORT || 8765);
const token = randomBytes(24).toString('hex');
const jobs = new Map();
const provider = providerStatus();
const origins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
const validId = id => /^[a-f0-9-]{36}$/.test(id);
const files = { '/': ['index.html','text/html'], '/app.js': ['app.js','text/javascript'], '/api-response.js': ['api-response.js','text/javascript'], '/catalog.js': ['catalog.js','text/javascript'], '/style.css': ['style.css','text/css'], '/favicon.svg': ['favicon.svg','image/svg+xml'] };

async function save(graph) {
  const target = path.join(storage, `${graph.id}.json`);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(graph, null, 2));
  await rename(temp, target);
}
async function getGraph(id) {
  if (!validId(id)) throw Object.assign(new Error('Map not found.'), { status: 404 });
  return JSON.parse(await readFile(path.join(storage, `${id}.json`), 'utf8'));
}
async function allMaps() {
  const names = (await readdir(storage)).filter(n => /^[a-f0-9-]{36}\.json$/.test(n));
  const results = await Promise.all(names.map(n => readFile(path.join(storage,n),'utf8').then(JSON.parse).catch(() => null)));
  return results.filter(Boolean).sort((a,b) => b.researchedAt.localeCompare(a.researchedAt));
}
async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('Expected JSON.'), { status: 415 });
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 8000) throw Object.assign(new Error('Request too large.'), { status: 413 });
  }
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
}
function json(res, code, value) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function snapshot(job) { const { controller, ...safe } = job; return safe; }
let mutation = Promise.resolve();
function serialize(fn) { const task = mutation.then(fn); mutation = task.catch(() => {}); return task; }

const server = http.createServer(async (req,res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://upload.wikimedia.org https://thumb.wikimedia.org https://commons.wikimedia.org data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    // Loopback-only server plus strict host/origin/token checks prevents third-party sites triggering research.
    if (!origins.has(`http://${req.headers.host}`)) return json(res,403,{error:'Unrecognised host.'});
    if (req.headers.origin && !origins.has(req.headers.origin)) return json(res,403,{error:'Cross-origin requests are not allowed.'});
    const url = new URL(req.url, `http://${req.headers.host}`);
    const method = req.method;
    if (url.pathname.startsWith('/api/') && !['GET','HEAD'].includes(method) && req.headers['x-press-token'] !== token) return json(res,403,{error:'Reload this page to renew the local session.'});
    if (method === 'GET' && url.pathname === '/api/status') return json(res,200,{...provider,token,activeJob:[...jobs.values()].find(j=>j.status==='running')?.id||null});
    if (method === 'GET' && url.pathname === '/api/maps') return json(res,200,(await allMaps()).map(g => ({ id:g.id,title:g.title,query:g.query,kind:g.kind,depth:g.depth,researchedAt:g.researchedAt,nodes:g.nodes.length,edges:g.edges.length,approved:g.edges.filter(e=>e.status==='approved').length })));
    const mapMatch = url.pathname.match(/^\/api\/maps\/([a-f0-9-]+)$/);
    if (method === 'GET' && mapMatch) return json(res,200,await getGraph(mapMatch[1]));
    const reviewMatch = url.pathname.match(/^\/api\/maps\/([a-f0-9-]+)\/review$/);
    if (method === 'PATCH' && reviewMatch) {
      const input = await body(req);
      if (!['pending','approved','rejected'].includes(input.status)) return json(res,400,{error:'Invalid review status.'});
      return await serialize(async () => {
        const graph = await getGraph(reviewMatch[1]);
        if (input.revision !== graph.revision) return json(res,409,{error:'This map changed in another tab. Reopen it before reviewing.'});
        const edge = graph.edges.find(e=>e.id===input.edgeId);
        if (!edge) return json(res,404,{error:'Connection not found.'});
        edge.status=input.status; edge.reviewedAt=input.status==='pending'?null:new Date().toISOString();
        graph.revision++; await save(graph); json(res,200,graph);
      });
    }
    if (method === 'POST' && url.pathname === '/api/research') {
      const input = await body(req);
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (query.length < 2 || query.length > 160 || /[\x00-\x1f]/.test(query)) return json(res,400,{error:'Enter a publication name between 2 and 160 characters.'});
      const kind = ['news','academic','auto'].includes(input.kind) ? input.kind : 'auto';
      const depth = [1,2,3,4].includes(Number(input.depth)) ? Number(input.depth) : 3;
      if (!input.fresh) {
        const existing = (await allMaps()).find(g=>g.query.toLowerCase()===query.toLowerCase()&&g.kind===kind&&g.depth===depth&&Date.now()-Date.parse(g.researchedAt)<86400000);
        if (existing) return json(res,200,{mapId:existing.id,cached:true});
      }
      if (!provider.available) return json(res,503,{error:provider.note});
      if ([...jobs.values()].some(j=>j.status==='running')) return json(res,409,{error:'A research run is already active. Wait for it to finish or cancel it.'});
      if(jobs.size > 100) for(const [id,j] of jobs) if(j.status!=='running') jobs.delete(id);
      const id=randomUUID();
      const job={id,query,status:'running',message:'Starting ownership research…',events:[],startedAt:new Date().toISOString(),controller:new AbortController()};
      jobs.set(id,job);
      json(res,202,{jobId:id});
      const progress=message=>{job.message=message;job.events.push({message,at:new Date().toISOString()});job.events=job.events.slice(-30);};
      const timeout=setTimeout(()=>{job.timedOut=true;job.controller.abort();},8*60*1000);
      research({query,kind,depth},path.join(root,'runtime','jobs',id),progress,job.controller.signal)
        .then(async graph=>{graph.id=id;await save(graph);job.status='complete';job.mapId=id;job.message='Research saved. Review the proposed connections.';})
        .catch(error=>{job.status=job.controller.signal.aborted?'cancelled':'failed';job.message=job.timedOut?'Research reached the eight-minute limit. Try fewer levels.':error.message;})
        .finally(()=>{clearTimeout(timeout);job.finishedAt=new Date().toISOString();});
      return;
    }
    const jobMatch=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/);
    if(jobMatch){
      const job=jobs.get(jobMatch[1]); if(!job)return json(res,404,{error:'Research session not found. Check saved maps.'});
      if(method==='GET')return json(res,200,snapshot(job));
      if(method==='DELETE'){job.controller.abort();return json(res,200,{cancelled:true});}
    }
    if (method === 'GET' && /^\/data\/[a-z0-9-]+\.json$/.test(url.pathname)) {
      json(res, 200, JSON.parse(await readFile(path.join(root, 'public', url.pathname), 'utf8'))); return;
    }
    if(method==='GET' && files[url.pathname]){
      const [name,type]=files[url.pathname];res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`});res.end(await readFile(path.join(root,'public',name)));return;
    }
    json(res,404,{error:'Not found.'});
  }catch(error){json(res,error.status|| (error.code==='ENOENT'?404:500),{error:error.status?error.message:error.code==='ENOENT'?'Map not found.':'The request could not be completed. Please try again.'});console.error(error.message);}
});
server.listen(port,'127.0.0.1',()=>console.log(`Press Trace running at http://localhost:${port}\nResearch provider: ${provider.provider||'not configured'}\n${provider.note}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const job of jobs.values())job.controller.abort();server.close(()=>process.exit(0));});
