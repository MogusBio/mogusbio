import { isOffCurveAddress } from '@solana/kit';
import { asBytes,initialTicks,speciesCreditInt,MATERIAL_CLASSES } from '../../protocol-core/src/index.mjs';
import { ReadOnlyRpc } from './rpc.mjs';
import { PROGRAMS } from './release.mjs';
import { nativeKeyAddress,nativeKeyBytes,nativePda } from './native.mjs';
import { decodeNativeBaseConfig,decodeNativeProject,decodeNativeSource,decodeClassicMint,decodeClassicTokenAccount } from './accounts.mjs';
import { decodeNativeEconomyConfig,decodeNativeClock } from './economy-accounts.mjs';
import { decodeActorNonceSnapshot } from './journal.mjs';

export const MATERIAL_INVENTORY_LIMITS=Object.freeze({projects:8,sources:16,accounts:93});
const check=(v,c)=>{if(!v)throw Object.assign(new Error(c),{code:c});};
const fields=['release','rpc','actor','projectIds','sourceIds'];
const hex=b=>Buffer.from(b).toString('hex');
const pda=(release,...seeds)=>nativePda(release.input.programId,'bio',...seeds).then(p=>p.address);
const fresh=a=>a===null||a.owner===PROGRAMS.systemProgram&&a.executable===false&&asBytes(a.data).length===0;
const same=(a,b)=>a===null||b===null?a===b:a.address===b.address&&a.owner===b.owner&&a.executable===b.executable
  &&a.lamports===b.lamports&&asBytes(a.data).equals(asBytes(b.data));
const credits=ticks=>ticks.reduce((n,t,i)=>n+speciesCreditInt(i+1,t),0n);
const strings=values=>values.map(String);
const flags={clientPlanOnly:true,transactionExecuted:false,networkSubmitted:false,businessExecutionVerified:false,
  reservesOnChainNonce:false,knownInventoryOnly:true,walletWideDiscovery:false};
