import { readApiResponse } from './api-response.js';
import { findPublication, validateCatalog } from './catalog.js';

const $ = selector => document.querySelector(selector);
const ns = 'http://www.w3.org/2000/svg';
const state = { token: '', graph: null, job: null, available: false, catalog: [], preset: false, camera: { x: 0, y: 0, k: 1 }, points: new Map(), bounds: null };
const labels = { owned_by: 'owned by', parent_company: 'parent company', published_by: 'published by', controlled_by: 'controlled by', appointment_rights: 'appointment rights', managed_by: 'managed by' };
let pollTimer, lastFocus, loadSequence = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function svgElement(tag, attrs = {}, text) {
  const node = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function externalLink(url, text) {
  const link = element('a', text);
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function showError(message) {
  $('#error').textContent = message;
  $('#error').hidden = !message;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Press-Token': state.token, ...options.headers }
  });
  return readApiResponse(response, url);
}

async function savedData(path, responseType = '') {
  try { return await readApiResponse(await fetch(path), responseType); }
  catch { throw new Error('The saved map data could not be loaded. Please reload the page.'); }
}

function busy(active) {
  $('#submit').disabled = active || (!state.available && !state.catalog.length);
  $('#publication').disabled = active;
  $('#progress').hidden = !active;
  $('#cancel').disabled = active && !state.job;
  $('#progress-message').textContent = 'searching…';
}

async function loadMap(id) {
  const sequence = ++loadSequence;
  const entry = state.catalog.find(map => map.id === id);
  const graph = entry
    ? await savedData(`/data/${entry.slug}.json`, `/api/maps/${id}`)
    : await api(`/api/maps/${id}`);
  if (sequence !== loadSequence) return;
  state.graph = graph;
  state.preset = Boolean(entry);
  $('#saved-maps').open = false;
  $('#publication').value = graph.query;
  history.replaceState(null, '', `#map=${graph.id}`);
  document.body.classList.add('has-map');
  $('#workspace').hidden = false;
  $('#drawer').hidden = true;
  showError('');
  renderGraph();
}

async function startResearch(fresh = false) {
  const query = $('#publication').value.trim();
  if (query.length < 2 || state.job) return;
  showError('');
  busy(true);
  $('#drawer').hidden = true;
  try {
    const preset = findPublication(state.catalog, query);
    if (preset && !fresh) { await loadMap(preset.id); busy(false); return; }
    if (!state.available) {
      loadSequence++;
      state.graph = null;
      $('#workspace').hidden = true;
      document.body.classList.remove('has-map');
      history.replaceState(null, '', location.pathname);
      showError('No saved map for that name yet. Choose one of the 20 maps below.');
      $('#saved-maps').open = true;
      busy(false);
      return;
    }
    // Existing maps are still saved; a repeated search simply reopens one.
    if (!fresh) {
      const maps = await api('/api/maps');
      const saved = maps.find(map => map.query.toLowerCase() === query.toLowerCase() && Date.now() - Date.parse(map.researchedAt) < 86400000);
      if (saved) { await loadMap(saved.id); busy(false); return; }
    }
    const result = await api('/api/research', {
      method: 'POST',
      body: JSON.stringify({ query, kind: 'auto', depth: 3, fresh })
    });
    if (result.mapId) { await loadMap(result.mapId); busy(false); return; }
    state.job = result.jobId;
    $('#cancel').disabled = false;
    sessionStorage.setItem('press-trace-job', state.job);
    await pollJob();
  } catch (error) { busy(false); showError(error.message); }
}

async function pollJob() {
  clearTimeout(pollTimer);
  if (!state.job) return;
  const current = state.job;
  try {
    const job = await api(`/api/jobs/${current}`);
    if (current !== state.job) return;
    $('#publication').value = job.query;
    if (job.status === 'running') { pollTimer = setTimeout(pollJob, 1600); return; }
    state.job = null;
    sessionStorage.removeItem('press-trace-job');
    busy(false);
    if (job.status === 'complete') await loadMap(job.mapId);
    else if (job.status !== 'cancelled') showError(job.message);
  } catch (error) {
    state.job = null;
    sessionStorage.removeItem('press-trace-job');
    busy(false);
    showError(error.message);
  }
}

