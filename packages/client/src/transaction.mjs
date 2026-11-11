import {
  address, blockhash, createTransactionMessage, setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash, setTransactionMessageConfig,
  appendTransactionMessageInstructions, compileTransaction, getTransactionEncoder,
  getTransactionDecoder, getCompiledTransactionMessageDecoder, getCompiledTransactionMessageEncoder, getTransactionSize,
} from '@solana/kit';

const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const bounded = (n, low, high, name) => {
  if (!Number.isSafeInteger(n) || n < low || n > high) throw new RangeError(name);
  return n;
};

/** Shared pure resource gate. Defaults match the original message builder. */
export function validateV1Resources(resources) {
  const computeUnitLimit = bounded(resources?.computeUnitLimit, 1, 1_400_000, 'computeUnitLimit');
  const loadedAccountsDataSizeLimit = bounded(resources?.loadedAccountsDataSizeLimit, 1, 67_108_864, 'loadedAccountsDataSizeLimit');
  const heapSize = bounded(resources?.heapSize ?? 32_768, 32_768, 262_144, 'heapSize');
  if (heapSize % 1024) throw new RangeError('heapSize must use1024-byte pages');
  const priorityFeeLamports = resources?.priorityFeeLamports ?? 0n;
  if (typeof priorityFeeLamports !== 'bigint' || priorityFeeLamports < 0n || priorityFeeLamports > 18_446_744_073_709_551_615n)
    throw new RangeError('priorityFeeLamports');
  return {computeUnitLimit,loadedAccountsDataSizeLimit,heapSize,priorityFeeLamports};
}

/** Build only: this never requests a wallet, signs, broadcasts, or spends. */
export function buildV1Transaction({ feePayer, lifetime, instructions, resources, supportedTransactionVersions }) {
  if (!supportedTransactionVersions?.includes(1)) throw new Error('TRANSACTION_V1_UNSUPPORTED');
  if (!Array.isArray(instructions) || instructions.length < 1 || instructions.length > 64)
    throw new RangeError('instruction count');
  const {computeUnitLimit,loadedAccountsDataSizeLimit,heapSize,priorityFeeLamports}=validateV1Resources(resources);
  const keys = new Set([feePayer]);
  for (const ix of instructions) {
    address(ix.programAddress);
    if (ix.programAddress === COMPUTE_BUDGET) throw new Error('V1_USE_MESSAGE_RESOURCE_CONFIG');
    keys.add(ix.programAddress);
    for (const account of ix.accounts ?? []) { address(account.address); keys.add(account.address); }
  }
  if (keys.size > 64) throw new RangeError('deployment supports at most64 inline accounts');
  if (typeof lifetime?.lastValidBlockHeight !== 'bigint' || lifetime.lastValidBlockHeight < 0n)
    throw new RangeError('lastValidBlockHeight');
  let message = createTransactionMessage({ version: 1 });
  message = setTransactionMessageFeePayer(address(feePayer), message);
  message = setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash(lifetime.blockhash),
    lastValidBlockHeight: lifetime.lastValidBlockHeight }, message);
  message = setTransactionMessageConfig({ computeUnitLimit, loadedAccountsDataSizeLimit, heapSize, priorityFeeLamports }, message);
  message = appendTransactionMessageInstructions(instructions, message);
  const transaction = compileTransaction(message);
  if (Object.keys(transaction.signatures).length > 12) throw new RangeError('v1 supports at most12 signatures');
  if (getTransactionSize(transaction) > 4096) throw new RangeError('v1 transaction exceeds4096 bytes');
  return Object.freeze({ message, transaction });
}

/** Strict external-wire gate around the official decoder; signatures stay untrusted. */
export function decodeV1Transaction(input) {
  const bytes = Buffer.from(input);
  if (bytes.length < 8 || bytes.length > 4096 || bytes[0] !== 0x81) throw new Error('V1_WIRE_PREFIX_OR_SIZE');
  const mask = bytes.readUInt32LE(4);
  if ((mask & ~31) !== 0 || ![0, 3].includes(mask & 3)) throw new Error('V1_UNKNOWN_CONFIG_MASK');
  const transaction = getTransactionDecoder().decode(bytes);
  const canonical = Buffer.from(getTransactionEncoder().encode(transaction));
  if (!canonical.equals(bytes)) throw new Error('V1_WIRE_NONCANONICAL');
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (message.version !== 1 || message.staticAccounts.length > 64) throw new Error('V1_MESSAGE_VERSION_OR_KEYS');
  if (!Buffer.from(getCompiledTransactionMessageEncoder().encode(message)).equals(Buffer.from(transaction.messageBytes)))
    throw new Error('V1_MESSAGE_NONCANONICAL');
  return { transaction, message };
}

/** Packet bytes include signature slots even before a wallet fills them. */
export const transactionBytes = transaction => Buffer.from(getTransactionEncoder().encode(transaction));
