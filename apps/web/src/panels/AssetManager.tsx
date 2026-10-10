import { useEffect, useMemo, useRef, useState } from 'react';
import { ROAD_TEMPLATES, type ProjectMaterial } from '@drip-urban/core';
import type { FurnitureItem } from '../api/types';
import { materialCanvas, useMaterialUi } from '../models/materials';
import { partFaces } from '../models/parts';
import { useModels } from '../models/models';
import { commit, openDock, select, setDock, setTool, useApp } from '../state/store';
import { useTool } from '../tools/toolState';
import { flyTo } from '../map/mapStore';
import { Button, Empty, Field, Section, Select, TextField, Toggle } from '../ui/controls';
import { toast } from '../state/toasts';

type Kind = 'furniture' | 'sign' | 'material' | 'road';
interface Entry { id: string; label: string; kind: Kind; category: string; furniture?: FurnitureItem; material?: ProjectMaterial; image?: string; }
interface Preferences { favorites: string[]; tags: Record<string, string>; }
const KEY = 'drip.asset-library.preferences.v1';
function preferences(): Preferences { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { favorites: Array.isArray(v.favorites) ? v.favorites.filter((x: unknown) => typeof x === 'string') : [], tags: v.tags && typeof v.tags === 'object' ? v.tags : {} }; } catch { return { favorites: [], tags: {} }; } }
const token = (e: Entry) => `${e.kind}:${e.id}`;
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function MaterialPreview({ material }: { material: ProjectMaterial }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { let alive = true; materialCanvas(material).then(canvas => { if (alive && ref.current) { const g = ref.current.getContext('2d')!; g.fillStyle = g.createPattern(canvas, 'repeat')!; g.fillRect(0, 0, 140, 100); } }).catch(() => {}); return () => { alive = false; }; }, [material]);
  return <canvas ref={ref} width={140} height={100} aria-label={`Texture ${material.label}`} />;
}
/** Isometric preview of the same procedural faces used for the actual furniture model. */
function FurniturePreview({ item }: { item: FurnitureItem }) {
  const polygons = useMemo(() => item.model.flatMap(part => partFaces(part, 8).map(face => ({ points: face.pts.map(([x,y,z]) => [x-y,(x+y)*.45-z]), color: part.mat, depth: face.pts.reduce((s,[x,y,z])=>s+x+y+z*.01,0)/face.pts.length }))).sort((a,b)=>a.depth-b.depth), [item]);
  const points = polygons.flatMap(p=>p.points), xs=points.map(p=>p[0]!), ys=points.map(p=>p[1]!);
  const x=Math.min(...xs), y=Math.min(...ys), w=Math.max(.1,Math.max(...xs)-x), h=Math.max(.1,Math.max(...ys)-y);
  const colors:Record<string,string>={ wood:'#96724d', metal:'#7e878e', concrete:'#b3afa5', leaves:'#56784a', grass:'#56784a', bark:'#6d5140', glass:'#80b5be' };
  return <svg viewBox={`${x-w*.1} ${y-h*.1} ${w*1.2} ${h*1.2}`} role="img" aria-label={item.id.startsWith('model:') ? `Ingombro del modello ${item.label}` : `Geometria ${item.label}`}>
    {polygons.map((p,i)=><polygon key={i} points={p.points.map(q=>q.join(',')).join(' ')} fill={colors[p.color]??'#959a91'} stroke="#343b37" strokeWidth={Math.max(w,h)/160} />)}
  </svg>;
}
export function AssetManager() {
  const catalogs=useApp(s=>s.catalogs), net=useApp(s=>s.network), selection=useApp(s=>s.selection), scenario=useApp(s=>s.scenario);
  const models=useModels(s=>s.list);
  const [prefs,setPrefs]=useState(preferences), [query,setQuery]=useState(''), [kind,setKind]=useState('all'), [category,setCategory]=useState('all'), [favorites,setFavorites]=useState(false), [active,setActive]=useState<string|null>(null);
  const update=(next:Preferences)=>{setPrefs(next);try{localStorage.setItem(KEY,JSON.stringify(next));}catch{toast.warn('Preferenze libreria','Spazio locale esaurito: preferenze mantenute per questa sessione');}};
  const entries=useMemo<Entry[]>(()=>catalogs ? [
    ...catalogs.furniture.items.map(f=>({id:f.id,label:f.label,kind:'furniture' as const,category:catalogs.furniture.categories[f.category]??f.category,furniture:f})),
    ...catalogs.signs.items.map(s=>({id:s.id,label:s.label,kind:'sign' as const,category:catalogs.signs.families[s.family]??s.family,image:`/signs/${encodeURIComponent(s.file)}`})),
    ...catalogs.materials.items.map(m=>({id:m.id,label:m.label,kind:'material' as const,category:catalogs.materials.categories[m.category]??m.category,material:m})),
    ...ROAD_TEMPLATES.map(r=>({id:r.id,label:r.label,kind:'road' as const,category:'Sezioni stradali'})),
  ] : [],[catalogs]);
  const filtered=entries.filter(e=>(kind==='all'||e.kind===kind)&&(category==='all'||e.category===category)&&(!favorites||prefs.favorites.includes(token(e)))&&norm(`${e.label} ${e.category} ${prefs.tags[token(e)]??''}`).includes(norm(query)));
  const chosen=entries.find(e=>token(e)===active), modifiable=Boolean(scenario&&!scenario.isBaseline&&!scenario.locked);
  const usages=chosen&&net ? Object.values(net.assets).filter(a=>a.state!=='removed'&&(chosen.kind==='material'?a.material===chosen.id:a.type===chosen.id)) : [];
  const roadUses=chosen?.kind==='material'&&net?Object.values(net.roads).filter(r=>r.section.elements.some(e=>e.material===chosen.id)):[];
  const areaUses=chosen?.kind==='material'&&net?Object.values(net.areas).filter(a=>a.material===chosen.id):[];
  const buildingUses=chosen?.kind==='material'&&net?Object.entries(net.buildingStyles??{}).filter(([,s])=>s.facadeMaterial===chosen.id||s.roofMaterial===chosen.id):[];
  const selected=selection?.kind==='asset'&&net?selection.ids.map(id=>net.assets[id]).filter(a=>a&&a.state!=='removed'):[];
  const replacement=chosen&&(chosen.kind==='furniture'||chosen.kind==='sign')&&selected.length>0&&selected.every(a=>chosen.kind==='sign'?catalogs!.signs.items.some(s=>s.id===a!.type):catalogs!.furniture.items.some(f=>f.id===a!.type)&&!a!.solid&&!a!.type.startsWith('signal.')&&!chosen.id.startsWith('signal.'));
  const useEntry=()=>{if(!chosen)return;if(chosen.kind==='material'){useMaterialUi.setState({selectedId:chosen.id});openDock('materials');return;}if(chosen.kind==='road'){useTool.setState({roadTemplate:chosen.id});setTool('road');}else if(chosen.kind==='sign'){useTool.setState({signId:chosen.id});setTool('signs');}else{useTool.setState({furnitureId:chosen.id});setTool('furniture');}setDock(null);};
  const replace=()=>{if(!chosen||!replacement)return;const result=commit('batch',{label:'Sostituisci oggetti dalla libreria',ops:selected.map(a=>({type:'asset.update',payload:{assetId:a!.id,changes:{type:chosen.id}}}))});if(!result.ok)toast.error('Sostituzione',result.issues.map(i=>i.message).join(' · '));};
  return <><Section title="Libreria del progetto" count={entries.length}>
    <Field label="Cerca nome, categoria o tag"><input className="text-field" type="search" aria-label="Cerca asset" value={query} onChange={e=>setQuery(e.target.value)} /></Field>
    <div className="grid-2"><Select ariaLabel="Tipo asset" value={kind} options={[{value:'all',label:'Tutti'},{value:'furniture',label:'Arredo / modelli'},{value:'sign',label:'Segnali'},{value:'material',label:'Materiali'},{value:'road',label:'Sezioni stradali'}]} onChange={v=>{setKind(v);setCategory('all');}} /><Select ariaLabel="Categoria asset" value={category} options={[{value:'all',label:'Tutte le categorie'},...[...new Set(entries.filter(e=>kind==='all'||e.kind===kind).map(e=>e.category))].sort().map(value=>({value,label:value}))]} onChange={setCategory} /></div>
    <Toggle label="Solo preferiti" checked={favorites} onChange={setFavorites} /><p className="muted">Preferiti e tag sono personali, salvati su questa postazione. Le geometrie e i materiali provengono dai cataloghi e dal progetto corrente.</p>
    <div className="asset-manager-grid">{filtered.map(e=><button key={token(e)} type="button" className={`asset-library-card${active===token(e)?' is-on':''}`} aria-pressed={active===token(e)} onClick={()=>setActive(token(e))}>
      <span className="asset-library-preview">{e.image?<img src={e.image} alt="" loading="lazy" />:e.material?<MaterialPreview material={e.material} />:e.furniture?<FurniturePreview item={e.furniture} />:<span>{ROAD_TEMPLATES.find(r=>r.id===e.id)!.lanes} corsie<br/>{ROAD_TEMPLATES.find(r=>r.id===e.id)!.laneWidthM} m / corsia</span>}</span>
      <strong>{e.label}</strong><small>{e.category}{prefs.favorites.includes(token(e))?' · ★':''}</small>
    </button>)}</div>{filtered.length===0?<Empty icon="search" title="Nessun asset corrispondente" />:null}
  </Section>{chosen?<Section title={chosen.label}>
    <Toggle label="Preferito asset" checked={prefs.favorites.includes(token(chosen))} onChange={v=>update({...prefs,favorites:v?[...prefs.favorites,token(chosen)]:prefs.favorites.filter(k=>k!==token(chosen))})} />
    <Field label="Tag personali · separati da virgole"><TextField ariaLabel="Tag asset" value={prefs.tags[token(chosen)]??''} onCommit={v=>update({...prefs,tags:{...prefs.tags,[token(chosen)]:v}})} /></Field>
    {chosen.furniture?<p>{chosen.furniture.dims.w} × {chosen.furniture.dims.d} × {chosen.furniture.dims.h} m · geometria {chosen.id.startsWith('model:')?'importata (anteprima ingombro)':'del catalogo'}</p>:null}
    {chosen.id.startsWith('model:')?models.find(m=>`model:${m.id}`===chosen.id)?.audit?.warnings.map(w=><p key={w} className="warn-line">{w}</p>):null}
    <div className="inspector-actions"><Button disabled={!modifiable} onClick={useEntry}>{chosen.kind==='material'?'Modifica materiale':'Usa nello strumento'}</Button><Button disabled={!modifiable||!replacement} onClick={replace}>Sostituisci oggetti selezionati</Button></div>
    <p className="muted">La sostituzione conserva posizione, rotazione, scala e proprietà; è una singola modifica annullabile. Segnali si sostituiscono con segnali, arredi con arredi.</p>
    <strong>Utilizzi nello scenario: {usages.length+roadUses.length+areaUses.length+buildingUses.length}</strong>
    {usages.map(a=><Button key={a.id} size="sm" variant="ghost" onClick={()=>{select({kind:'asset',ids:[a.id]});flyTo([...a.at],19);openDock('inspector');}}>{a.id} · {a.type}</Button>)}
    {roadUses.map(r=><Button key={r.id} size="sm" variant="ghost" onClick={()=>{select({kind:'road',ids:[r.id]});flyTo([...r.axis[0]!],18);openDock('inspector');}}>{r.name||r.id}</Button>)}
    {areaUses.map(a=><Button key={a.id} size="sm" variant="ghost" onClick={()=>{select({kind:'area',ids:[a.id]});openDock('inspector');}}>{a.name||a.id}</Button>)}
    {buildingUses.map(([id])=><Button key={id} size="sm" variant="ghost" onClick={()=>{select({kind:'building',ids:[id]});openDock('inspector');}}>Edificio {id}</Button>)}
  </Section>:<Empty icon="model3d" title="Seleziona un asset" />}</>;
}