$('#search-form').addEventListener('submit', event => { event.preventDefault(); startResearch(); });
$('#cancel').addEventListener('click', async () => {
  if (!state.job) return;
  $('#cancel').disabled = true;
  try {
    await api(`/api/jobs/${state.job}`, { method: 'DELETE' });
    $('#progress-message').textContent = 'cancelling…';
  } catch (error) { $('#cancel').disabled = false; showError(error.message); }
});
$('#home').addEventListener('click', event => {
  event.preventDefault();
  loadSequence++;
  state.graph = null;
  $('#workspace').hidden = true;
  $('#drawer').hidden = true;
  document.body.classList.remove('has-map');
  history.replaceState(null, '', location.pathname);
  showError('');
  if (!state.job) { $('#publication').value = ''; $('#publication').focus(); }
});

function layoutLevels(nodes,edges) {
  const outgoing=new Map(nodes.map(n=>[n.id,new Set()]));
  for(const edge of edges)outgoing.get(edge.from)?.add(edge.to);
  // Ignore cycle-closing links for placement, but still draw every relationship.
  const visited=new Set(),active=new Set(),forward=new Map(nodes.map(n=>[n.id,new Set()]));
  function visit(id){
    visited.add(id);active.add(id);
    for(const target of outgoing.get(id)||[]){
      if(active.has(target))continue;
      forward.get(id).add(target);
      if(!visited.has(target))visit(target);
    }
    active.delete(id);
  }
  visit(state.graph.rootId);for(const node of nodes)if(!visited.has(node.id))visit(node.id);
  const degree=new Map(nodes.map(n=>[n.id,0])),level=new Map(nodes.map(n=>[n.id,0]));
  for(const targets of forward.values())for(const target of targets)degree.set(target,degree.get(target)+1);
  const queue=nodes.filter(n=>degree.get(n.id)===0).map(n=>n.id);
  while(queue.length){
    const id=queue.shift();
    for(const target of forward.get(id)){
      level.set(target,Math.max(level.get(target),level.get(id)+1));
      degree.set(target,degree.get(target)-1);if(degree.get(target)===0)queue.push(target);
    }
  }
  return level;
}
function renderGraph(resetFit=true) {
  const viewport=$('#viewport');viewport.replaceChildren();
  const {nodes,edges}=state.graph;
  const level=layoutLevels(nodes,edges),curveBounds=[];
  const groups=new Map();for(const n of nodes){const l=level.get(n.id);if(!groups.has(l))groups.set(l,[]);groups.get(l).push(n);}
  const tallest=Math.max(...[...groups.values()].map(v=>v.length));
  const height=Math.max(360,tallest*190+100);state.points=new Map();
  for(const [depth,group] of groups){group.forEach((node,index)=>state.points.set(node.id,{x:130+depth*310,y:height/2+(index-(group.length-1)/2)*190}));}
  for(const edge of edges){
    const a=state.points.get(edge.from),b=state.points.get(edge.to);if(!a||!b)continue;
    const peers=edges.filter(e=>e.from===edge.from&&e.to===edge.to);
    const span=level.get(edge.to)-level.get(edge.from);
    const offset=(peers.indexOf(edge)-(peers.length-1)/2)*70+(span===1?0:-(130+Math.abs(span)*60));
    const dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy)||1;
    const x1=a.x+dx/dist*47,y1=a.y+dy/dist*47,x2=b.x-dx/dist*50,y2=b.y-dy/dist*50;
    const mx=(x1+x2)/2,my=(y1+y2)/2+offset;
    curveBounds.push({x:mx,y:(y1+2*my+y2)/4-25});
    const d=`M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
    const group=svgElement('g',{class:`edge ${edge.status}`,tabindex:0,role:'button','aria-label':`${nodeName(edge.from)} ${labels[edge.relationship].toLowerCase()} ${nodeName(edge.to)}, ${edge.status}`});
    group.append(svgElement('path',{d,class:'hit'}),svgElement('path',{d,class:'edge-visible'}));
    const label=edge.percentage!==null?`${edge.percentage}% · ${labels[edge.relationship]}`:labels[edge.relationship];
    group.append(svgElement('text',{x:mx,y:(y1+2*my+y2)/4-10},label));
    activate(group,()=>showEdge(edge.id));viewport.append(group);
  }
  for(const node of nodes){
    const {x,y}=state.points.get(node.id);
    const group=svgElement('g',{class:'node',transform:`translate(${x},${y})`,tabindex:0,role:'button','aria-label':`${node.name}, ${node.type}. ${node.endpointNote||''}`,'data-node-id':node.id});
    group.append(svgElement('title',{},`${node.name}\n${node.description}`));
    if(node.id===state.graph.rootId)group.append(svgElement('circle',{r:55,class:'root-ring'}));
    group.append(svgElement('circle',{r:44,class:'shell'}));
    const initials=node.name.split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
    const initialsText=svgElement('text',{class:'initials',y:7},initials);group.append(initialsText);
    if(node.image?.url){
      const clipId=`clip-${state.graph.nodes.indexOf(node)}`;
      const defs=svgElement('defs');const clip=svgElement('clipPath',{id:clipId});clip.append(svgElement('circle',{r:35}));defs.append(clip);group.append(defs);
      const image=svgElement('image',{href:node.image.url,x:-35,y:-35,width:70,height:70,'clip-path':`url(#${clipId})`,preserveAspectRatio:'xMidYMid meet'});
      const backdrop=svgElement('circle',{r:35,fill:'#edf0f4'});group.append(backdrop,image);
      image.addEventListener('load',()=>{initialsText.style.visibility='hidden';});
      image.addEventListener('error',()=>{image.remove();backdrop.remove();initialsText.style.visibility='visible';});
    }
    const lines=wrap(node.name,25);const label=svgElement('text',{y:73});lines.forEach((text,index)=>label.append(svgElement('tspan',{x:0,dy:index?18:0},text)));group.append(label);
    activate(group,()=>showNode(node.id));viewport.append(group);
  }
  const positions=[...state.points.values()];
  const minX=Math.min(...positions.map(p=>p.x))-135,minY=Math.min(...positions.map(p=>p.y-65),...curveBounds.map(p=>p.y));
  state.bounds={x:minX,y:minY,width:Math.max(...positions.map(p=>p.x))+140-minX,height:Math.max(...positions.map(p=>p.y))+140-minY};
  $('#graph-empty').hidden=edges.length>0;
  if(resetFit)requestAnimationFrame(()=>fitMap(true));else applyCamera();
}
function wrap(text,max){const words=text.split(' '),lines=[''];for(const word of words){let i=lines.length-1;if(lines[i]&&lines[i].length+word.length+1>max&&lines.length<3){lines.push(word);}else lines[i]+=(lines[i]?' ':'')+word;}return lines;}
function nodeName(id){return state.graph.nodes.find(n=>n.id===id)?.name||id;}
let suppressClickUntil=0;
function activate(el,fn){el.addEventListener('click',()=>{if(Date.now()>suppressClickUntil)fn();});el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();fn();}});}
function applyCamera(){const c=state.camera;$('#viewport').setAttribute('transform',`translate(${c.x},${c.y}) scale(${c.k})`);}
function fitMap(initial = false) {
  if (!state.bounds) return;
  const rect = $('#map').getBoundingClientRect(), b = state.bounds;
  const k = Math.max(.15, Math.min((rect.width - 45) / b.width, (rect.height - 65) / b.height, 1.1));
  if (initial && rect.width < 600 && k < .7) {
    const root = state.points.get(state.graph.rootId);
    state.camera = { k: .7, x: 85 - root.x * .7, y: rect.height / 2 - root.y * .7 };
  } else {
    state.camera = { k, x: (rect.width - b.width * k) / 2 - b.x * k, y: (rect.height - 35 - b.height * k) / 2 - b.y * k };
  }
  applyCamera();
}
function zoom(factor,point){const rect=$('#map').getBoundingClientRect();const p=point||{x:rect.width/2,y:rect.height/2};const c=state.camera;const next=Math.max(.15,Math.min(3,c.k*factor));state.camera={k:next,x:p.x-(p.x-c.x)*next/c.k,y:p.y-(p.y-c.y)*next/c.k};applyCamera();}
$('#zoom-in').addEventListener('click',()=>zoom(1.25));$('#zoom-out').addEventListener('click',()=>zoom(.8));$('#fit').addEventListener('click',()=>fitMap());
$('#map').addEventListener('wheel',event=>{event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();zoom(Math.exp(-event.deltaY*.0015),{x:event.clientX-rect.left,y:event.clientY-rect.top});},{passive:false});
const pointers=new Map();let gesture=null;
function measure(){const p=[...pointers.values()];return p.length>1?{x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2,d:Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y)}:{...p[0],d:0};}
$('#map').addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('.node,.edge'))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});gesture=measure();event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.classList.add('dragging');});
$('#map').addEventListener('pointermove',event=>{if(!pointers.has(event.pointerId))return;pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});const next=measure();if(!gesture)return;const dx=next.x-gesture.x,dy=next.y-gesture.y;if(Math.abs(dx)+Math.abs(dy)>2||next.d!==gesture.d)suppressClickUntil=Date.now()+250;state.camera.x+=dx;state.camera.y+=dy;if(next.d&&gesture.d){const rect=$('#map').getBoundingClientRect();zoom(next.d/gesture.d,{x:next.x-rect.left,y:next.y-rect.top});}else applyCamera();gesture=next;});
for(const name of ['pointerup','pointercancel','lostpointercapture'])$('#map').addEventListener(name,event=>{pointers.delete(event.pointerId);gesture=pointers.size?measure():null;if(!pointers.size)$('#map').classList.remove('dragging');});
$('#map').addEventListener('keydown',event=>{if(event.target!==$('#map'))return;const moves={ArrowLeft:[35,0],ArrowRight:[-35,0],ArrowUp:[0,35],ArrowDown:[0,-35]};if(moves[event.key]){event.preventDefault();state.camera.x+=moves[event.key][0];state.camera.y+=moves[event.key][1];applyCamera();}else if(event.key==='+'||event.key==='=')zoom(1.25);else if(event.key==='-')zoom(.8);else if(event.key==='0')fitMap();});
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(state.graph)fitMap(true);},120);});
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--header-height', `${entry.target.getBoundingClientRect().height}px`);
  if (state.graph) fitMap(true);
}).observe(document.querySelector('header'));


