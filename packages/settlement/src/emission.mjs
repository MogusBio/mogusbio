import { u64, time, mul128, min, requireThat } from './arithmetic.mjs';

export const LAB_DECIMALS = 6;
export const ATOMS_PER_LAB = 1_000_000n;
export const TOTAL_SUPPLY = 100_000_000n * ATOMS_PER_LAB;
export const HOURS_PER_EPOCH = 35_040n;
export const NONZERO_EPOCHS = 46n;
export const H_END = HOURS_PER_EPOCH * NONZERO_EPOCHS;
export const HOUR_SECONDS = 3_600n;
export const GENESIS_SEALED = 17n;
export const ALLOCATED_SUPPLY = TOTAL_SUPPLY - GENESIS_SEALED;

export function epochBudget(epoch) {
  u64(epoch, 'epoch');
  return epoch >= NONZERO_EPOCHS ? 0n : TOTAL_SUPPLY >> (epoch + 1n);
}

export function hourBudget(hour) {
  u64(hour, 'hour');
  if (hour >= H_END) return 0n;
  const epoch = hour / HOURS_PER_EPOCH;
  const t = hour % HOURS_PER_EPOCH;
  const budget = epochBudget(epoch);
  return u64(mul128(budget, t + 1n) / HOURS_PER_EPOCH
    - mul128(budget, t) / HOURS_PER_EPOCH);
}

/** Budget for the half-open prefix [0, boundary), at most 46 terms. */
export function emissionPrefix(boundary) {
  u64(boundary, 'boundary');
  const b = min(boundary, H_END);
  let sum = 0n;
  for (let epoch = 0n; epoch < NONZERO_EPOCHS; epoch += 1n) {
    const start = epoch * HOURS_PER_EPOCH;
    const elapsed = b <= start ? 0n : min(b - start, HOURS_PER_EPOCH);
    sum = u64(sum + mul128(epochBudget(epoch), elapsed) / HOURS_PER_EPOCH);
  }
  return sum;
}

export function completedHours(now, rewardStart) {
  time(now); time(rewardStart);
  return now < rewardStart ? 0n : min((now - rewardStart) / HOUR_SECONDS, H_END);
}

export function nextStakeHour(now, rewardStart) {
  time(now); time(rewardStart);
  const start = now < rewardStart ? 0n : (now - rewardStart) / HOUR_SECONDS + 1n;
  requireThat(start < H_END, 'REWARD_DOMAIN_CLOSED');
  return start;
}
