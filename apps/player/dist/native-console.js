// This module never chooses a release, RPC endpoint, journal path, or nonce.
// The same-origin server owns those boundaries and verifies every signature.
import {browserAuthMatches} from './auth-session.js';
import {groupWalletProviders,bindWalletOption,WALLET_SELECTION_EVENT} from './wallet-catalog.js';
const MAX_PACKET = 4096;
const MAX_JSON = 65536;
const ACTIONS = new Set(['config','inspect','prepare','simulate','refresh','status','broadcast','cancel-prepare','cancel-status','purchase-plan','asset-read','asset-plan','position-plan','project-plan','project-read','project-status','inventory-read','manufacture-plan','manufacture-next','synthesis-inputs','synthesis-plan','synthesis-next','mining-read','global-plan','hour-close-plan','lifecycle-plan','research-create','research-next','competition-read','round-plan','winner-plan','discovery-read']);
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireValue = (ok, message) => { if (!ok) throw new Error(message); };
const json = value => JSON.stringify(value, null, 2);
const bytesLength = value => new TextEncoder().encode(value).length;
const copy = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (object(value) || Array.isArray(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export function parsePublicJson(text, limit = MAX_JSON) {
  requireValue(typeof text === 'string' && bytesLength(text) <= limit, 'JSON 超过输入大小限制。');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('请输入完整、有效的 JSON 对象。'); }
  requireValue(object(value), '输入必须是 JSON 对象。');
  return value;
}

export function decimalString(value) {
  requireValue(typeof value === 'string' && value.length <= 20 && DECIMAL.test(value) && BigInt(value) <= 18446744073709551615n, '请输入规范的 u64 十进制字符串。');
  return value;
}

export function validateResources(resources) {
  const fields = ['computeUnitLimit','loadedAccountsDataSizeLimit','heapSize','priorityFeeLamports'];
  requireValue(object(resources) && Object.keys(resources).length === 4 && fields.every(key => Object.hasOwn(resources,key)), '资源预算必须明确包含四个规定字段。');
  requireValue(Number.isInteger(resources.computeUnitLimit) && resources.computeUnitLimit >= 1 && resources.computeUnitLimit <= 1400000, 'computeUnitLimit 超出范围。');
  requireValue(Number.isInteger(resources.loadedAccountsDataSizeLimit) && resources.loadedAccountsDataSizeLimit >= 1 && resources.loadedAccountsDataSizeLimit <= 67108864, 'loadedAccountsDataSizeLimit 超出范围。');
  requireValue(Number.isInteger(resources.heapSize) && resources.heapSize >= 32768 && resources.heapSize <= 262144 && resources.heapSize % 1024 === 0, 'heapSize 必须在 32768–262144 范围内且为 1024 的倍数。');
  decimalString(resources.priorityFeeLamports);
  return resources;
}

export function parseIntent(text) {
  const intent = parsePublicJson(text);
  const fields = ['operation','nonce','payloadHex','suffix','dynamicAccounts','feePayer','resources','labDestinationSetup'];
  requireValue(Object.keys(intent).every(key => fields.includes(key)), 'intent 含有未允许的字段。发布和网络由服务端固定。');
  requireValue(typeof intent.operation === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(intent.operation), 'intent 需要精确的 ABI operation。');
  decimalString(intent.nonce);
  requireValue(typeof intent.payloadHex === 'string' && /^(?:[0-9a-f]{2})*$/.test(intent.payloadHex) && intent.payloadHex.length <= MAX_PACKET * 2, 'payloadHex 必须是小写完整字节。');
  validateResources(intent.resources);
  for (const key of ['suffix','dynamicAccounts']) if (Object.hasOwn(intent,key)) requireValue(Array.isArray(intent[key]), `${key} 必须是数组。`);
  return intent;
}

export function unsignedTransactionBytes(envelope) {
  const hex = envelope?.unsignedHex;
  requireValue(typeof hex === 'string' && /^(?:[0-9a-f]{2})+$/.test(hex) && hex.length <= MAX_PACKET * 2, 'Envelope 未包含有效的原始未签名交易（最多 4096 字节）。');
  return Uint8Array.from(hex.match(/../g), pair => Number.parseInt(pair,16));
}

export function transactionBase64(bytes) {
  requireValue(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= MAX_PACKET, '签名交易必须是 1–4096 字节。');
  return btoa(String.fromCharCode(...bytes));
}

export function parseSignedTransaction(value) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 5464 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), '签名交易必须是严格 Base64，不包含空白。');
  const decoded = Uint8Array.from(atob(value), character => character.charCodeAt(0));
  requireValue(transactionBase64(decoded) === value, '签名交易 Base64 不是规范编码。');
  return decoded;
}