function openDrawer() {
  if (!$('#drawer').contains(document.activeElement)) lastFocus = document.activeElement;
  const content = $('#drawer-content');
  content.replaceChildren();
  $('#drawer').hidden = false;
  $('#drawer-close').focus();
  return content;
}

function closeDrawer() {
  $('#drawer').hidden = true;
  if (lastFocus?.isConnected) lastFocus.focus();
  else $('#map').focus();
}
$('#drawer-close').addEventListener('click', closeDrawer);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });

function details(label, ...children) {
  const section = element('details');
  section.append(element('summary', label), ...children);
  return section;
}

function description(text) {
  const paragraph = element('p', text);
  return text.length > 220 ? details('details', paragraph) : paragraph;
}

function showEdge(id) {
  const edge = state.graph.edges.find(item => item.id === id);
  if (!edge) return;
  const content = openDrawer();
  const relationship = labels[edge.relationship] + (edge.percentage === null ? '' : ` · ${edge.percentage}%`);
  content.append(element('h2', `${nodeName(edge.from)} → ${nodeName(edge.to)}`), element('p', relationship));
  content.append(element('small', `${edge.status === 'pending' ? 'unreviewed' : edge.status}${edge.asOf ? ' · ' + edge.asOf : ''}`));
  if (edge.description) content.append(description(edge.description));

  const sources = details(`sources (${edge.evidence.length})`);
  for (const source of edge.evidence) {
    const block = element('div', undefined, 'source');
    block.append(externalLink(source.url, source.title || new URL(source.url).hostname));
    if (source.excerpt) block.append(element('blockquote', source.excerpt));
    if (source.validation === 'unavailable') block.append(element('small', 'source could not be retrieved'));
    sources.append(block);
  }
  content.append(sources);

  // Published snapshots are shared evidence, never editable by anonymous visitors.
  if (state.preset) return;

  const actions = element('div', undefined, 'review-actions');
  const review = details('review', actions);
  for (const [label, status] of [['approve', 'approved'], ['reject', 'rejected'], ['reset', 'pending']]) {
    const button = element('button', label);
    button.disabled = edge.status === status;
    button.addEventListener('click', async () => {
      actions.querySelectorAll('button').forEach(item => item.disabled = true);
      try {
        const graph = await api(`/api/maps/${state.graph.id}/review`, {
          method: 'PATCH',
          body: JSON.stringify({ edgeId: id, status, revision: state.graph.revision })
        });
        state.graph = graph;
        renderGraph(false);
        showEdge(id);
      } catch (error) { showError(error.message); actions.querySelectorAll('button').forEach(item => item.disabled = false); }
    });
    actions.append(button);
  }
  content.append(review);
}

