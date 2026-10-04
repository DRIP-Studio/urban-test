import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import { api, ApiError } from '../api/client';
import { setDock, useApp } from '../state/store';
import { Icon } from '../ui/Icon';
import { declarations, toolByName } from './tools';
import './signalTools';
import './rulesTools';
import './transitTools';
import './civicTools';
import './terrainTools';

type Part = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: unknown }; thoughtSignature?: string };
interface Content { role: 'user' | 'model'; parts: Part[] }
type Msg =
  | { id: number; who: 'user'; text: string }
  | { id: number; who: 'elios'; text: string }
  | { id: number; who: 'action'; tool: string; ok: boolean; detail: string; kind: string };

interface EliosState {
  open: boolean;
  busy: boolean;
  messages: Msg[];
  contents: Content[];
  configured: boolean | null;
}
export const useElios = create<EliosState>(() => ({ open: false, busy: false, messages: [], contents: [], configured: null }));
let seq = 0;
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
const push = (m: DistributiveOmit<Msg, 'id'>) => useElios.setState((s) => ({ messages: [...s.messages, { ...m, id: ++seq } as Msg] }));

const LABEL: Record<string, string> = {
  get_context: 'Letto lo stato della postazione', find_roads: 'Cercate strade', find_place: 'Cercato un luogo', search_catalog: 'Consultato il catalogo',
  fly_to: 'Mappa spostata', select_roads: 'Strade selezionate', set_mode: 'Modalità cambiata', open_panel: 'Pannello aperto',
  set_speed_limit: 'Limite di velocità', set_oneway: 'Senso di marcia', rename_road: 'Strada rinominata', create_zone: 'Zona creata',
  place_sign: 'Segnale posato', place_along_road: 'Elementi distribuiti', undo: 'Annullato', apply_operations: 'Operazioni applicate',
};

function describe(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const r = result as Record<string, unknown>;
  const bits: string[] = [];
  for (const k of ['changed', 'placed', 'applied', 'count', 'selected', 'roads', 'phases', 'junctions']) if (typeof r[k] === 'number') bits.push(`${r[k]}`);
  return bits.length ? `· ${bits.join(' · ')}` : '';
}

/** Compact description of what is on screen, sent with every request. */
function context() {
  const s = useApp.getState();
  return {
    project: s.project?.name, city: s.baseline?.name, bbox: s.baseline?.bbox, scenario: s.scenario?.name, scenarioIsBaseline: s.scenario?.isBaseline,
    mode: s.mode, tool: s.tool, selection: s.selection ? { kind: s.selection.kind, ids: s.selection.ids.slice(0, 10) } : null,
    today: new Date().toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  };
}

export async function askElios(text: string): Promise<void> {
  const st = useElios.getState();
  if (st.busy || !text.trim()) return;
  push({ who: 'user', text: text.trim() });
  let contents: Content[] = [...st.contents, { role: 'user', parts: [{ text: text.trim() }] }];
  useElios.setState({ busy: true, contents });
  try {
    for (let step = 0; step < 8; step++) {
      const res = await api.post<{ status: string; parts: Part[] }>('/api/elios/chat', { contents, tools: declarations(), context: context() });
      if (res.status === 'not_configured') useElios.setState({ configured: false });
      const parts = res.parts ?? [];
      contents = [...contents, { role: 'model', parts }];
      for (const p of parts) if (p.text) push({ who: 'elios', text: p.text });
      const calls = parts.filter((p) => p.functionCall);
      if (!calls.length || res.status !== 'ok') break;
      const responses: Part[] = [];
      for (const c of calls) {
        const { name, args } = c.functionCall!;
        const tool = toolByName(name);
        try {
          if (!tool) throw new Error(`Strumento sconosciuto: ${name}`);
          const result = await tool.run(args ?? {});
          responses.push({ functionResponse: { name, response: { result: result ?? { ok: true } } } });
          if (tool.kind !== 'read') push({ who: 'action', tool: name, ok: true, kind: tool.kind, detail: `${tool.label ?? LABEL[name] ?? name} ${describe(result)}` });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          responses.push({ functionResponse: { name, response: { error: message } } });
          push({ who: 'action', tool: name, ok: false, kind: tool?.kind ?? 'write', detail: `${tool?.label ?? LABEL[name] ?? name}: ${message}` });
        }
      }
      contents = [...contents, { role: 'user', parts: responses }];
    }
  } catch (e) {
    push({ who: 'elios', text: e instanceof ApiError && e.status === 402 ? e.message : `Non riesco a rispondere: ${e instanceof Error ? e.message : String(e)}` });
  } finally {
    useElios.setState({ busy: false, contents });
  }
}