export function trustedConsoleConfig(config) {
  return object(config) && config.enabled === true && (config.authenticationRequired !== true || browserAuthMatches(config));
}

export function consoleWalletCapability(wallet, chain) {
  const feature = wallet?.features?.['solana:signTransaction'];
  const versions = feature?.supportedTransactionVersions;
  const v1 = Array.isArray(versions) && versions.some(version => version === 1);
  const network = typeof chain === 'string' && /^solana:[A-Za-z0-9]+$/.test(chain) && Array.isArray(wallet?.chains) && wallet.chains.includes(chain);
  const canConnect = typeof wallet?.features?.['standard:connect']?.connect === 'function';
  const canSign = typeof feature?.signTransaction === 'function';
  return { supported: v1 && network && canConnect && canSign,
    reason: !v1 ? '需要实际支持数字版本 1 的交易签名接口' : !network ? '钱包未声明支持配置中的网络' : !canSign ? '钱包缺少独立交易签名接口' : !canConnect ? '钱包缺少标准连接接口' : '可连接，尚未请求签名' };
}

const emptyLog = () => ({ envelope:null, inspection:null, simulation:null, signedBytes:null, decision:null, lookup:null, attempted:false });
export function createConsoleState() {
  return { config:null, actor:'', intentText:'', generation:0, activeLog:'primary', logs:{primary:emptyLog(),cancellation:emptyLog()} };
}

export function invalidateConsole(state, { actor = state.actor, intentText = state.intentText } = {}) {
  state.actor = actor; state.intentText = intentText; state.generation++;
  state.logs = { primary:emptyLog(), cancellation:emptyLog() }; state.activeLog = 'primary';
}

export function acceptEnvelope(state, log, envelope, { refresh = false } = {}) {
  requireValue(log === 'primary' || log === 'cancellation', '未知请求日志。');
  requireValue(object(envelope) && bytesLength(JSON.stringify(envelope)) <= MAX_JSON, '公开 envelope 超出大小限制。');
  unsignedTransactionBytes(envelope); decimalString(envelope.nonce);
  requireValue(envelope.actor === state.actor, 'Envelope Actor 与当前输入不一致。');
  const previous = state.logs[log].envelope;
  if (refresh) requireValue(previous && envelope.frameHex === previous.frameHex && envelope.nonce === previous.nonce && envelope.actor === previous.actor, '刷新改变了原始 Frame 或 nonce。');
  if (log === 'cancellation') {
    const primary = state.logs.primary.envelope;
    requireValue(primary && primary.actor === envelope.actor && primary.nonce === envelope.nonce && primary.frameHex !== envelope.frameHex, '取消请求必须保留原请求并使用相同 Actor 和 nonce、不同 Frame。');
  }
  state.logs[log] = { ...emptyLog(), envelope:freeze(copy(envelope)) };
  if (log === 'primary' && !refresh) state.logs.cancellation = emptyLog();
  state.generation++;
}

export function acceptInspection(slot, inspection) {
  const envelope = slot.envelope;
  requireValue(envelope && object(inspection) && inspection.actor === envelope.actor && String(inspection.nonce) === envelope.nonce && inspection.operation === envelope.operation, '服务端检查结果与当前 envelope 不一致。');
  requireValue(Array.isArray(inspection.requiredSigners) && inspection.requiredSigners.length > 0 && inspection.requiredSigners.length <= 12 && inspection.requiredSigners.every(address => typeof address === 'string'), '服务端检查结果缺少必需签名人。');
  slot.inspection = freeze(copy(inspection)); slot.simulation = null; slot.signedBytes = null;
}

export function acceptSimulation(slot, simulation) {
  slot.simulation = null; slot.signedBytes = null;
  requireValue(slot.inspection && object(simulation) && simulation.simulationOnly === true && simulation.transactionExecuted === false && simulation.signatureVerified === false && (!Object.hasOwn(simulation,'err') || simulation.err === null), '模拟未通过，不能签名或发送。');
  slot.simulation = freeze(copy(simulation));
}

