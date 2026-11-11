import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,realpath,readdir,readFile,rm,stat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createPublicAuth} from '../src/public-auth.mjs';
import {FileJournalStore} from '../../client/src/file-journal.mjs';
import {nativeKeyAddress} from '../../client/src/native.mjs';
import {release,abi} from '../../client/test/synthesis-fixture.mjs';

// Ephemeral in-memory test identities only. Never a wallet file or real key.
function wallet(){const pair=generateKeyPairSync('ed25519');return {actor:nativeKeyAddress(Buffer.from(pair.publicKey.export({format:'der',type:'spki'})).subarray(-32)),signature:message=>sign(null,Buffer.from(message,'utf8'),pair.privateKey).toString('base64')};}
const cookieHeader=value=>value.split(';')[0],token=value=>cookieHeader(value).split('=')[1];
async function fixture(run,extra={}){
  const directory=await mkdtemp(path.join(await realpath(tmpdir()),'biolab-public-auth-'));let time=Date.UTC(2026,9,25,12,0,0);
  try{const options={release,abi,origin:'https://biolab.example',stateDirectory:directory,clock:()=>time,...extra},auth=await createPublicAuth(options),a=wallet(),b=wallet();await run({directory,options,auth,a,b,now:()=>time,setTime:value=>time=value,restart:()=>createPublicAuth(options)});}finally{await rm(directory,{recursive:true,force:true});}
}
async function login(auth,wallet,extra={}){const c=await auth.issueChallenge({actor:wallet.actor}),result=await auth.login({challengeId:c.challengeId,signatureBase64:wallet.signature(c.message),...extra});return {...result,challenge:c};}
async function stored(directory){const files=(await readdir(directory)).filter(v=>v.endsWith('.json'));assert.equal(files.length,1);const envelope=JSON.parse(await readFile(path.join(directory,files[0]),'utf8'));return {files,envelope,value:JSON.parse(envelope.payload)};}

