import {
  Address,
  BASE_FEE,
  Contract,
  rpc,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import type { Buffer as StellarBuffer } from "node:buffer";

import {
  assertTransactionMatchesContractCall,
  type ContractCallIntent,
} from "./contract-invocation.ts";
import {
  assertValidContractId,
  assertValidAccountAddress,
  assertValidMetadataHash,
  assertValidPublicKey,
  assertValidTransactionHash,
} from "./validation.ts";

export type StellarTestnetConfig = {
  networkPassphrase: string;
  rpcUrl: string;
  registryContractId: string;
};

export type RegisterProjectTransactionInput = StellarTestnetConfig & {
  sourcePublicKey: string;
  ownerAddress: string;
  projectName: string;
  metadataHash: string;
};

export type SubmitSignedTransactionInput = {
  rpcUrl: string;
  networkPassphrase: string;
  signedXdr: string;
};

export type ConfirmRegistrationInput = StellarTestnetConfig & {
  transactionHash: string;
  expectedIntent?: ContractCallIntent;
};

export type ContractLinkTransactionInput = StellarTestnetConfig & {
  sourcePublicKey: string;
  registryProjectId: number;
  officialContractId: string;
};

export type ConfirmContractTransactionInput = {
  rpcUrl: string;
  transactionHash: string;
  networkPassphrase?: string;
  expectedIntent?: ContractCallIntent;
};

export type RegistrationConfirmation =
  | {
      status: "pending";
      transactionHash: string;
    }
  | {
      status: "registered";
      transactionHash: string;
      registryProjectId: number | null;
      createdLedger: number | null;
    }
  | {
      status: "error";
      transactionHash: string;
      message: string;
    };

export type ContractTransactionConfirmation =
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

const TRANSACTION_VALIDITY_SECONDS = 15 * 60;
const MISSING_TRANSACTION_HASH = "0".repeat(64);

export function registrationTimebounds(latestLedgerCloseTime: number | string) {
  const normalizedCloseTime =
    typeof latestLedgerCloseTime === "number"
      ? latestLedgerCloseTime
      : /^[1-9]\d*$/.test(latestLedgerCloseTime)
        ? Number(latestLedgerCloseTime)
        : Number.NaN;

  if (
    !Number.isSafeInteger(normalizedCloseTime) ||
    normalizedCloseTime <= 0 ||
    normalizedCloseTime > Number.MAX_SAFE_INTEGER - TRANSACTION_VALIDITY_SECONDS
  ) {
    throw new Error("Stellar RPC returned an invalid latest ledger close time");
  }

  return {
    minTime: 0,
    maxTime: normalizedCloseTime + TRANSACTION_VALIDITY_SECONDS,
  };
}

export function transactionSubmissionErrorMessage(errorResult?: xdr.TransactionResult) {
  if (!errorResult) {
    return "Transaction submission failed";
  }

  const resultCode = errorResult.result().switch().name;
  if (resultCode === "txTooLate") {
    return "This transaction expired before it reached Stellar. Please try the action again.";
  }

  return `Stellar rejected the transaction (${resultCode}). XDR: ${errorResult.toXDR("base64")}`;
}

function metadataHashToBytes(metadataHash: string) {
  return xdr.ScVal.scvBytes(Buffer.from(assertValidMetadataHash(metadataHash), "hex"));
}

function registryClient(rpcUrl: string) {
  return new rpc.Server(rpcUrl);
}

async function latestLedgerTimebounds(server: rpc.Server) {
  // A well-formed hash that cannot match a submitted transaction gives us the
  // RPC node's latest ledger close time without relying on the browser clock.
  const response = await server.getTransaction(MISSING_TRANSACTION_HASH);
  return registrationTimebounds(response.latestLedgerCloseTime);
}

function contractCallOperation(input: RegisterProjectTransactionInput) {
  const contract = new Contract(assertValidContractId(input.registryContractId));
  const owner = Address.fromString(assertValidAccountAddress(input.ownerAddress));

  return contract.call(
    "register_project",
    owner.toScVal(),
    xdr.ScVal.scvString(input.projectName.trim()),
    metadataHashToBytes(input.metadataHash),
  );
}

function projectIdToScVal(projectId: number) {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    throw new Error("Registry project ID must be a positive integer");
  }

  return xdr.ScVal.scvU64(xdr.Uint64.fromString(projectId.toString()));
}

function officialContractAddressToScVal(contractId: string) {
  return Address.fromString(assertValidContractId(contractId)).toScVal();
}

function contractLinkOperation(input: ContractLinkTransactionInput, method: string) {
  const contract = new Contract(assertValidContractId(input.registryContractId));

  return contract.call(
    method,
    projectIdToScVal(input.registryProjectId),
    officialContractAddressToScVal(input.officialContractId),
  );
}

export async function buildRegisterProjectTransaction(input: RegisterProjectTransactionInput) {
  const sourcePublicKey = assertValidPublicKey(input.sourcePublicKey);
  assertValidContractId(input.registryContractId);
  assertValidAccountAddress(input.ownerAddress);
  assertValidMetadataHash(input.metadataHash);

  if (!input.projectName.trim()) {
    throw new Error("Project name is required");
  }

  const server = registryClient(input.rpcUrl);
  const [sourceAccount, timebounds] = await Promise.all([
    server.getAccount(sourcePublicKey),
    latestLedgerTimebounds(server),
  ]);
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(contractCallOperation(input))
    .setTimebounds(timebounds.minTime, timebounds.maxTime)
    .build();

  const prepared = await server.prepareTransaction(transaction);
  return prepared.toXDR();
}