export function consoleGates(state, { wallet = null, account = null, busy = false } = {}) {
  const slot = state.logs[state.activeLog], enabled = trustedConsoleConfig(state.config), ready = enabled && !busy;
  const accountReady = ready && consoleWalletCapability(wallet,state.config?.chain).supported && Array.isArray(wallet?.accounts) && wallet.accounts.includes(account)
    && account?.chains?.includes(state.config.chain) && account?.features?.includes('solana:signTransaction') && slot.inspection?.requiredSigners.includes(account.address);
  const simulated = ready && slot.inspection !== null && slot.simulation !== null && !slot.attempted;
  return { enabled, inspect:ready && slot.envelope !== null, simulate:ready && slot.inspection !== null && !slot.attempted,
    sign:Boolean(simulated && accountReady), importSigned:Boolean(simulated), broadcast:Boolean(simulated && slot.signedBytes),
    refresh:ready && slot.envelope !== null, cancelPrepare:ready && state.logs.primary.envelope !== null };
}

export function isCurrentOperation(state, generation, log, slot) {
  return state.generation === generation && state.logs[log] === slot;
}

export function describeDecision(result) {
  const decision = typeof result?.decision === 'string' ? result.decision : 'UNKNOWN';
  const verified = decision === 'CONFIRMED' && result.businessExecutionVerified === true
    || decision === 'ORIGINAL_CONFIRMED' && result.originalExecutionVerified === true
    || decision === 'CANCEL_CONFIRMED' && result.cancellationExecutionVerified === true;
  const notes = { PENDING:'已提交，等待 finalized 业务核对。', UNKNOWN:'执行结果未知；保留同一请求并查询，不能据此认定未执行。',
    RETRY_SAME_FRAME:'当前核对允许保留同一 Frame；刷新后仍需重新模拟、签名和明确发送。',
    ALREADY_PROCESSED:'序号已推进，但当前证据未证明本请求的旧执行结果。', NONCE_CONFLICT:'该序号与其他请求冲突。',
    CANCELLATION_PENDING:'原请求与取消请求的竞争尚无已验证结果。', CANCELLATION_PREPARED:'已准备独立取消请求，尚未签名或发送。' };
  return { decision, verified, text:verified ? (decision === 'CANCEL_CONFIRMED' ? '取消请求执行已验证。' : '原请求业务执行已验证。') : notes[decision] ?? '此结果未提供已验证的业务执行证据。' };
}

/** Bounded same-origin transport; includes response streaming in the timeout. */
export async function nativeRequest(action, body, { fetchImpl = globalThis.fetch, timeoutMs = 20000, maxRequestBytes = 131072, maxResponseBytes = 1572864, signal } = {}) {
  requireValue(ACTIONS.has(action), '未知控制台 API。');
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  requireValue(encoded === undefined || bytesLength(encoded) <= maxRequestBytes, '请求超过大小限制。');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort',abort,{once:true});
  const timer = setTimeout(abort,timeoutMs);
  const bounded = promise => new Promise((resolve,reject) => {
    const interrupted = () => { cleanup(); reject(new Error('请求已中止。')); };
    const cleanup = () => controller.signal.removeEventListener('abort',interrupted);
    if (controller.signal.aborted) { interrupted(); return; }
    controller.signal.addEventListener('abort',interrupted,{once:true});
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); },error => { cleanup(); reject(error); });
  });
  let reader;
  try {
    const response = await bounded(fetchImpl(`/api/native/${action}`, { method:body === undefined ? 'GET' : 'POST',
      headers:{accept:'application/json',...(encoded === undefined ? {} : {'content-type':'application/json'})},
      body:encoded, signal:controller.signal, redirect:'error', credentials:'same-origin', cache:'no-store' }));
    requireValue(!controller.signal.aborted, '请求已中止；请查询原请求的实际状态。');
    requireValue(/\bapplication\/json\b/i.test(response.headers.get('content-type') ?? ''), '服务端没有返回 JSON。');
    const length = response.headers.get('content-length');
    requireValue(length === null || /^\d+$/.test(length) && Number(length) <= maxResponseBytes, '响应超过大小限制。');
    requireValue(typeof response.body?.getReader === 'function', '无法安全读取服务端响应。');
    reader = response.body.getReader(); let size = 0; const chunks = [];
    for (;;) { const {done,value} = await bounded(reader.read()); if (done) break; size += value.byteLength;
      requireValue(size <= maxResponseBytes && !controller.signal.aborted, '响应超过大小限制或请求已中止。'); chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
    const data = parsePublicJson(new TextDecoder('utf-8',{fatal:true}).decode(bytes),maxResponseBytes);
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error.slice(0,500) : `请求未完成（HTTP ${response.status}）。`);
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('请求已超时或中止；发送结果可能未知，请查询同一 nonce。');
    throw error;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort',abort);
    if (reader) { void reader.cancel().catch(()=>{}); reader.releaseLock(); }
  }
}

