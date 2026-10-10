import { useApp } from '../state/store';
import { useTwinUi, pickTwinVehicle, type FollowCamera } from './viewState';
import { Button, Section, Select, Stat, Toggle } from '../ui/controls';
const TURN: Record<string, string> = { left: 'Sinistra', right: 'Destra', through: 'Dritto', uturn: 'Inversione' };
export function TwinVehiclePanel() {
  const { vehicleId, telemetry, following, followCamera, showRoute } = useTwinUi();
  const network = useApp((s) => s.network);
  if (vehicleId === null) return null;
  return <aside className="twin-vehicle" aria-label="Telemetria veicolo Twin"><Section title={`Veicolo ${vehicleId}`}>
    {telemetry ? <>
      <div className="row"><Button variant={following ? 'default' : 'primary'} icon="camera" onClick={() => useTwinUi.setState({ following: !following })}>{following ? 'Interrompi inseguimento' : 'Segui veicolo'}</Button><Button size="sm" onClick={() => pickTwinVehicle(null)}>Chiudi</Button></div>
      <Select value={followCamera} ariaLabel="Camera inseguimento" options={[{ value: 'chase', label: 'Chase' }, { value: 'rear', label: 'Dietro' }, { value: 'front', label: 'Davanti' }, { value: 'top', label: 'Dall’alto' }, { value: 'side', label: 'Laterale' }, { value: 'cinematic', label: 'Cinematica' }, { value: 'drone', label: 'Drone / orbita' }]} onChange={(v) => useTwinUi.setState({ followCamera: v as FollowCamera })} />
      <Toggle label="Mostra percorso" checked={showRoute} onChange={(v) => useTwinUi.setState({ showRoute: v })} />
      <div className="stats-row"><Stat label="Velocità" value={telemetry.speedKmh.toFixed(1)} unit="km/h" /><Stat label="Ritardo attuale" value={Math.round(telemetry.delayS)} unit="s" /><Stat label="Tempo viaggio" value={Math.round(telemetry.travelS)} unit="s" /></div>
      {telemetry.transit&&<div className="stats-row"><Stat label={telemetry.transit.lineName} value={`${telemetry.transit.aboard}/${telemetry.transit.capacity}`} unit="pax"/><Stat label="Prossima fermata" value={telemetry.transit.nextStop??'Capolinea'}/><Stat label="Sosta residua" value={Math.ceil(telemetry.transit.dwellRemainingS)} unit="s"/></div>}
      <dl className="twin-telemetry"><dt>Categoria</dt><dd>{telemetry.cls}</dd><dt>Strada</dt><dd>{network?.roads[telemetry.roadId]?.name || telemetry.roadId}</dd><dt>Corsia</dt><dd>{telemetry.laneId ?? '—'}</dd><dt>Destinazione</dt><dd>{telemetry.destination.map((v) => v.toFixed(5)).join(', ')}</dd><dt>Prossima manovra</dt><dd>{telemetry.nextManoeuvre ? TURN[telemetry.nextManoeuvre] ?? telemetry.nextManoeuvre : 'Arrivo'}</dd><dt>Prossimo segnale</dt><dd>{telemetry.nextSignal ? { green: 'Verde', yellow: 'Giallo', red: 'Rosso' }[telemetry.nextSignal] : 'Non semaforizzato'}</dd></dl>
    </> : <><p className="muted">Veicolo arrivato o non più presente nel run corrente.</p><Button size="sm" onClick={() => pickTwinVehicle(null)}>Chiudi</Button></>}
  </Section></aside>;
}