const SUGGESTIONS = [
  'Crea una zona 30 attorno alla selezione',
  'Metti alberi ogni 8 metri su entrambi i lati della strada selezionata',
  'Vieta il transito ai camion oltre 3,5 t sulla strada selezionata',
  'Quali strade sono più lunghe di 500 m qui intorno?',
  'Spiegami come impostare un piano semaforico a 3 fasi',
];

/** Minimal Markdown: paragraphs, **bold**, bullet lists. */
function Rich({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((t, i) => (t.startsWith('**') ? <strong key={i}>{t.slice(2, -2)}</strong> : <span key={i}>{t}</span>));
  return <>{blocks.map((b, i) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))) return <ul key={i}>{lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s/, ''))}</li>)}</ul>;
    return <p key={i}>{lines.map((l, j) => <span key={j}>{inline(l)}{j < lines.length - 1 ? <br /> : null}</span>)}</p>;
  })}</>;
}

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; start(): void; stop(): void };

/** Rail entry: Elios opens as a panel beside the tool rail. */
export function toggleElios(): void { useElios.setState((s) => ({ open: !s.open })); }

export function EliosPanel() {
  const { open, busy, messages, configured } = useElios();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const rec = useRef<Recognition | null>(null);
  useEffect(() => {
    if (open && configured === null) api.get<{ configured: boolean }>('/api/elios/status').then((s) => useElios.setState({ configured: s.configured })).catch(() => undefined);
  }, [open, configured]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' }); }, [messages.length, busy]);
  if (!open) return null;
  const send = () => { const t = text; setText(''); void askElios(t); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } e.stopPropagation(); };
  const SR = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
  const listen = () => {
    if (!SR) return;
    if (listening) { rec.current?.stop(); return; }
    const r = new SR();
    r.lang = 'it-IT';
    r.interimResults = false;
    r.onresult = (e) => { const t = Array.from(e.results).map((x) => x[0]!.transcript).join(' '); setText((v) => (v ? `${v} ${t}` : t)); };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };
  return (
    <section className="elios" aria-label="Elios">
      <header className="elios-head">
        <span className="elios-mark"><Icon name="sparkle" size={16} /></span>
        <div><strong>Elios</strong><span>Assistente AI di DRIP Urban</span></div>
        <span className="spacer" />
        {messages.length ? <button type="button" className="elios-mini" onClick={() => useElios.setState({ messages: [], contents: [] })}>Nuova chat</button> : null}
        <button type="button" className="elios-mini" aria-label="Chiudi" onClick={() => useElios.setState({ open: false })}><Icon name="close" size={14} /></button>
      </header>
      <div className="elios-body" ref={list}>
        {configured === false ? (
          <div className="elios-note">
            <p>Per attivarmi serve una chiave <strong>Google Gemini</strong>. Resta su questo computer e non arriva mai al browser.</p>
            <button type="button" className="elios-chip" onClick={() => setDock('settings')}>Apri Impostazioni → Fonti dati e chiavi</button>
          </div>
        ) : null}
        {!messages.length ? (
          <div className="elios-empty">
            <p>Descrivimi cosa vuoi ottenere: individuo strade e incroci, modifico lo scenario e ti spiego le scelte secondo il Codice della Strada e i DM. Ogni modifica si annulla con Ctrl+Z.</p>
            <div className="elios-chips">{SUGGESTIONS.map((s) => <button key={s} type="button" className="elios-chip" onClick={() => void askElios(s)}>{s}</button>)}</div>
          </div>
        ) : null}
        {messages.map((m) => m.who === 'action' ? (
          <div key={m.id} className={`elios-action ${m.ok ? 'is-ok' : 'is-err'}`}><Icon name={m.ok ? (m.kind === 'write' ? 'check' : 'eye') : 'warning'} size={13} /><span>{m.detail}</span></div>
        ) : (
          <div key={m.id} className={`elios-msg is-${m.who}`}>{m.who === 'elios' ? <Rich text={m.text} /> : m.text}</div>
        ))}
        {busy ? <div className="elios-msg is-elios is-typing" aria-live="polite"><span /><span /><span /></div> : null}
      </div>
      <footer className="elios-input">
        <textarea rows={2} value={text} placeholder="Chiedi a Elios… (Invio per inviare)" onChange={(e) => setText(e.target.value)} onKeyDown={onKey} aria-label="Messaggio per Elios" />
        <div className="elios-actions">
          {SR ? <button type="button" className={`elios-mini ${listening ? 'is-on' : ''}`} onClick={listen} aria-label="Detta">{listening ? 'Ascolto…' : 'Detta'}</button> : null}
          <button type="button" className="elios-send" onClick={send} disabled={busy || !text.trim()} aria-label="Invia"><Icon name="send" size={16} /></button>
        </div>
      </footer>
    </section>
  );
}
