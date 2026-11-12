import {
  Address,
  FeeBumpTransaction,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

export type ContractCallIntent = {
  targetContractId: string;
  functionName: string;
  args: readonly xdr.ScVal[];
  smartAccountAddress?: string;
};

function innerTransaction(transaction: Transaction | FeeBumpTransaction) {
  return transaction instanceof FeeBumpTransaction ? transaction.innerTransaction : transaction;
}

function sameScVal(left: xdr.ScVal, right: xdr.ScVal) {
  return left.toXDR().equals(right.toXDR());
}

function matchesCall(
  contractId: string,
  functionName: string,
  args: readonly xdr.ScVal[],
  intent: ContractCallIntent,
) {
  return (
    contractId === intent.targetContractId &&
    functionName === intent.functionName &&
    args.length === intent.args.length &&
    args.every((arg, index) => {
      const expected = intent.args[index];
      return expected !== undefined && sameScVal(arg, expected);
    })
  );
}

export function assertTransactionMatchesContractCall(
  envelope: xdr.TransactionEnvelope,
  networkPassphrase: string,
  intent: ContractCallIntent,
) {
  const parsed = innerTransaction(TransactionBuilder.fromXDR(envelope, networkPassphrase));
  if (parsed.operations.length !== 1) {
    throw new Error("Confirmed transaction did not contain exactly one contract invocation.");
  }
  const operation = parsed.operations[0];
  if (!operation || operation.type !== "invokeHostFunction") {
    throw new Error("Confirmed transaction was not a Soroban contract invocation.");
  }
  if (operation.func.switch().name !== "hostFunctionTypeInvokeContract") {
    throw new Error("Confirmed transaction used an unsupported Soroban host function.");
  }

  const outerCall = operation.func.invokeContract();
  const outerContract = Address.fromScAddress(outerCall.contractAddress()).toString();
  const outerFunction = outerCall.functionName().toString();
  const outerArgs = Array.from(outerCall.args());

  if (outerContract === intent.targetContractId) {
    if (
      intent.smartAccountAddress ||
      !matchesCall(outerContract, outerFunction, outerArgs, intent)
    ) {
      throw new Error("Confirmed transaction did not match the expected contract call.");
    }
    return;
  }

  if (
    !intent.smartAccountAddress ||
    outerContract !== intent.smartAccountAddress ||
    outerFunction !== "execute" ||
    outerArgs.length !== 3
  ) {
    throw new Error("Confirmed transaction did not match the expected smart-account invocation.");
  }

  const targetValue = outerArgs[0];
  const functionValue = outerArgs[1];
  const argsValue = outerArgs[2];
  if (
    !targetValue ||
    targetValue.switch().name !== "scvAddress" ||
    !functionValue ||
    functionValue.switch().name !== "scvSymbol" ||
    !argsValue ||
    argsValue.switch().name !== "scvVec"
  ) {
    throw new Error("Confirmed smart-account execute arguments were malformed.");
  }
  const scVec = argsValue.vec();
  if (!scVec) throw new Error("Confirmed smart-account target arguments were missing.");
  const targetAddress = Address.fromScAddress(targetValue.address()).toString();
  const nestedArgs = Array.from(scVec);
  if (!matchesCall(targetAddress, functionValue.sym().toString(), nestedArgs, intent)) {
    throw new Error("Confirmed smart-account transaction targeted a different contract call.");
  }
}