function showNode(id) {
  const node = state.graph.nodes.find(item => item.id === id);
  const content = openDrawer();
  content.append(element('h2', node.name));
  if (node.description) content.append(description(node.description));
  if (node.website) content.append(externalLink(node.website, 'website'));

  const connections = element('div', undefined, 'connections');
  for (const edge of state.graph.edges.filter(item => item.from === id)) {
    const button = element('button', `${labels[edge.relationship]} ${nodeName(edge.to)}${edge.percentage === null ? '' : ' (' + edge.percentage + '%)'}`);
    button.addEventListener('click', () => showEdge(edge.id));
    connections.append(button);
  }
  content.append(connections.childElementCount > 1 ? details('connections', connections) : connections);
  if (node.endpointNote && ['unresolved', 'depth_limit', 'dispersed_shareholders'].includes(node.endpoint)) {
    content.append(details('unknowns', element('p', node.endpointNote)));
  }

  if (node.id === state.graph.rootId) {
    const notes = details('map notes', element('p', `Partial map · ${state.graph.researchedAt.slice(0, 10)}`));
    if (state.graph.gaps.length) {
      const gaps = element('ul');
      for (const gap of state.graph.gaps) gaps.append(element('li', gap));
      notes.append(gaps);
    }
    const actions = element('div', undefined, 'map-actions');
    const refresh = element('button', 'search again');
    refresh.disabled = !!state.job || !state.available;
    refresh.addEventListener('click', () => { $('#publication').value = state.graph.query; startResearch(true); });
    const download = element('button', 'download data');
    download.addEventListener('click', exportMap);
    if (state.available) actions.append(refresh);
    actions.append(download);
    notes.append(actions);
    content.append(notes);
  }
  if (node.image?.page) {
    content.append(details('image credit', externalLink(node.image.page, 'Wikimedia Commons'), element('p', `${node.image.artist} · ${node.image.license}`)));
  }
}

