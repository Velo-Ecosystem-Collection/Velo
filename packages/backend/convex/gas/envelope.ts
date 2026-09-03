import {
  parseTestnetSorobanTransactionEnvelope,
  TestnetTransactionEnvelopeError,
  type TestnetSorobanTransactionFacts,
} from "@repo/stellar/transaction-envelope";

import { GAS_NETWORK, GAS_SUPPORTED_OPERATION } from "./types.ts";
import { assertValidStroopValue } from "./validation.ts";

export type GasTransactionFacts = Readonly<{
  network: typeof GAS_NETWORK;
  operation: typeof GAS_SUPPORTED_OPERATION;
  sourceWallet: string;
  transactionHash: string;
  innerMaxFeeStroops: bigint;
  targetContractIds: readonly [string];
}>;

function validateGasFee(facts: TestnetSorobanTransactionFacts): bigint {
  try {
    return assertValidStroopValue(facts.innerMaxFeeStroops);
  } catch {
    throw new TestnetTransactionEnvelopeError("invalid_request");
  }
}

/** Derives the policy facts admitted by the Gas Station Testnet boundary. */
export function deriveGasTransactionFacts(transactionXdr: string): GasTransactionFacts {
  const facts = parseTestnetSorobanTransactionEnvelope(transactionXdr);

  return Object.freeze({
    network: GAS_NETWORK,
    operation: GAS_SUPPORTED_OPERATION,
    sourceWallet: facts.sourceWallet,
    transactionHash: facts.transactionHash,
    innerMaxFeeStroops: validateGasFee(facts),
    targetContractIds: facts.targetContractIds,
  });
}