function ids(values,max,code){
  check(Array.isArray(values)&&values.length<=max,code);const copied=values.map(value=>asBytes(value,32));
  check(new Set(copied.map(hex)).size===copied.length,'INVENTORY_DUPLICATE_ID');return copied.sort(Buffer.compare);
}
async function batch(rpc,keys){
  const addresses=[...new Set(Object.values(keys))];check(addresses.length<=MATERIAL_INVENTORY_LIMITS.accounts,'INVENTORY_ACCOUNT_BOUND');
  const {contextSlot,accounts}=await rpc.getMultipleAccounts(addresses);
  return {contextSlot,accounts:new Map(addresses.map((address,i)=>[address,accounts[i]]))};
}
async function commonFacts(release,actor,keys,read){
  const get=name=>read.accounts.get(keys[name]);
  await decodeNativeBaseConfig(release,get('Base'));const economy=await decodeNativeEconomyConfig(release,get('Economy'));
  const clock=decodeNativeClock(get('Clock')),wallet=get('Actor');
  check(wallet&&wallet.address===actor&&wallet.owner===PROGRAMS.systemProgram&&wallet.executable===false
    &&asBytes(wallet.data).length===0&&!isOffCurveAddress(actor)&&actor!==PROGRAMS.systemProgram,'INVENTORY_ACTOR_WALLET');
  check(clock.unixTimestamp>=economy.initializedAt,'INVENTORY_CLOCK_BEFORE_INIT');
  const nonce=await decodeActorNonceSnapshot({release,actor,address:keys.Nonce,account:get('Nonce'),contextSlot:read.contextSlot,commitment:'finalized'});
  return {clock,nonce,actorLamports:wallet.lamports,initializedAt:economy.initializedAt};
}
function forward(first,last){
  check(last.clock.slot>=first.clock.slot&&last.clock.unixTimestamp>=first.clock.unixTimestamp,'INVENTORY_CLOCK_REGRESSION');
  check(last.nonce.nextNonce>=first.nonce.nextNonce,'INVENTORY_NONCE_REGRESSION');
}
function stable(first,last,keys){
  return Object.entries(keys).every(([name,address])=>name==='Clock'||same(first.accounts.get(address),last.accounts.get(address)));
}
async function sourceFacts(release,read,keys,sourceIds,actor,clock){
  const sources=new Map();
  for(const id of sourceIds){
    const account=read.accounts.get(keys[`Source:${hex(id)}`]);check(!fresh(account),'INVENTORY_SOURCE_MISSING');
    const source=await decodeNativeSource(release,account,id);
    check(source.inventoryOwner.equals(nativeKeyBytes(actor)),'INVENTORY_SOURCE_OWNER');
    check(source.createdAt<=clock.unixTimestamp&&source.createdSlot<=clock.slot,'INVENTORY_SOURCE_FUTURE');
    sources.set(hex(id),source);
  }
  return sources;
}
async function completeFacts(release,actor,keys,read,projectRows,sourceIds){
  const common=await commonFacts(release,actor,keys,read),owner=nativeKeyBytes(actor),projects=new Map(),mints=new Map(),tokens=new Map();
  const mintFacts=[],tokenFacts=[],unitTotals=Array(4).fill(0n),availableTicks=Array(32).fill(0n);
  for(const row of projectRows){
    const account=read.accounts.get(row.address);check(!fresh(account),'INVENTORY_PROJECT_MISSING');
    const project=await decodeNativeProject(release,account,row.id);
    check(project.createdAt>=common.initializedAt,'INVENTORY_PROJECT_BEFORE_INIT');
    check(project.createdAt<=common.clock.unixTimestamp&&project.createdSlot<=common.clock.slot,'INVENTORY_PROJECT_FUTURE');
    projects.set(hex(row.id),project);
    for(const c of row.classes){
      const value=project.classes[c.class-1],mint=decodeClassicMint(read.accounts.get(c.mint),{expectedAddress:c.mint,expectedDecimals:0,
        expectedMintAuthority:c.authority,expectedFreezeAuthority:null});
      check(mint.supply<=value.issued-value.intakeBurned,'INVENTORY_MINT_SUPPLY');
      mints.set(hex(nativeKeyBytes(mint.address)),{...mint,mintAuthority:nativeKeyBytes(mint.mintAuthority),freezeAuthority:null});
      const tokenAccount=read.accounts.get(c.ata),missing=fresh(tokenAccount);let amount=0n;
      if(!missing){
        const token=decodeClassicTokenAccount(tokenAccount,{expectedAddress:c.ata,expectedMint:c.mint,expectedOwner:actor});
        check(token.amount<=mint.supply,'INVENTORY_TOKEN_SUPPLY');amount=token.amount;
        tokens.set(hex(nativeKeyBytes(c.ata)),{...token,owner:Buffer.from(owner),mint:nativeKeyBytes(token.mint),initialized:true,native:false,frozen:false});
      }
      unitTotals[c.class-1]+=amount;
      // initialTicks deliberately bounds an individual intake to one million;
      // a wallet balance can be larger across projects, so aggregate per mint.
      const ticks=initialTicks(c.class,1n);for(let i=0;i<32;i++)availableTicks[i]+=ticks[i]*amount;
      mintFacts.push({projectIdHex:hex(row.id),class:c.class,address:c.mint,authority:c.authority,supply:String(mint.supply),decimals:0});
      tokenFacts.push({projectIdHex:hex(row.id),class:c.class,address:c.ata,mint:c.mint,owner:actor,missing,amount:String(amount),
        prefundedLamports:missing?String(tokenAccount?.lamports??0n):'0'});
    }
  }
  const sources=await sourceFacts(release,read,keys,sourceIds,actor,common.clock),sourceUnits=new Map();
  const initial=Array(32).fill(0n),spent=Array(32).fill(0n),remaining=Array(32).fill(0n),sourceSummary=[];
  for(const [id,source]of sources){
    const project=projects.get(hex(source.projectId));check(project,'INVENTORY_SOURCE_PROJECT_CLOSURE');const c=project.classes[source.class-1];
    check(source.mint.equals(c.mint),'INVENTORY_SOURCE_PROJECT_MINT');
    check(source.createdAt>=project.createdAt&&source.createdSlot>=project.createdSlot,'INVENTORY_SOURCE_BEFORE_PROJECT');
    const pair=`${hex(source.projectId)}:${source.class}`,total=(sourceUnits.get(pair)??0n)+source.unitCount;sourceUnits.set(pair,total);
    check(total<=c.intakeBurned,'INVENTORY_SOURCE_BURN_COUNTER');
    for(let i=0;i<32;i++){initial[i]+=source.initialTick[i];spent[i]+=source.spentPrefix[i];remaining[i]+=source.remainingTick[i];}
    sourceSummary.push({sourceIdHex:id,projectIdHex:hex(source.projectId),class:source.class,mint:nativeKeyAddress(source.mint),owner:actor,
      unitCount:String(source.unitCount),initialTick:strings(source.initialTick),spentPrefix:strings(source.spentPrefix),remainingTick:strings(source.remainingTick)});
  }
  const available=availableTicks.map((n,i)=>n+remaining[i]);
  const summary={actor,actorLamports:String(common.actorLamports),contextSlot:String(read.contextSlot),nextNonce:String(common.nonce.nextNonce),
    clock:{slot:String(common.clock.slot),unixTimestamp:String(common.clock.unixTimestamp)},
    projects:projectRows.map(row=>{const project=projects.get(hex(row.id));return {projectIdHex:hex(row.id),address:row.address,name:project.name,
      classes:project.classes.map(c=>({class:c.class,mint:nativeKeyAddress(c.mint),cap:String(c.lifetimeCap),unitPriceLamports:String(c.priceLamports),issued:String(c.issued),intakeBurned:String(c.intakeBurned)}))};}),
    mints:mintFacts,tokenAccounts:tokenFacts,sources:sourceSummary,
    standardUnits:tokenFacts.map(t=>({projectIdHex:t.projectIdHex,class:t.class,mint:t.mint,tokenAccount:t.address,amount:t.amount,missing:t.missing})),
    sourceBudgets:sourceSummary.map(s=>({sourceIdHex:s.sourceIdHex,projectIdHex:s.projectIdHex,class:s.class,remainingTick:s.remainingTick})),
    totals:{ticks:strings(available),totalTick:String(available.reduce((n,t)=>n+t,0n)),creditInt:String(credits(available))},
    standardUnitsByClass:MATERIAL_CLASSES.map(c=>({class:c.id,symbol:c.symbol,amount:String(unitTotals[c.id-1])})),
    speciesTicks:{availableFromStandardUnits:strings(availableTicks),sourceInitial:strings(initial),sourceSpent:strings(spent),sourceRemaining:strings(remaining)},
    milliRU:{availableFromStandardUnits:String(credits(availableTicks)),sourceInitial:String(credits(initial)),sourceSpent:String(credits(spent)),sourceRemaining:String(credits(remaining))},
    noLABBalanceIncluded:true,knownInventoryOnly:true,walletWideDiscovery:false};
  return {...common,inventory:{projects,mints,tokens,sources},summary};
}

