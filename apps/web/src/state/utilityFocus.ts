import {create} from 'zustand';
/** Transient editor focus only; utility geometry belongs to ScenarioHistory. */
export const useUtilityFocus=create<{kind:'node'|'link';id:string}|{kind:null;id:string}>(()=>({kind:null,id:''}));
