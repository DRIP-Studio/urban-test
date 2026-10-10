import {defineOperation} from './registry';
import {worksErrors} from '../analysis/works';
import type {WorksPhase} from '../model/types';
export const setWorks=defineOperation<{phases:readonly WorksPhase[]}>({type:'works.set',label:()=> 'Piano lavori e fasi temporali',validate:(net,p)=>worksErrors(p.phases,net).map(message=>({code:'works.invalid',severity:'error',message})),apply:(net,p)=>({...net,works:p.phases})});
