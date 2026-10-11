'use strict';
const $ = (q) => document.querySelector(q);
const node = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = String(text); if(cls) e.className=cls; return e; };
const labels = {'medical-schools':'Medical schools',rotations:'Rotations',hospitals:'Hospitals',residency:'Residencies',undergraduate:'Undergraduate',pa:'Physician assistant',nursing:'Nursing'};
let coverage=[];
function sourceLink(url){ const a=node('a',new URL(url).hostname);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a; }
function renderCoverage(){
 const needle=$('#search').value.toLowerCase(); const rows=coverage.filter(r=>r.name.toLowerCase().includes(needle));
 $('#coverage').replaceChildren(...rows.slice(0,300).map(r=>{const tr=node('tr');tr.append(node('td',r.name),node('td',labels[r.module]),node('td',`${r.captured} / ${r.pages}`),node('td',`${r.candidate_fields} / ${r.total_fields}`),node('td',`${r.reviewed_fields} / ${r.total_fields}`));return tr;}));
 $('#coverage-note').textContent=rows.length ? `${rows.length} records${rows.length>300 ? '; showing the first 300. Search to narrow results.' : '. “Located” means a candidate passage exists, not that the field is verified.'}` : 'No records loaded. Bootstrap an existing AXOM dataset to begin.';
}
async function refresh(){
 try{
  const [status,evidence,sources,rows]=await Promise.all(['/api/status','/api/recent','/api/sources','/api/coverage'].map(async p=>{const r=await fetch(p,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();}));
  $('#connection').textContent=status.paused?'Worker paused':status.workerRecentlySeen?'Worker heartbeat current':'Worker not currently confirmed';
  const counts=status.sources; const captured=(counts.ok||0)+(counts.unchanged||0);
  const metrics=[['Source pages',Object.values(counts).reduce((a,b)=>a+b,0),'Queued and previously checked'],['Successfully checked',captured,'Current source states'],['Pending candidates',status.candidates.pending||0,'Not normalized requirements'],['Reviewed candidates',status.candidates.approved||0,'Publication gate still applies']];
  $('#metrics').replaceChildren(...metrics.map(([title,value,caption])=>{const e=node('div',undefined,'metric');e.append(node('span',title),node('strong',value.toLocaleString()),node('span',caption));return e;}));
  $('#modules').replaceChildren(...status.modules.map(m=>{const e=node('div',undefined,`module ${m.enabled?'active':''}`);e.append(node('strong',labels[m.name]),node('span',`${m.enabled?'Enabled':'Staged'} · ${m.entities} records`));return e;}));
  coverage=rows;renderCoverage();
  $('#evidence').replaceChildren(...(evidence.length?evidence.slice(0,16).map(r=>{const e=node('article');e.append(node('div',`${r.field} / ${r.status}`,'meta'),node('h3',r.name),node('p',r.excerpt),sourceLink(r.url),node('div',r.last_seen,'meta'),node('code',r.id));return e;}):[node('div','No captured candidates yet. This dashboard does not fabricate sample school data.','empty')]));
  $('#sources').replaceChildren(...sources.slice(0,80).map(r=>{const tr=node('tr');const link=node('td');link.append(sourceLink(r.url));tr.append(node('td',r.name),link,node('td',r.status),node('td',r.error||r.checked_at||'Not checked yet'));return tr;}));
 }catch(error){$('#connection').textContent='Dashboard disconnected';console.error(error);}
}
$('#search').addEventListener('input',renderCoverage);refresh();setInterval(refresh,10000);