function exportMap() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(state.graph, null, 2)], { type: 'application/json' }));
  const link = element('a');
  link.href = url;
  link.download = `${state.graph.query.replace(/[^a-z0-9]+/gi, '-')}-ownership.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function init() {
  $('#submit').disabled = true;
  try {
    const catalog = validateCatalog(await savedData('/data/catalog.json'));
    state.catalog = catalog.maps;
    for (const map of state.catalog) {
      const option = element('option'); option.value = map.name; $('#publications').append(option);
      const link = element('a', map.name); link.href = `#map=${map.id}`;
      link.addEventListener('click', async event => {
        event.preventDefault();
        try { await loadMap(map.id); } catch (error) { showError(error.message); }
      });
      const item = element('li'); item.append(link); $('#publication-list').append(item);
    }
    $('#saved-maps').hidden = false;
    $('#saved-maps summary').textContent = `${state.catalog.length} maps`;
    busy(false);
    if (!catalog.liveResearch) {
      const match = location.hash.match(/^#map=([a-f0-9-]{36})$/);
      if (match) {
        if (state.catalog.some(map => map.id === match[1])) await loadMap(match[1]);
        else showError('This map is not in the saved collection. Search for a publication below.');
      }
      return;
    }
    $('#funding-note').hidden = true;
    const config = await api('/api/status');
    state.token = config.token;
    state.available = config.available;
    busy(false);
    if (!config.available) showError(config.note);
    const match = location.hash.match(/^#map=([a-f0-9-]{36})$/);
    if (match) await loadMap(match[1]);
    const job = config.activeJob || sessionStorage.getItem('press-trace-job');
    if (job) { state.job = job; busy(true); pollJob(); }
  } catch (error) { showError(error.message); }
}
init();
