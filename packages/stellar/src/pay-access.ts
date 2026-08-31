import {
  BASE_FEE,
  Contract,
  nativeToScVal,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import {
  assertValidContractId,
  assertValidPublicKey,
  assertValidTransactionHash,
} from "./validation.ts";

export type ActivatePaymentsTransactionInput = {
  rpcUrl: string;
  networkPassphrase: string;
  payAccessContractId: string;
  sourcePublicKey: string;
  registryProjectId: number;
};

export type ConfirmActivatePaymentsInput = {
  rpcUrl: string;
  transactionHash: string;
};

export type SetDisplayBalanceTransactionInput = ActivatePaymentsTransactionInput & {
  credits: bigint;
  sourceVersion: number;
};

export type PayAccessConfirmation =
  | {
      status: "pending";
      transactionHash: string;
    }
  | {
      status: "confirmed";
      transactionHash: string;
      ledger: number | null;
    }
  | {
      status: "error";
      transactionHash: string;
      message: string;
    };

function payAccessClient(rpcUrl: string) {
  return new rpc.Server(rpcUrl);
}

function projectIdToScVal(projectId: number) {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error("Registry project ID must be a positive integer");
  }

  return xdr.ScVal.scvU64(xdr.Uint64.fromString(projectId.toString()));
}

export async function buildActivatePaymentsTransaction(input: ActivatePaymentsTransactionInput) {
  const sourcePublicKey = assertValidPublicKey(input.sourcePublicKey);
  assertValidContractId(input.payAccessContractId);

  const server = payAccessClient(input.rpcUrl);
  const sourceAccount = await server.getAccount(sourcePublicKey);

  const contract = new Contract(input.payAccessContractId);
  const operation = contract.call("activate_payments", projectIdToScVal(input.registryProjectId));

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  const prepared = await server.prepareTransaction(transaction);
  return prepared.toXDR();
}

export async function buildSetDisplayBalanceTransaction(input: SetDisplayBalanceTransactionInput) {
  const sourcePublicKey = assertValidPublicKey(input.sourcePublicKey);
  assertValidContractId(input.payAccessContractId);
  if (input.credits < 0n) throw new Error("Display credits cannot be negative");
  if (!Number.isSafeInteger(input.sourceVersion) || input.sourceVersion < 0) {
    throw new Error("Display source version must be a non-negative safe integer");
  }
  const server = payAccessClient(input.rpcUrl);
  const sourceAccount = await server.getAccount(sourcePublicKey);
  const contract = new Contract(input.payAccessContractId);
  const operation = contract.call(
    "set_display_balance",
    projectIdToScVal(input.registryProjectId),
    nativeToScVal(input.credits, { type: "i128" }),
    nativeToScVal(BigInt(input.sourceVersion), { type: "u64" }),
  );
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();
  return (await server.prepareTransaction(transaction)).toXDR();
}

export async function confirmActivatePayments(
  input: ConfirmActivatePaymentsInput,
): Promise<PayAccessConfirmation> {
  const transactionHash = assertValidTransactionHash(input.transactionHash);
  const response = await payAccessClient(input.rpcUrl).getTransaction(transactionHash);

  if (response.status === "NOT_FOUND") {
    return { status: "pending", transactionHash };
  }

  if (response.status !== "SUCCESS") {
    return {
      status: "error",
      transactionHash,
      message: `Activate payments transaction ${response.status.toLowerCase()}`,
    };
  }

  return {
    status: "confirmed",
    transactionHash,
    ledger: response.ledger ?? null,
  };
}