export async function mountNativeConsole(document, { fetchImpl = globalThis.fetch, getWallets } = {}) {
  const $ = id => document.getElementById(id);
  if (!$('native-view')) return;
  const state = createConsoleState();
  let registry = null, wallets = [], wallet = null, account = null, authorizedAccounts = [], connectedWallet = null, busy = false, activeController = null, activeKind = null, walletUnsubscribe = null, configController = null;
  const slot = () => state.logs[state.activeLog];
  const message = (text,error = false) => { $('native-message').textContent = text; $('native-message').className = `native-message${error ? ' error' : ''}`; };
  const summary = (target, rows) => { target.replaceChildren(); for (const [label,value] of rows) {
    if (value === undefined || value === null) continue;
    const term = document.createElement('dt'), detail = document.createElement('dd'); term.textContent = label;
    detail.textContent = typeof value === 'object' ? json(value) : String(value); target.append(term,detail);
  } };
  const clearSignatures = () => { for (const current of Object.values(state.logs)) current.signedBytes = null; $('native-signed-input').value = ''; };
  const abortOperation = () => { activeController?.abort(); state.generation++; };
  const intentValid = () => { try { parseIntent($('native-intent').value); return true; } catch { return false; } };
  const actorValid = () => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(state.actor);
  const nonceValid = () => { try { decimalString($('native-status-nonce').value); return true; } catch { return false; } };

  function render() {
    const current = slot(), gates = consoleGates(state,{wallet,account,busy}), ready = gates.enabled && !busy;
    $('native-actor').disabled = !gates.enabled; $('native-intent').disabled = !gates.enabled;
    $('native-prepare').disabled = !ready || !actorValid() || !intentValid();
    $('native-import-envelope').disabled = !ready || !actorValid() || !$('native-envelope-input').value;
    $('native-wallet').disabled = !ready || wallets.length === 0; $('native-connect').disabled = !ready || !wallet || !consoleWalletCapability(wallet,state.config?.chain).supported;
    $('native-account').disabled = !ready || !authorizedAccounts.length; $('native-use-account').disabled = !ready || !account;
    for (const [id,key] of [['inspect','inspect'],['simulate','simulate'],['sign','sign'],['broadcast','broadcast'],['refresh','refresh'],['cancel-prepare','cancelPrepare'],['import-signed','importSigned']]) $('native-'+id).disabled = !gates[key];
    $('native-status').disabled = !ready || !actorValid() || !nonceValid(); $('native-cancel-status').disabled = $('native-status').disabled;
    $('native-export').disabled = !current.envelope; $('native-reload').disabled = busy;
    $('native-primary').classList.toggle('active',state.activeLog === 'primary'); $('native-cancellation').classList.toggle('active',state.activeLog === 'cancellation');
    $('native-primary').setAttribute('aria-pressed',String(state.activeLog === 'primary')); $('native-cancellation').setAttribute('aria-pressed',String(state.activeLog === 'cancellation'));
    $('native-log-note').textContent = state.activeLog === 'primary' ? '正在操作原请求 · primary 日志。' : '正在操作独立取消请求 · cancellation 日志。原请求保留在 primary。';
    $('native-envelope-json').textContent = current.envelope ? json(current.envelope) : '尚未准备';
    $('native-inspection-json').textContent = current.inspection ? json(current.inspection) : '尚未检查';
    $('native-simulation-json').textContent = current.simulation ? json(current.simulation) : '尚未通过模拟';
    $('native-status-json').textContent = current.lookup ? json(current.lookup) : current.decision ? json(current.decision) : '尚未查询';
    const inspected = current.inspection, envelope = current.envelope;
    summary($('native-inspection'),inspected ? [['操作',inspected.operation],['Actor',inspected.actor],['nonce',inspected.nonce],['费用支付人',inspected.feePayer ?? envelope.feePayer],
      ['必需签名人',inspected.requiredSigners],['资源预算',inspected.resources ?? envelope.resources],['Frame / 请求哈希',inspected.frameHash ?? inspected.requestHash],['消息 SHA-256',envelope.messageSHA256],['有效期',envelope.lifetime]] : []);
    $('native-stage').textContent = busy ? '正在等待当前明确操作…' : current.attempted ? '已进行发送尝试；请查询 finalized 结果。再次发送须明确刷新、模拟并重新签名。' : current.signedBytes ? '已收到签名数据，尚未发送。服务端将在发送前核验完整签名和原消息。' : current.simulation ? '模拟通过 · 尚未执行。可明确请求签名，再单独发送。' : current.inspection ? '精确交易检查完成 · 下一步模拟。' : envelope ? '未签名交易已准备 · 请先检查精确交易。' : '尚无公开 envelope。';
    const described = current.decision ? describeDecision(current.decision) : null;
    $('native-decision').textContent = described ? `${described.decision} · ${described.text}` : '尚无已验证结果。';
    $('native-decision').className = `native-stage${described?.verified ? ' pass' : ''}`;
  }

  async function run(action, apply, { log = state.activeLog, broadcast = false, kind = null } = {}) {
    if (busy || !trustedConsoleConfig(state.config)) return;
    busy = true; const current = state.logs[log], generation = state.generation;
    const controller = new AbortController(); activeController = controller; activeKind = kind; render();
    try {
      const result = await action(controller.signal);
      if (!isCurrentOperation(state,generation,log,current)) { message('输入已改变，旧操作结果未应用。服务端保留的原请求可按 nonce 查询。'); return; }
      apply(result,current); render();
    } catch (error) {
      if (isCurrentOperation(state,generation,log,current)) {
        current.signedBytes = null;
        if (broadcast) current.decision = {decision:'UNKNOWN',networkSubmitted:'UNKNOWN',businessExecutionVerified:false,error:error.message};
        message(error.message,true);
      }
    } finally { if (activeController === controller) { activeController = null; activeKind = null; busy = false; render(); } }
  }

  const post = (action,body,signal) => nativeRequest(action,body,{fetchImpl,signal});
  function updateDraft() {
    abortOperation(); invalidateConsole(state,{actor:$('native-actor').value.trim(),intentText:$('native-intent').value});
    clearSignatures(); $('native-status-nonce').value = '';
    try { const intent = parseIntent(state.intentText); $('native-intent-note').textContent = `明确操作 ${intent.operation} · nonce ${intent.nonce}。准备仍由服务端核对。`; }
    catch (error) { $('native-intent-note').textContent = state.intentText ? error.message : '此界面不自动推算或递增 nonce。'; }
    message('输入已改变，需要重新准备。服务端原请求记录仍保留。'); render();
  }

  function drawAccounts(accounts = wallet?.accounts ?? []) {
    $('native-account').replaceChildren(); account = null; authorizedAccounts = [];
    for (const candidate of accounts) {
      if (typeof candidate?.address !== 'string' || !candidate.chains?.includes(state.config?.chain) || !candidate.features?.includes('solana:signTransaction')) continue;
      if (!wallet?.accounts?.includes(candidate)) continue;
      const option = document.createElement('option'); option.value = String(authorizedAccounts.length); option.textContent = candidate.address; $('native-account').append(option); authorizedAccounts.push(candidate);
      if (!account) account = candidate;
    }
    if (!account) { const option = document.createElement('option'); option.textContent = '没有当前网络的已授权签名账户'; option.value = ''; $('native-account').append(option); }
    $('native-account-note').textContent = account ? `已选择 ${account.address}。Actor 仍由操作意图明确指定。` : '尚无当前网络的已授权账户。';
    clearSignatures(); render();
  }

  function chooseWallet() {
    abortOperation(); clearSignatures(); walletUnsubscribe?.(); walletUnsubscribe = null;
    wallet = $('native-wallet').value === '' ? null : wallets[Number($('native-wallet').value)] ?? null; connectedWallet = null;
    $('native-wallet-note').textContent = !state.config?.chain ? '网络钱包配置待验，连接与钱包签名保持关闭。' : wallet ? consoleWalletCapability(wallet,state.config?.chain).reason : '当前没有可用钱包。';
    // Existing accounts are not adopted until the user explicitly connects.
    drawAccounts([]);
    const change = wallet?.features?.['standard:events']?.on;
    if (typeof change === 'function') walletUnsubscribe = wallet.features['standard:events'].on('change',() => { if (connectedWallet !== wallet) return; abortOperation(); drawAccounts(); message('钱包授权或账户已改变；旧签名已清除。'); });
    render();
  }

  function drawWalletOptions(preferred=wallet) {
    $('native-wallet').replaceChildren();
    const groups=groupWalletProviders(wallets,{purpose:'transaction',preferredWallet:preferred,network:{known:typeof state.config?.chain==='string',chain:state.config?.chain}});
    for(const group of groups){const candidate=group.wallet,option=document.createElement('option');option.value=String(wallets.indexOf(candidate));const capability=consoleWalletCapability(candidate,state.config?.chain);option.textContent=`${group.name} · ${capability.supported?'v1 可用':capability.reason}`;option.disabled=!capability.supported;bindWalletOption(option,candidate);$('native-wallet').append(option);}
    return groups;
  }
  function drawWallets() {
    const previous = wallet; wallets = registry?.get?.() ?? [];
    const groups=drawWalletOptions(previous),fallback=groups.find(group=>consoleWalletCapability(group.wallet,state.config?.chain).supported)?.wallet;
    const selected = wallets.includes(previous) ? wallets.indexOf(previous) : previous ? -1 : wallets.indexOf(fallback);
    if (selected < 0) { const option = document.createElement('option'); option.value = ''; option.textContent = '未发现当前网络可用的 v1 钱包'; option.selected = true; $('native-wallet').append(option); }
    else $('native-wallet').value = String(selected);
    if (previous !== wallets[selected]) chooseWallet(); else { if (!state.config?.chain) $('native-wallet-note').textContent = '网络钱包配置待验，连接与钱包签名保持关闭。'; render(); }
  }
  document.addEventListener?.(WALLET_SELECTION_EVENT,event=>{const requested=event.detail,candidate=requested?.wallet;if(requested?.connect!==true||candidate===wallet||!wallets.includes(candidate)||!registry?.get?.().includes(candidate)||!consoleWalletCapability(candidate,state.config?.chain).supported)return;drawWalletOptions(candidate);$('native-wallet').value=String(wallets.indexOf(candidate));chooseWallet();});

  async function loadConfig() {
    if (busy) return;
    configController?.abort();const controller=new AbortController();configController=controller;
    abortOperation(); invalidateConsole(state); clearSignatures(); state.config = null; busy = true; render();
    const generation=state.generation;
    $('native-config-badge').textContent = '读取中'; $('native-config-badge').className = 'result-status';
    try {
      const config = await nativeRequest('config',undefined,{fetchImpl,signal:controller.signal});if(configController!==controller||state.generation!==generation)return;state.config = freeze(copy(config));
      const enabled = trustedConsoleConfig(config);
      $('native-config-badge').textContent = enabled ? '已启用 · 明确操作' : config.authenticationRequired === true ? '需要登录 · 操作关闭' : '本地模式 · 未启用';
      $('native-config-badge').className = `result-status${enabled ? ' pass' : ''}`;
      $('native-config-note').textContent = enabled ? '服务端固定发布、网络和持久日志。准备与模拟不会发送交易；钱包连接与签名由你单独触发。' : config.authenticationRequired === true ? '请先用当前钱包地址登录。会话失效或切换账户后，旧计划和签名会清除；登录本身不授权交易。' : '链上操作未启用。当前工作台仅提供本地模型实验；需要受信任的服务端发布配置后才能操作钱包或交易。';
      $('native-config-json').textContent = json(config);
      summary($('native-config-summary'),[['网络标识',config.chain],['Program',config.programId ?? config.program],['发布',config.releaseHash ?? config.release],['部署域',config.domainHex ?? config.domain],['公开测试身份',config.localPublicFixture === undefined ? undefined : String(config.localPublicFixture)]]);
      message(enabled ? '已读取服务端配置。准备交易前，请输入明确 Actor 和 SDK intent。' : '链上操作保持关闭；未请求钱包连接。');
    } catch (error) { if(configController===controller&&state.generation===generation){$('native-config-badge').textContent = '本地模式 · 配置不可用'; $('native-config-note').textContent = '未取得有效服务端配置，链上操作保持关闭。'; $('native-config-json').textContent = error.message; message(error.message,true);} }
    finally { if(configController===controller){configController=null;busy = false; drawWallets(); render();} }
  }

  document.addEventListener?.('biolab-auth-change',()=>{activeController?.abort();activeController=null;activeKind=null;configController?.abort();busy=false;state.config=null;invalidateConsole(state);clearSignatures();render();void loadConfig();});

  document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click',() => {
    const name = button.dataset.view;
    document.querySelectorAll('.view').forEach(view => { view.hidden = view.id !== `${name}-view`; });
    if (name === 'native') $('page-title').textContent = '链上操作';
  }));
  $('native-actor').addEventListener('input',updateDraft); $('native-intent').addEventListener('input',updateDraft);
  for (const id of ['native-envelope-input','native-status-nonce','native-signed-input']) $(id).addEventListener('input',render);
  $('native-reload').addEventListener('click',loadConfig); $('native-wallet').addEventListener('change',chooseWallet);
  $('native-account').addEventListener('change',() => { abortOperation(); clearSignatures(); account = authorizedAccounts[Number($('native-account').value)] ?? null; render(); });
  $('native-use-account').addEventListener('click',() => { if (account) { $('native-actor').value = account.address; updateDraft(); } });
  $('native-connect').addEventListener('click',() => run(async () => {
    requireValue(consoleWalletCapability(wallet,state.config.chain).supported,'所选钱包不支持当前网络的 v1 独立签名。');
    const selected = wallet; const result = await selected.features['standard:connect'].connect();
    requireValue(wallet === selected && Array.isArray(result?.accounts),'钱包没有返回授权账户。');
    return result;
  },result => { connectedWallet = wallet; drawAccounts(result.accounts); message('钱包已连接。请核对账户，并明确设置 Actor。'); }));
  $('native-prepare').addEventListener('click',() => {
    let intent; try { intent = parseIntent(state.intentText); } catch (error) { message(error.message,true); return; }
    run(signal => post('prepare',{actor:state.actor,intent},signal),result => {
      acceptEnvelope(state,'primary',result); state.activeLog = 'primary'; $('native-status-nonce').value = result.nonce;
      clearSignatures(); message('未签名交易已准备；请检查精确交易。');
    },{log:'primary'});
  });
  $('native-import-envelope').addEventListener('click',() => {
    try { const envelope = parsePublicJson($('native-envelope-input').value); acceptEnvelope(state,'primary',envelope); state.activeLog = 'primary';
      $('native-status-nonce').value = envelope.nonce; clearSignatures(); message('公开 envelope 已导入。需要服务端检查发布、Frame 和原始交易字节后才能模拟。'); render(); }
    catch (error) { message(error.message,true); }
  });
  for (const log of ['primary','cancellation']) $('native-'+log).addEventListener('click',() => { state.activeLog = log; $('native-signed-input').value = ''; render(); });
  $('native-inspect').addEventListener('click',() => {
    const current = slot(); current.inspection = null; current.simulation = null; current.signedBytes = null;
    run(signal => post('inspect',{envelope:current.envelope},signal),result => { acceptInspection(current,result); message('精确交易检查完成。请核对摘要、资源、费用支付人与全部签名人，再运行模拟。'); });
  });
  $('native-simulate').addEventListener('click',() => {
    const current = slot(); current.simulation = null; current.signedBytes = null; $('native-signed-input').value = '';
    run(signal => post('simulate',{envelope:current.envelope},signal),result => { acceptSimulation(current,result); message('模拟通过；它没有执行业务，也未验证签名。下一步需明确签名。'); });
  });
  $('native-sign').addEventListener('click',() => {
    if (!consoleGates(state,{wallet,account,busy}).sign) return;
    const current = slot(), selectedWallet = wallet, selectedAccount = account, chain = state.config.chain;
    current.signedBytes = null;
    run(async () => {
      const transaction = unsignedTransactionBytes(current.envelope);
      const result = await selectedWallet.features['solana:signTransaction'].signTransaction({account:selectedAccount,chain,transaction});
      requireValue(Array.isArray(result) && result.length === 1 && result[0]?.signedTransaction instanceof Uint8Array,'钱包没有返回唯一的签名交易字节。');
      transactionBase64(result[0].signedTransaction); return new Uint8Array(result[0].signedTransaction);
    },result => { requireValue(wallet === selectedWallet && account === selectedAccount,'签名期间钱包账户已改变。'); current.signedBytes = result;
      message('钱包已返回签名数据，尚未发送。服务端将在明确发送时核验原消息和所有必需签名。'); });
  });
  $('native-import-signed').addEventListener('click',() => {
    if (!consoleGates(state,{wallet,account,busy}).importSigned) return;
    try { slot().signedBytes = parseSignedTransaction($('native-signed-input').value); $('native-signed-input').value = '';
      message('完整签名数据已接收并暂存于内存；服务端会在明确发送前重验。'); render(); }
    catch (error) { slot().signedBytes = null; message(error.message,true); render(); }
  });
  $('native-broadcast').addEventListener('click',() => {
    if (!consoleGates(state,{wallet,account,busy}).broadcast) return;
    const current = slot(), log = state.activeLog;
    const body = {actor:state.actor,envelope:current.envelope,signedTransactionBase64:transactionBase64(current.signedBytes),log};
    current.attempted = true; current.signedBytes = null; $('native-signed-input').value = '';
    run(signal => post('broadcast',body,signal),result => { current.decision = result;
      const described = describeDecision(result); message(`${described.decision} · ${described.text}`); },{log,broadcast:true});
  });
  $('native-export').addEventListener('click',() => {
    if (!slot().envelope) return;
    const url = URL.createObjectURL(new Blob([json(slot().envelope)+'\n'],{type:'application/json'}));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `biolab-${state.activeLog}-nonce-${slot().envelope.nonce}.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url),0);
  });
  $('native-status').addEventListener('click',() => {
    let nonce; try { nonce = decimalString($('native-status-nonce').value); } catch (error) { message(error.message,true); return; }
    const log = state.activeLog;
    run(signal => post('status',{actor:state.actor,nonce,log},signal),result => { slotForResult(log,nonce,result); },{log});
  });
  function slotForResult(log,nonce,result) {
    const current = state.logs[log];
    // A manual historical lookup must not relabel a different prepared nonce.
    if (!current.envelope || current.envelope.nonce === nonce) current.decision = result;
    else { current.lookup = {nonce,result}; message(`nonce ${nonce}：${describeDecision(result).decision}。当前准备的 nonce ${current.envelope.nonce} 保持原状态。`); return; }
    current.lookup = null;
    const described = describeDecision(result); message(`${described.decision} · ${described.text}`);
  }
  $('native-refresh').addEventListener('click',() => {
    const log = state.activeLog, current = slot(), envelope = current.envelope;
    current.inspection = null; current.simulation = null; current.signedBytes = null; $('native-signed-input').value = '';
    run(signal => post('refresh',{actor:state.actor,envelope,log},signal),result => { acceptEnvelope(state,log,result,{refresh:true});
      message('有效期已刷新，同一 Frame 和 nonce 保留。旧签名已清除；请重新检查、模拟和签名。'); },{log});
  });
  $('native-cancel-prepare').addEventListener('click',() => {
    let maxRent, resources; try { maxRent = decimalString($('native-cancel-rent').value); resources = validateResources(parsePublicJson($('native-cancel-resources').value,1024)); }
    catch (error) { message(error.message,true); return; }
    const primary = state.logs.primary.envelope; if (!primary) return;
    run(signal => post('cancel-prepare',{actor:state.actor,nonce:primary.nonce,maxRent,resources},signal),result => {
      acceptEnvelope(state,'cancellation',result.envelope); state.logs.cancellation.decision = result;
      state.activeLog = 'cancellation'; clearSignatures(); $('native-status-nonce').value = primary.nonce;
      message('取消请求已另行准备。原请求保留；请对取消请求单独检查、模拟、签名和明确发送。');
    },{log:'primary',kind:'cancel-prepare'});
  });
  $('native-cancel-status').addEventListener('click',() => {
    let nonce; try { nonce = decimalString($('native-status-nonce').value); } catch (error) { message(error.message,true); return; }
    run(signal => post('cancel-status',{actor:state.actor,nonce},signal),result => {
      const matching = !state.logs.primary.envelope || state.logs.primary.envelope.nonce === nonce;
      if (matching) for (const log of ['primary','cancellation']) { state.logs[log].decision = result; state.logs[log].lookup = null; }
      else slot().lookup = {nonce,result};
      const described = describeDecision(result); message(`${described.decision} · ${described.text}`);
    });
  });
  for (const id of ['native-cancel-rent','native-cancel-resources']) $(id).addEventListener('input',() => {
    if (!state.logs.cancellation.envelope && activeKind !== 'cancel-prepare') return;
    abortOperation(); state.logs.cancellation = emptyLog(); $('native-signed-input').value = '';
    message('取消预算已改变，旧取消 envelope 与签名已清除。原请求保留；需要重新准备取消请求。'); render();
  });

  try {
    const registryFactory = getWallets ?? (await import('/vendor/wallets.js')).getWallets;
    registry = registryFactory(); registry.on('register',drawWallets); registry.on('unregister',drawWallets);
  } catch { $('native-wallet-note').textContent = 'Wallet Standard 发现接口不可用；可检查公开 envelope，钱包连接保持关闭。'; }
  await loadConfig();
  return { state, render };
}

if (typeof document !== 'undefined') void mountNativeConsole(document).catch(error => {
  const message = document.getElementById('native-message');
  if (message) { message.textContent = `控制台保持关闭：${error.message}`; message.className = 'native-message error'; }
});
