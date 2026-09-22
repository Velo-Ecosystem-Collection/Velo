import {
  parseTestnetSorobanTransactionEnvelope,
  TestnetTransactionEnvelopeError,
  type TestnetSorobanTransactionFacts,
} from "@repo/stellar/transaction-envelope";

import { GAS_NETWORK, GAS_SUPPORTED_OPERATION } from "./types.ts";
import { assertValidInnerMaxTime, assertValidStroopValue } from "./validation.ts";

export type GasTransactionFacts = Readonly<{
  network: typeof GAS_NETWORK;
  operation: typeof GAS_SUPPORTED_OPERATION;
  sourceWallet: string;
  transactionHash: string;
  innerMaxFeeStroops: bigint;
  targetContractIds: readonly [string];
  innerMaxTime?: number;
}>;

function validateGasFee(facts: TestnetSorobanTransactionFacts): bigint {
  try {
    return assertValidStroopValue(facts.innerMaxFeeStroops);
  } catch {
    throw new TestnetTransactionEnvelopeError("invalid_request");
  }
}

function validateGasMaxTime(facts: TestnetSorobanTransactionFacts): number | undefined {
  if (facts.innerMaxTime === undefined) return undefined;

  try {
    return assertValidInnerMaxTime(facts.innerMaxTime);
  } catch {
    throw new TestnetTransactionEnvelopeError("invalid_request");
  }
}

/** Derives the policy facts admitted by the Gas Station Testnet boundary. */
export function deriveGasTransactionFacts(transactionXdr: string): GasTransactionFacts {
  const facts = parseTestnetSorobanTransactionEnvelope(transactionXdr);
  const innerMaxTime = validateGasMaxTime(facts);

  return Object.freeze({
    network: GAS_NETWORK,
    operation: GAS_SUPPORTED_OPERATION,
    sourceWallet: facts.sourceWallet,
    transactionHash: facts.transactionHash,
    innerMaxFeeStroops: validateGasFee(facts),
    targetContractIds: facts.targetContractIds,
    ...(innerMaxTime === undefined ? {} : { innerMaxTime }),
  });
}
