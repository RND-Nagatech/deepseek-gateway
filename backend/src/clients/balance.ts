const MICRO_IDR_PER_RUPIAH = 1_000_000n;

export const MINIMUM_BALANCE_IDR = 10;
export const MINIMUM_BALANCE_MICROS_IDR = BigInt(MINIMUM_BALANCE_IDR) * MICRO_IDR_PER_RUPIAH;

export function rupiahToMicroIdr(amountIdr: number): string {
  if (!Number.isSafeInteger(amountIdr) || amountIdr < 0) {
    throw new RangeError('Top-up amount must be a non-negative safe integer.');
  }
  return (BigInt(amountIdr) * MICRO_IDR_PER_RUPIAH).toString();
}

export function debitMicroIdr(amountMicrosIdr: string): string {
  if (!/^\d+$/.test(amountMicrosIdr)) throw new RangeError('Usage charge must be a non-negative integer.');
  return `-${amountMicrosIdr}`;
}
