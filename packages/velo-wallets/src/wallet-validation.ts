const STELLAR_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STELLAR_ACCOUNT_VERSION = 6 << 3;

export function isValidStellarAccountId(value: unknown): value is string {
  if (typeof value !== "string" || !/^G[A-Z2-7]{55}$/.test(value)) return false;

  const decoded = new Uint8Array(35);
  let accumulator = 0;
  let bitCount = 0;
  let byteIndex = 0;

  for (const character of value) {
    const digit = STELLAR_BASE32.indexOf(character);
    if (digit < 0) return false;

    accumulator = ((accumulator << 5) | digit) & 0xffff;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      decoded[byteIndex] = (accumulator >> bitCount) & 0xff;
      byteIndex += 1;
      accumulator &= (1 << bitCount) - 1;
    }
  }

  if (byteIndex !== decoded.length || bitCount !== 0 || decoded[0] !== STELLAR_ACCOUNT_VERSION) {
    return false;
  }

  let checksum = 0;
  for (const byte of decoded.subarray(0, 33)) {
    checksum ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum & 0x8000) === 0 ? checksum << 1 : (checksum << 1) ^ 0x1021;
      checksum &= 0xffff;
    }
  }

  const checksumLow = decoded[33];
  const checksumHigh = decoded[34];
  if (checksumLow === undefined || checksumHigh === undefined) return false;
  const encodedChecksum = checksumLow | (checksumHigh << 8);
  return checksum === encodedChecksum;
}

export function isWalletSigningPayload(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 1_048_576;
}
