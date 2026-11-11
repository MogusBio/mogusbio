import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createOperatorBridge} from '../src/operator-bridge.mjs';
import {checkpoint,cloneAccounts,release,abi,actor,recordedTransport} from '../../client/test/synthesis-fixture.mjs';
import {key} from '../../client/test/native-fixture.mjs';
import {miningReadRequest,miningGlobalRequest,miningHourCloseRequest,miningLifecycleRequest,checkedMiningRead,checkedMiningPlan} from '../../../apps/player/dist/mining-operations.js';
import {competitionReadRequest,roundPlanRequest,checkedCompetitionRead,checkedCompetitionPlan} from '../../../apps/player/dist/research-operations.js';

// Browser-side validators and the actual bridge consume the same genuine
// checkpoint response. No permissive endpoint stub or new execution is used.
test('actual76b HTTP→browser mining contract: overview, one global step, saved-payer closure and transfer',async()=>{
  const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-a4-contract-')),map=cloneAccounts(checkpoint),transport=recordedTransport({actual:map},'actual',{strict:false});
  try{
    const bridge=await createOperatorBridge({release,abi,endpoint:'http://127.0.0.1:1',stateDirectory:directory,allowLocalhost:true,fetchImpl:transport.fetchImpl}),instanceHex=[...map.values()].find(a=>a.owner===release.input.programId&&a.data.length===761&&a.data.readUInt16LE(12)===4).data.subarray(120,152).toString('hex');
    const values={actor,instancesHex:[instanceHex],instanceHex,positionPageStart:'0',positionPageLimit:'5',maxRent:'100000000',hour:'340',newOwner:key(20)},readQuery=miningReadRequest(values),read=await bridge.dispatch('mining-read',readQuery),dashboard=checkedMiningRead(read,readQuery);
    assert.equal(dashboard.summary.claimable.actorAtoms,'0');assert.equal(dashboard.summary.roots[0].instanceHex,instanceHex);
    for(const [action,source,q]of [['global-plan','global',miningGlobalRequest(values)],['hour-close-plan','hour',miningHourCloseRequest(values)],['lifecycle-plan','lifecycle',miningLifecycleRequest(values,'transfer')]]){
      const response=await bridge.dispatch(action,q),plan=checkedMiningPlan(response,source,q);assert.ok(plan);assert.equal(plan.actor,actor);assert.equal(response.businessExecutionVerified,false);
    }
    const competition={executor:actor,round:'0',maxRent:values.maxRent,resources:JSON.stringify(miningGlobalRequest(values).resources)},readRound=competitionReadRequest(competition),round=roundPlanRequest(competition);
    assert.ok(checkedCompetitionRead(await bridge.dispatch('competition-read',readRound),readRound));assert.ok(checkedCompetitionPlan(await bridge.dispatch('round-plan',round),round,'round'));
    assert.ok(transport.calls.every(c=>['getGenesisHash','getMultipleAccounts'].includes(c.method)));
  }finally{await rm(directory,{recursive:true,force:true});}
});
