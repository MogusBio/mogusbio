import { u64, u128, mul128, requireThat, max } from './arithmetic.mjs';

export const W_FLOOR = 288_000_000_000_000_000n;
export const K_WEIGHT = 77_760_000_000_000n;
export const L_QUARTERS = Object.freeze({ COMPONENT: 4n, CELL: 6n, ORGAN: 10n, BIO: 12n });

/** B_int is milli-RU, so the reference BIO B7200 is B_int=7,200,000. */
export function normalWeight({ scope, B_int, q_ppm }) {
  requireThat(Object.hasOwn(L_QUARTERS, scope), 'INVALID_SCOPE');
  u64(B_int, 'B_int'); u64(q_ppm, 'q_ppm');
  requireThat(B_int > 0n && q_ppm >= 500_000n && q_ppm <= 2_000_000n, 'INVALID_QUALITY_OR_B');
  if (scope === 'COMPONENT') {
    requireThat(B_int === 120_000n && q_ppm === 1_000_000n, 'INVALID_COMPONENT_FACTS');
  }
  requireThat(q_ppm % 1_000n === 0n, 'QUALITY_NOT_MILLIQUANTIZED');
  const perf = 900_000n + q_ppm / 10n;
  return mul128(mul128(B_int, perf), L_QUARTERS[scope]);
}

export function denominator(totalWeight) { return max(u128(totalWeight), W_FLOOR); }

export function rewardAmount(budget, combinedWeight, hourDenominator) {
  u64(budget); u128(combinedWeight); u128(hourDenominator);
  requireThat(hourDenominator >= W_FLOOR && combinedWeight <= hourDenominator, 'INVALID_DENOMINATOR');
  return u64(mul128(budget, combinedWeight) / hourDenominator);
}
