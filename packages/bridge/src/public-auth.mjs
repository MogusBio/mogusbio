import {createHash,createPublicKey,randomBytes,timingSafeEqual,verify} from 'node:crypto';
import {isIP} from 'node:net';
import {isOffCurveAddress} from '@solana/kit';
import {nativeKeyAddress,nativeKeyBytes} from '../../client/src/native.mjs';
import {validateProductionRelease,baseConfigR2Id,PROGRAMS} from '../../client/src/release.mjs';
import {FileJournalStore} from '../../client/src/file-journal.mjs';
import {isDevnetRelease} from '../../client/src/cluster.mjs';

const marked=new WeakSet(),MAX_TIME=253402300799,MAX_TEXT=4*1024*1024;
const fail=code=>{const error=Object.assign(new Error(code),{code});marked.add(error);return error;};
const check=(v,code)=>{if(!v)throw fail(code);};
const guard=async f=>{try{return await f();}catch(e){throw fail(marked.has(e)?e.code:'AUTH_STORAGE_OR_CRYPTO_UNAVAILABLE');}};
const fields=(v,required,optional=[])=>check(v&&Object.getPrototypeOf(v)===Object.prototype&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k)),'AUTH_FIELDS');
const hex=v=>Buffer.from(v).toString('hex'),hash=v=>createHash('sha256').update(v).digest('hex');
const id=v=>{check(typeof v==='string'&&/^[0-9a-f]{64}$/.test(v),'AUTH_ID');return v;};
const integer=(v,min,max)=>check(Number.isSafeInteger(v)&&v>=min&&v<=max,'AUTH_POLICY');
const seconds=v=>{check(Number.isSafeInteger(v)&&v>=0&&v<=MAX_TIME,'AUTH_TIME');return v;};
const decimal=v=>{check(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v)&&v.length<=12,'AUTH_RECORD_TIME');return seconds(Number(v));};
const iso=n=>new Date(seconds(n)*1000).toISOString();
const defaults={maxChallenges:512,maxSessions:4096,maxActorChallenges:3,maxActorSessions:8,maxIssuesPerMinute:120,maxActorIssuesPerMinute:6,maxLoginsPerMinute:600,maxAttempts:5};
const hard={maxChallenges:1024,maxSessions:8192,maxActorChallenges:32,maxActorSessions:64,maxIssuesPerMinute:1024,maxActorIssuesPerMinute:64,maxLoginsPerMinute:4096,maxAttempts:10};
function policy(value={}){fields(value,[],Object.keys(defaults));const p={...defaults,...value};for(const k of Object.keys(p))integer(p[k],1,hard[k]);return Object.freeze(p);}
function actorKey(value){try{check(typeof value==='string','AUTH_ACTOR');const actor=nativeKeyAddress(value);check(actor!==PROGRAMS.systemProgram&&!isOffCurveAddress(actor),'AUTH_ACTOR');return actor;}catch{throw fail('AUTH_ACTOR');}}
function originValue(value,allowLocalhost){
  check(typeof value==='string'&&value.length<=512&&typeof allowLocalhost==='boolean','AUTH_ORIGIN');let u;try{u=new URL(value);}catch{throw fail('AUTH_ORIGIN');}
  check(value===u.origin&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/','AUTH_ORIGIN');const h=u.hostname,loopback=['localhost','127.0.0.1','[::1]'].includes(h);
  if(loopback)check(allowLocalhost&&(u.protocol==='https:'||u.protocol==='http:'),'AUTH_ORIGIN');else check(u.protocol==='https:'&&!isIP(h)&&h.includes('.')&&!h.endsWith('.localhost')&&!h.endsWith('.local'),'AUTH_ORIGIN');
  return {origin:u.origin,loopback};
}
function message(binding,c){return ['BioLab wallet sign-in','This is a login message, not a transaction.','Signing does not authorize transactions, token transfers, or material use.',`Origin: ${binding.origin}`,`Release: ${binding.releaseHash}`,`ABI: ${binding.abiHash}`,`Domain: ${binding.domainHex}`,`Config: ${binding.configHex}`,`Actor: ${c.actor}`,`Challenge: ${c.id}`,`Nonce: ${c.nonce}`,`Issued At: ${iso(c.issuedAt)}`,`Expiration Time: ${iso(c.expiresAt)}`].join('\n');}
function cookieToken(header,name){
  if(header===undefined||header===null||header==='')return null;check(typeof header==='string'&&header.length<=4096,'AUTH_COOKIE');const parts=header.split(';');check(parts.length<=64,'AUTH_COOKIE');let found=null;
  for(const part of parts){const at=part.indexOf('=');if(at<0)continue;if(part.slice(0,at).trim()!==name)continue;check(found===null,'AUTH_COOKIE');const token=part.slice(at+1).trim();check(/^[A-Za-z0-9_-]{43}$/.test(token)&&Buffer.from(token,'base64url').length===32&&Buffer.from(token,'base64url').toString('base64url')===token,'AUTH_COOKIE');found=token;}return found;
}
function signature(value){check(typeof value==='string'&&value.length===88,'AUTH_SIGNATURE_ENCODING');const bytes=Buffer.from(value,'base64');check(bytes.length===64&&bytes.toString('base64')===value,'AUTH_SIGNATURE_ENCODING');return bytes;}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** Trusted construction only. This verifies login messages and stores opaque
 * verifier hashes. It has no wallet key, transaction, RPC or send capability. */
export async function createPublicAuth(options){return guard(async()=>{
  fields(options,['release','abi','origin','stateDirectory'],['allowLocalhost','devnetLocalOrigin','clock','challengeTtlSeconds','sessionTtlSeconds','limits']);
  const {release,abi,stateDirectory,allowLocalhost=false,devnetLocalOrigin=false,clock=()=>Date.now(),challengeTtlSeconds=120,sessionTtlSeconds=1800}=options;check(typeof clock==='function','AUTH_CLOCK');integer(challengeTtlSeconds,1,300);integer(sessionTtlSeconds,1,3600);
  const pinned=await validateProductionRelease(structuredClone(release.input),{localPublicFixture:release.localPublicFixture});check(abi?.hash===pinned.hashes.abiHash.toString('hex'),'AUTH_ABI');check(typeof allowLocalhost==='boolean'&&typeof devnetLocalOrigin==='boolean','AUTH_LOCAL_ORIGIN_POLICY');check(!allowLocalhost||pinned.localPublicFixture===true,'AUTH_LOCAL_FIXTURE_ONLY');check(!devnetLocalOrigin||isDevnetRelease(pinned),'AUTH_DEVNET_LOCAL_ONLY');const trusted=originValue(options.origin,allowLocalhost||devnetLocalOrigin),limits=policy(options.limits),binding=Object.freeze({origin:trusted.origin,releaseHash:pinned.input.releaseHash,abiHash:abi.hash,domainHex:hex(pinned.domain),configHex:hex(baseConfigR2Id(pinned))}),namespace=hash(`BIO-PUBLIC-AUTH1\0${JSON.stringify(binding)}`),name=trusted.loopback?'biolab_session':'__Host-biolab_session',store=await FileJournalStore.open({directory:stateDirectory,name:`auth-${namespace}.json`});
  const publicContext=Object.freeze({releaseHash:binding.releaseHash,abiHash:binding.abiHash,domainHex:binding.domainHex,configHex:binding.configHex});
  const checkedActors=new Set(),actorCacheLimit=limits.maxSessions+limits.maxChallenges+limits.maxIssuesPerMinute;
  const wallet=value=>{if(typeof value==='string'&&checkedActors.has(value))return value;const actor=actorKey(value);if(checkedActors.size<actorCacheLimit)checkedActors.add(actor);return actor;};
  const now=()=>{const ms=clock();check(Number.isSafeInteger(ms)&&ms>=0,'AUTH_TIME');const value=seconds(Math.floor(ms/1000));check(value<=MAX_TIME-3600,'AUTH_TIME');return value;};
  const tokenHash=token=>hash(`BIO-PUBLIC-AUTH-TOKEN1\0${namespace}\0${token}`),makeCookie=(token,ttl)=>`${name}=${token}; Path=/; Max-Age=${ttl}; HttpOnly; Secure; SameSite=Strict`,clearCookie=()=>makeCookie('',0);
  const fresh=t=>({version:'BIO-PUBLIC-AUTH1',binding:{...binding},highWater:t,challenges:[],sessions:[],rates:{minute:Math.floor(t/60),issues:0,logins:0,actors:[]}});
  function encode(s){return JSON.stringify({version:s.version,binding:s.binding,highWater:String(s.highWater),challenges:s.challenges.map(c=>({...c,issuedAt:String(c.issuedAt),expiresAt:String(c.expiresAt)})),sessions:s.sessions.map(r=>({...r,issuedAt:String(r.issuedAt),expiresAt:String(r.expiresAt)})),rates:s.rates});}
  function decode(text,t){
    if(text===null)return fresh(t);check(typeof text==='string'&&Buffer.byteLength(text)<=MAX_TEXT,'AUTH_STORE_SIZE');let v;try{v=JSON.parse(text);}catch{throw fail('AUTH_STORE_FORMAT');}fields(v,['version','binding','highWater','challenges','sessions','rates']);fields(v.binding,Object.keys(binding));check(v.version==='BIO-PUBLIC-AUTH1'&&JSON.stringify(v.binding)===JSON.stringify(binding),'AUTH_STORE_CONTEXT');
    const highWater=decimal(v.highWater);check(t>=highWater,'AUTH_CLOCK_REGRESSION');check(Array.isArray(v.challenges)&&v.challenges.length<=limits.maxChallenges&&Array.isArray(v.sessions)&&v.sessions.length<=limits.maxSessions,'AUTH_STORE_BOUND');
    const challengeIds=new Set(),tokenHashes=new Set(),challenges=v.challenges.map(c=>{fields(c,['id','nonce','actor','issuedAt','expiresAt','used','attempts']);id(c.id);id(c.nonce);wallet(c.actor);const issuedAt=decimal(c.issuedAt),expiresAt=decimal(c.expiresAt);check(issuedAt<=highWater&&expiresAt>issuedAt&&expiresAt-issuedAt<=300&&typeof c.used==='boolean'&&Number.isInteger(c.attempts)&&c.attempts>=0&&c.attempts<=limits.maxAttempts&&!challengeIds.has(c.id),'AUTH_CHALLENGE_RECORD');challengeIds.add(c.id);return {...c,issuedAt,expiresAt};});
    const sessions=v.sessions.map(r=>{fields(r,['hash','actor','issuedAt','expiresAt']);id(r.hash);wallet(r.actor);const issuedAt=decimal(r.issuedAt),expiresAt=decimal(r.expiresAt);check(issuedAt<=highWater&&expiresAt>issuedAt&&expiresAt-issuedAt<=3600&&!tokenHashes.has(r.hash),'AUTH_SESSION_RECORD');tokenHashes.add(r.hash);return {...r,issuedAt,expiresAt};});
    fields(v.rates,['minute','issues','logins','actors']);integer(v.rates.minute,0,Math.floor(MAX_TIME/60));integer(v.rates.issues,0,limits.maxIssuesPerMinute);integer(v.rates.logins,0,limits.maxLoginsPerMinute);check(v.rates.minute<=Math.floor(highWater/60)&&Array.isArray(v.rates.actors)&&v.rates.actors.length<=limits.maxIssuesPerMinute,'AUTH_RATE_RECORD');const actors=new Set();for(const row of v.rates.actors){fields(row,['actor','count']);wallet(row.actor);integer(row.count,1,limits.maxActorIssuesPerMinute);check(!actors.has(row.actor),'AUTH_RATE_RECORD');actors.add(row.actor);}
    const state={...v,highWater,challenges,sessions};check(encode(state)===text,'AUTH_STORE_CANONICAL');return state;
  }
  async function change(work){
    for(let attempt=0;attempt<48;attempt++){const t=now();
      const before=await store.load(),s=decode(before.payload,t);s.highWater=t;s.challenges=s.challenges.filter(c=>c.expiresAt>t);s.sessions=s.sessions.filter(r=>r.expiresAt>t);if(s.rates.minute!==Math.floor(t/60))s.rates={minute:Math.floor(t/60),issues:0,logins:0,actors:[]};
      const result=work(s,t),text=encode(s);check(Buffer.byteLength(text)<=MAX_TEXT,'AUTH_STORE_SIZE');let saved=true;
      if(text!==before.payload)try{saved=await store.compareAndSwap(before.revision,text);}catch(e){if(!['FILE_CAS_GATE_BUSY','FILE_CAS_LOCK_BUSY'].includes(e?.code))throw e;await wait(1+Math.min(attempt,8));continue;}
      if(saved===false)continue;if(result.error)throw fail(result.error);return result.value;
    }throw fail('AUTH_STORE_BUSY');
  }
  function rate(s,kind,actor){
    const key=kind==='issue'?'issues':'logins',max=kind==='issue'?limits.maxIssuesPerMinute:limits.maxLoginsPerMinute;if(s.rates[key]>=max)return 'AUTH_RATE_LIMIT';s.rates[key]++;
    if(kind==='issue'){const row=s.rates.actors.find(r=>r.actor===actor);if(row&&row.count>=limits.maxActorIssuesPerMinute)return 'AUTH_RATE_LIMIT';if(row)row.count++;else s.rates.actors.push({actor,count:1});}return null;
  }
  function publicSession(row){return {actor:row.actor,expiresAt:iso(row.expiresAt),context:{...publicContext}};}
  function session(s,token){if(!token)return null;const expected=Buffer.from(tokenHash(token),'hex');return s.sessions.find(row=>timingSafeEqual(Buffer.from(row.hash,'hex'),expected))??null;}
  return Object.freeze({
    publicConfig(){return {enabled:true,origin:binding.origin,context:{...publicContext},cookieName:name,challengeTtlSeconds,sessionTtlSeconds,messageOnly:true,transactionsAuthorized:false};},
    issueChallenge:args=>guard(async()=>{
      fields(args,['actor']);const actor=wallet(args.actor),challengeId=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex');
      return change((s,t)=>{const blocked=rate(s,'issue',actor);if(blocked)return {error:blocked};if(s.challenges.length>=limits.maxChallenges||s.challenges.filter(c=>c.actor===actor&&!c.used).length>=limits.maxActorChallenges)return {error:'AUTH_CHALLENGE_LIMIT'};check(!s.challenges.some(c=>c.id===challengeId),'AUTH_RANDOM_COLLISION');const c={id:challengeId,nonce,actor,issuedAt:t,expiresAt:t+challengeTtlSeconds,used:false,attempts:0};s.challenges.push(c);return {value:{challengeId,message:message(binding,c),expiresAt:iso(c.expiresAt)}};});
    }),
    login:args=>guard(async()=>{
      fields(args,['challengeId','signatureBase64'],['cookieHeader']);id(args.challengeId);const sig=signature(args.signatureBase64),oldToken=cookieToken(args.cookieHeader,name),token=randomBytes(32).toString('base64url'),verifier=tokenHash(token);
      return change((s,t)=>{
        const blocked=rate(s,'login');if(blocked)return {error:blocked};const c=s.challenges.find(c=>c.id===args.challengeId);if(!c||c.used||c.attempts>=limits.maxAttempts)return {error:'AUTH_CHALLENGE_UNAVAILABLE'};c.attempts++;
        const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),nativeKeyBytes(c.actor)]),format:'der',type:'spki'});if(!verify(null,Buffer.from(message(binding,c),'utf8'),key,sig))return {error:'AUTH_SIGNATURE_INVALID'};
        const old=session(s,oldToken),remaining=s.sessions.filter(r=>r!==old);if(remaining.length>=limits.maxSessions||remaining.filter(r=>r.actor===c.actor).length>=limits.maxActorSessions)return {error:'AUTH_SESSION_LIMIT'};check(!s.sessions.some(r=>r.hash===verifier),'AUTH_RANDOM_COLLISION');c.used=true;const row={hash:verifier,actor:c.actor,issuedAt:t,expiresAt:t+sessionTtlSeconds};s.sessions=[...remaining,row];return {value:{cookie:makeCookie(token,sessionTtlSeconds),publicSession:publicSession(row)}};
      });
    }),
    authenticate:args=>guard(async()=>{fields(args,['cookieHeader']);const token=cookieToken(args.cookieHeader,name);if(token===null)return null;return change(s=>{const row=session(s,token);return {value:row?publicSession(row):null};});}),
    revoke:args=>guard(async()=>{fields(args,['cookieHeader']);const token=cookieToken(args.cookieHeader,name);if(token===null)return {cookie:clearCookie(),revoked:true};return change(s=>{const row=session(s,token);if(row)s.sessions=s.sessions.filter(r=>r!==row);return {value:{cookie:clearCookie(),revoked:true}};});}),
  });
});}
