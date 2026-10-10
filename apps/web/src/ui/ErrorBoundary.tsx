import {Component,type ErrorInfo,type ReactNode} from 'react';
import {Button} from './controls';
/** Isolates a failed view without replacing the authored project, history or workers. */
export class ErrorBoundary extends Component<{children:ReactNode;label:string;onExit?:()=>void},{error:Error|null;attempt:number}> {
 override state={error:null as Error|null,attempt:0};
 static getDerivedStateFromError(error:Error){return{error};}
 override componentDidCatch(error:Error,info:ErrorInfo){console.error(`[DRIP ${this.props.label}]`,error,info.componentStack);}
 override render(){if(this.state.error)return <div className="view-error" role="alert"><strong>{this.props.label} non disponibile</strong><p>Il progetto e la cronologia restano aperti. Puoi ricreare questa vista.</p><details><summary>Dettagli errore</summary><pre>{this.state.error.message}</pre></details><div className="inspector-actions"><Button onClick={()=>this.setState(s=>({error:null,attempt:s.attempt+1}))}>Riprova {this.props.label}</Button>{this.props.onExit&&<Button variant="ghost" onClick={this.props.onExit}>Torna alla mappa</Button>}</div></div>;return <div className="boundary-content" key={this.state.attempt}>{this.props.children}</div>;}
}
