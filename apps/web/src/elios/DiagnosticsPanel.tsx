import { useDiagnostics } from './diagnostics';
import { flyTo } from '../map/mapStore';
import { setDock, useApp, select } from '../state/store';

export function DiagnosticsPanel({onInvestigate}:{onInvestigate:(prompt:string)=>void}) {
  const {items,busy,error}=useDiagnostics();
  if(busy)return <p className="muted" role="status">Verifica del progetto in corso…</p>;
  if(error)return <p className="warn-line">Verifica non disponibile: {error}</p>;
  if(!items.length)return null;
  return <details className="elios-diagnostics">
    <summary>{items.length} rilievi automatici sui dati del progetto</summary>
    <p className="muted">Controlli geometrici, accessibilità e coerenza; non costituiscono una certificazione normativa.</p>
    {items.slice(0,5).map((item,index)=><div className="elios-candidate" key={`${item.code}:${index}`}>
      <strong>{item.severity==='error'?'Errore':'Da verificare'}</strong><p>{item.message}</p>
      <button type="button" className="elios-chip" onClick={()=>{
        if(item.at)flyTo([item.at[0],item.at[1]],18);
        const ids=item.targetIds?.filter(id=>useApp.getState().network?.roads[id]);
        if(ids?.length)select({kind:'road',ids});
        setDock('audit');
      }}>Mostra nella verifica</button>
      <button type="button" className="elios-chip" onClick={()=>onInvestigate(`Indaga questo rilievo effettivo dello scenario: ${item.message}. Codice ${item.code}; oggetti ${item.targetIds?.join(', ')??'non specificati'}. Verifica i dati con gli strumenti e proponi una correzione motivata prima di applicarla.`)}>Prepara richiesta a Elios</button>
    </div>)}
    {items.length>5?<button type="button" className="elios-chip" onClick={()=>setDock('audit')}>Apri tutti i {items.length} rilievi</button>:null}
  </details>;
}