/** Read actual finalized known-ID inventory. Source project closure and the
 * complete reread remain below one RPC batch; no user balance/nonce/prefix is
 * accepted. Maps are planner convenience, never spend or execution authority. */
export async function readMaterialInventory(args){
  check(args&&Object.getPrototypeOf(args)===Object.prototype&&Object.keys(args).sort().join(',')===[...fields].sort().join(','),'INVENTORY_FIELDS');
  const {release,rpc}=args;check(rpc instanceof ReadOnlyRpc,'INVENTORY_READ_ONLY_RPC');
  const actor=nativeKeyAddress(args.actor),requestedProjects=ids(args.projectIds,MATERIAL_INVENTORY_LIMITS.projects,'INVENTORY_PROJECT_LIMIT'),
    sourceIds=ids(args.sourceIds,MATERIAL_INVENTORY_LIMITS.sources,'INVENTORY_SOURCE_LIMIT');
  const keys={Base:release.pdas.baseConfig.address,Economy:await pda(release,'econ-config'),Clock:PROGRAMS.clockSysvar,
    Nonce:await pda(release,'actor-nonce',nativeKeyBytes(actor)),Actor:actor};
  for(const id of sourceIds)keys[`Source:${hex(id)}`]=await pda(release,'source',id);
  const discovery=await batch(rpc,keys),first=await commonFacts(release,actor,keys,discovery);
  const discoveredSources=await sourceFacts(release,discovery,keys,sourceIds,actor,first.clock);
  const projectIds=[...new Set([...requestedProjects.map(hex),...[...discoveredSources.values()].map(s=>hex(s.projectId))])].sort().map(id=>Buffer.from(id,'hex'));
  check(projectIds.length<=MATERIAL_INVENTORY_LIMITS.projects,'INVENTORY_PROJECT_CLOSURE_LIMIT');const projectRows=[];
  for(const id of projectIds){
    const row={id,address:await pda(release,'project',id),classes:[]};keys[`Project:${hex(id)}`]=row.address;
    for(let classId=1;classId<=4;classId++){
      const mint=await pda(release,'pack',id,Buffer.from([classId])),authority=await pda(release,'pack-auth',id,Buffer.from([classId]));
      const ata=(await nativePda(PROGRAMS.associatedTokenProgram,nativeKeyBytes(actor),nativeKeyBytes(PROGRAMS.tokenProgram),nativeKeyBytes(mint))).address;
      row.classes.push({class:classId,mint,authority,ata});keys[`Mint:${hex(id)}:${classId}`]=mint;keys[`ATA:${hex(id)}:${classId}`]=ata;
    }
    projectRows.push(row);
  }
  const expanded=await batch(rpc,keys),middle=await completeFacts(release,actor,keys,expanded,projectRows,sourceIds);forward(first,middle);
  const discoveryKeys=Object.fromEntries(Object.entries(keys).filter(([,address])=>discovery.accounts.has(address)));
  if(!stable(discovery,expanded,discoveryKeys))return {profile:'BIOP0R2-MATERIAL-INVENTORY1',decision:'REPLAN_STALE_STATE',reason:'DISCOVERY_CHANGED',actor,contextSlot:expanded.contextSlot,...flags};
  const final=await batch(rpc,keys),last=await completeFacts(release,actor,keys,final,projectRows,sourceIds);forward(middle,last);
  if(!stable(expanded,final,keys))return {profile:'BIOP0R2-MATERIAL-INVENTORY1',decision:'REPLAN_STALE_STATE',reason:'INVENTORY_CHANGED',actor,contextSlot:final.contextSlot,...flags};
  return {profile:'BIOP0R2-MATERIAL-INVENTORY1',decision:'INVENTORY_READ',actor,contextSlot:final.contextSlot,nextNonce:last.nonce.nextNonce,
    clock:last.clock,inventory:last.inventory,summary:last.summary,inventoryRecordsVerified:true,actualInventoryVerified:true,...flags};
}