async function buildContractLinkTransaction(input: ContractLinkTransactionInput, method: string) {
  const sourcePublicKey = assertValidPublicKey(input.sourcePublicKey);
  assertValidContractId(input.registryContractId);
  assertValidContractId(input.officialContractId);

  const server = registryClient(input.rpcUrl);
  const [sourceAccount, timebounds] = await Promise.all([
    server.getAccount(sourcePublicKey),
    latestLedgerTimebounds(server),
  ]);
  const transaction = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: input.networkPassphrase,
  })
    .addOperation(contractLinkOperation(input, method))
    .setTimebounds(timebounds.minTime, timebounds.maxTime)
    .build();

  const prepared = await server.prepareTransaction(transaction);
  return prepared.toXDR();
}

export function buildAddOfficialContractTransaction(input: ContractLinkTransactionInput) {
  return buildContractLinkTransaction(input, "add_contract");
}

export function buildRemoveOfficialContractTransaction(input: ContractLinkTransactionInput) {
  return buildContractLinkTransaction(input, "remove_contract");
}

export async function submitSignedTransaction(input: SubmitSignedTransactionInput) {
  const transaction = new Transaction(input.signedXdr, input.networkPassphrase);
  const response = await registryClient(input.rpcUrl).sendTransaction(transaction);

  if (response.status === "ERROR") {
    throw new Error(transactionSubmissionErrorMessage(response.errorResult));
  }

  return assertValidTransactionHash(response.hash);
}

export async function confirmContractTransaction(
  input: ConfirmContractTransactionInput,
): Promise<ContractTransactionConfirmation> {
  const transactionHash = assertValidTransactionHash(input.transactionHash);
  const response = await registryClient(input.rpcUrl).getTransaction(transactionHash);

  if (response.status === "NOT_FOUND") {
    return { status: "pending", transactionHash };
  }

  if (response.status !== "SUCCESS") {
    return {
      status: "error",
      transactionHash,
      message: `Contract transaction ${response.status.toLowerCase()}`,
    };
  }

  if (input.expectedIntent) {
    if (!input.networkPassphrase) {
      throw new Error("A network passphrase is required to verify the confirmed contract call.");
    }
    assertTransactionMatchesContractCall(
      response.envelopeXdr,
      input.networkPassphrase,
      input.expectedIntent,
    );
  }

  return {
    status: "confirmed",
    transactionHash,
    ledger: response.ledger ?? null,
  };
}

function projectIdFromReturnValue(returnValue: xdr.ScVal | undefined | null) {
  if (!returnValue) {
    return null;
  }

  const nativeValue = scValToNative(returnValue) as unknown;
  if (typeof nativeValue === "number") {
    return nativeValue;
  }

  if (typeof nativeValue === "bigint") {
    return Number(nativeValue);
  }

  return null;
}

function projectIdFromRegistrationEvent(
  events: xdr.ContractEvent[][] | undefined,
  registryContractId: string,
) {
  for (const event of events?.flat() ?? []) {
    const contractId = event.contractId();
    if (
      !contractId ||
      Address.contract(contractId as unknown as StellarBuffer).toString() !== registryContractId
    )
      continue;
    if (event.type().name !== "contract") continue;
    const body = event.body().v0();
    const topics = Array.from(body.topics());
    if (
      topics[0]?.switch().name !== "scvSymbol" ||
      topics[0].sym().toString() !== "project" ||
      topics[1]?.switch().name !== "scvSymbol" ||
      topics[1].sym().toString() !== "reg"
    )
      continue;
    const data = body.data();
    if (data.switch().name !== "scvVec") continue;
    const id = data.vec()?.[0];
    if (!id || id.switch().name !== "scvU64") continue;
    const native = scValToNative(id) as unknown;
    if (typeof native === "bigint" && native <= BigInt(Number.MAX_SAFE_INTEGER))
      return Number(native);
    if (typeof native === "number" && Number.isSafeInteger(native)) return native;
  }
  return null;
}

export async function confirmRegistration(
  input: ConfirmRegistrationInput,
): Promise<RegistrationConfirmation> {
  const transactionHash = assertValidTransactionHash(input.transactionHash);
  const response = await registryClient(input.rpcUrl).getTransaction(transactionHash);

  if (response.status === "NOT_FOUND") {
    return { status: "pending", transactionHash };
  }

  if (response.status !== "SUCCESS") {
    return {
      status: "error",
      transactionHash,
      message: `Registration transaction ${response.status.toLowerCase()}`,
    };
  }

  if (input.expectedIntent) {
    assertTransactionMatchesContractCall(
      response.envelopeXdr,
      input.networkPassphrase,
      input.expectedIntent,
    );
  }

  return {
    status: "registered",
    transactionHash,
    registryProjectId:
      projectIdFromReturnValue(response.returnValue) ??
      projectIdFromRegistrationEvent(response.events?.contractEventsXdr, input.registryContractId),
    createdLedger: response.ledger ?? null,
  };
}