test('login challenge binds exact trusted HTTPS origin/context/wallet and authorizes no transaction; cookie contains only an opaque random token',async()=>fixture(async({auth,a,b,directory})=>{
  const config=auth.publicConfig();assert.equal(config.origin,'https://biolab.example');assert.equal(config.enabled,true);assert.deepEqual(Object.keys(config.context),['releaseHash','abiHash','domainHex','configHex']);assert.equal(config.transactionsAuthorized,false);
  const c=await auth.issueChallenge({actor:a.actor});assert.match(c.message,/This is a login message, not a transaction\./);assert.match(c.message,/Signing does not authorize transactions/);for(const value of [config.origin,...Object.values(config.context),a.actor,c.challengeId])assert.ok(c.message.includes(value));assert.match(c.message,/Nonce: [0-9a-f]{64}/);
  await assert.rejects(auth.login({challengeId:c.challengeId,signatureBase64:b.signature(c.message)}),/AUTH_SIGNATURE_INVALID/);
  const result=await auth.login({challengeId:c.challengeId,signatureBase64:a.signature(c.message)});assert.equal(result.publicSession.actor,a.actor);assert.match(result.cookie,/^__Host-biolab_session=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=1800; HttpOnly; Secure; SameSite=Strict$/);assert.equal(result.cookie.includes('Domain='),false);assert.equal(result.cookie.includes(a.actor),false);
  const principal=await auth.authenticate({cookieHeader:`untrusted_actor=${b.actor}; ${cookieHeader(result.cookie)}`});assert.equal(principal.actor,a.actor);assert.deepEqual(principal.context,config.context);assert.equal(principal.token,undefined);assert.equal(principal.sessionId,undefined);assert.equal(await auth.authenticate({cookieHeader:undefined}),null);
  const saved=await stored(directory),body=JSON.stringify(saved.value);assert.equal(body.includes(token(result.cookie)),false);assert.equal(body.includes(a.signature(c.message)),false);assert.equal(saved.value.sessions.length,1);assert.match(saved.value.sessions[0].hash,/^[0-9a-f]{64}$/);assert.equal(saved.value.challenges[0].used,true);assert.equal(saved.value.challenges[0].attempts,2);
  assert.equal((await stat(directory)).mode&0o777,0o700);assert.equal((await stat(path.join(directory,saved.files[0]))).mode&0o777,0o600);
}));
test('durable one-use challenge has exactly one concurrent login winner across two instances and survives restart',async()=>fixture(async({auth,restart,a,directory})=>{
  const challenge=await auth.issueChallenge({actor:a.actor}),other=await restart(),args={challengeId:challenge.challengeId,signatureBase64:a.signature(challenge.message)},results=await Promise.allSettled([auth.login(args),other.login(args)]),good=results.filter(r=>r.status==='fulfilled'),bad=results.filter(r=>r.status==='rejected');assert.equal(good.length,1);assert.equal(bad.length,1);assert.equal(bad[0].reason.code,'AUTH_CHALLENGE_UNAVAILABLE');
  const next=await restart();assert.equal((await next.authenticate({cookieHeader:cookieHeader(good[0].value.cookie)})).actor,a.actor);await assert.rejects(next.login(args),/AUTH_CHALLENGE_UNAVAILABLE/);assert.equal((await stored(directory)).value.sessions.length,1);
}));
test('challenge and absolute session expiry prune durably and clock rollback cannot resurrect an expired session',async()=>fixture(async({auth,a,now,setTime,directory,restart})=>{
  const challenge=await auth.issueChallenge({actor:a.actor}),start=now();setTime(start+10000);await assert.rejects(auth.login({challengeId:challenge.challengeId,signatureBase64:a.signature(challenge.message)}),/AUTH_CHALLENGE_UNAVAILABLE/);assert.equal((await stored(directory)).value.challenges.length,0);
  const result=await login(auth,a);setTime(now()+30000);assert.equal(await auth.authenticate({cookieHeader:cookieHeader(result.cookie)}),null);assert.equal((await stored(directory)).value.sessions.length,0);
  setTime(start+11000);await assert.rejects((await restart()).authenticate({cookieHeader:cookieHeader(result.cookie)}),/AUTH_CLOCK_REGRESSION/);
},{challengeTtlSeconds:10,sessionTtlSeconds:30}));
test('logout/replacement revoke protected sessions without trusting an actor cookie; switching wallets requires a new correct proof',async()=>fixture(async({auth,a,b,restart})=>{
  const first=await login(auth,a),c=await auth.issueChallenge({actor:b.actor});await assert.rejects(auth.login({challengeId:c.challengeId,signatureBase64:a.signature(c.message),cookieHeader:cookieHeader(first.cookie)}),/AUTH_SIGNATURE_INVALID/);assert.equal((await auth.authenticate({cookieHeader:cookieHeader(first.cookie)})).actor,a.actor);
  const second=await auth.login({challengeId:c.challengeId,signatureBase64:b.signature(c.message),cookieHeader:cookieHeader(first.cookie)});assert.equal(second.publicSession.actor,b.actor);assert.equal(await auth.authenticate({cookieHeader:cookieHeader(first.cookie)}),null);assert.equal((await auth.authenticate({cookieHeader:cookieHeader(second.cookie)})).actor,b.actor);
  const removed=await auth.revoke({cookieHeader:cookieHeader(second.cookie)});assert.equal(removed.revoked,true);assert.match(removed.cookie,/Max-Age=0; HttpOnly; Secure; SameSite=Strict$/);assert.equal(await(await restart()).authenticate({cookieHeader:cookieHeader(second.cookie)}),null);assert.equal((await auth.revoke({cookieHeader:undefined})).revoked,true);
},{limits:{maxSessions:1,maxActorSessions:1}}));
test('origin separation and malformed signatures/cookies cannot substitute a different actor/context',async()=>fixture(async({auth,a,b,options})=>{
  const first=await login(auth,a),other=await createPublicAuth({...options,origin:'https://another.example'}),challenge=await other.issueChallenge({actor:a.actor});await assert.rejects(other.login({challengeId:challenge.challengeId,signatureBase64:a.signature(first.challenge.message)}),/AUTH_SIGNATURE_INVALID/);assert.equal(await other.authenticate({cookieHeader:cookieHeader(first.cookie)}),null);
  await assert.rejects(auth.authenticate({cookieHeader:`${cookieHeader(first.cookie)}; ${cookieHeader(first.cookie)}`}),/AUTH_COOKIE/);await assert.rejects(auth.authenticate({cookieHeader:`__Host-biolab_session=${token(first.cookie)}.${b.actor}`}),/AUTH_COOKIE/);
  await assert.rejects(auth.issueChallenge({actor:'11111111111111111111111111111111'}),/AUTH_ACTOR/);await assert.rejects(auth.issueChallenge({actor:a.actor,now:1}),/AUTH_FIELDS/);await assert.rejects(auth.login({challengeId:first.challenge.challengeId,signatureBase64:'A'.repeat(88)}),/AUTH_SIGNATURE_ENCODING/);
  for(const origin of ['http://biolab.example','https://user:secret@biolab.example','https://biolab.example/','https://biolab.example/path','https://localhost','http://127.0.0.1:3000','https://192.168.1.1'])await assert.rejects(createPublicAuth({...options,origin}),/AUTH_ORIGIN/);
  const local=await createPublicAuth({...options,origin:'http://localhost:3000',allowLocalhost:true});assert.equal(local.publicConfig().cookieName,'biolab_session');const localLogin=await login(local,b);assert.match(localLogin.cookie,/; HttpOnly; Secure; SameSite=Strict$/);
}));
test('attempt, active challenge, global issue and session capacity limits fail closed and recover through bounded pruning',async()=>fixture(async({auth,a,b,now,setTime,directory})=>{
  const c=await auth.issueChallenge({actor:a.actor});await assert.rejects(auth.issueChallenge({actor:a.actor}),/AUTH_CHALLENGE_LIMIT/);const wrong=b.signature(c.message);await assert.rejects(auth.login({challengeId:c.challengeId,signatureBase64:wrong}),/AUTH_SIGNATURE_INVALID/);await assert.rejects(auth.login({challengeId:c.challengeId,signatureBase64:wrong}),/AUTH_SIGNATURE_INVALID/);await assert.rejects(auth.login({challengeId:c.challengeId,signatureBase64:a.signature(c.message)}),/AUTH_CHALLENGE_UNAVAILABLE/);
  await assert.rejects(auth.issueChallenge({actor:b.actor}),/AUTH_RATE_LIMIT/);setTime(now()+121000);const one=await login(auth,a);await assert.rejects(login(auth,b),/AUTH_SESSION_LIMIT/);assert.equal((await auth.authenticate({cookieHeader:cookieHeader(one.cookie)})).actor,a.actor);const data=(await stored(directory)).value;assert.ok(data.challenges.length<=2);assert.equal(data.sessions.length,1);
},{limits:{maxChallenges:2,maxSessions:1,maxActorChallenges:1,maxIssuesPerMinute:2,maxAttempts:2}}));
test('malformed protected data, wrong context, symlink and crypto/provider failures never expose private source, signature or cookie',async()=>fixture(async({auth,a,directory,options})=>{
  const result=await login(auth,a),{files}=await stored(directory),file=await FileJournalStore.open({directory,name:files[0]}),before=await file.load(),secret=`PRIVATE-${token(result.cookie)}-${a.signature(result.challenge.message)}`;await file.compareAndSwap(before.revision,`{"private":"${secret}",`);
  let error;try{await auth.authenticate({cookieHeader:cookieHeader(result.cookie)});}catch(e){error=e;}assert.equal(error.code,'AUTH_STORE_FORMAT');assert.equal(JSON.stringify(error).includes(secret),false);assert.equal(String(error.stack).includes(secret),false);assert.deepEqual(Object.keys(error),['code']);
  const freshDirectory=path.join(directory,'separate'),other=await createPublicAuth({...options,stateDirectory:freshDirectory}),loginOther=await login(other,a),rows=await stored(freshDirectory),otherStore=await FileJournalStore.open({directory:freshDirectory,name:rows.files[0]}),old=await otherStore.load(),v=JSON.parse(old.payload);v.binding.domainHex='00'.repeat(32);await otherStore.compareAndSwap(old.revision,JSON.stringify(v));await assert.rejects(other.authenticate({cookieHeader:cookieHeader(loginOther.cookie)}),/AUTH_STORE_CONTEXT/);
  const alias=path.join(directory,'alias');await symlink(freshDirectory,alias);await assert.rejects(createPublicAuth({...options,stateDirectory:alias}),e=>e.code==='AUTH_STORAGE_OR_CRYPTO_UNAVAILABLE'&&!e.message.includes(alias));
  await assert.rejects(createPublicAuth({...options,abi:{...abi,hash:'00'.repeat(32)}}),/AUTH_ABI/);await assert.rejects(createPublicAuth({...options,challengeTtlSeconds:301}),/AUTH_POLICY/);
}));
