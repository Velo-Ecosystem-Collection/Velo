"use client";

import { Buffer } from "buffer";

import { assertValidContractId, assertValidTransactionHash } from "@repo/stellar/validation";
import { Address, Contract, contract, nativeToScVal, xdr } from "@stellar/stellar-sdk";

import { stellarConfig } from "../config/stellar";
import { getSmartAccountConfig, getSmartAccountSubmissionMethod } from "./smart-account-config";
import { assertSmartAccountFeePayerFunded, getSmartAccountKit } from "./smart-account-kit";

export function projectRegistrationArgs(
  ownerAddress: string,
  projectName: string,
  metadataHash: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(metadataHash))
    throw new Error("Project metadata hash must be 32 bytes.");
  return [
    Address.fromString(ownerAddress).toScVal(),
    xdr.ScVal.scvString(projectName.trim()),
    xdr.ScVal.scvBytes(Buffer.from(metadataHash, "hex")),
  ];
}

export function contractLinkArgs(registryProjectId: number, contractId: string) {
  if (!Number.isSafeInteger(registryProjectId) || registryProjectId <= 0) {
    throw new Error("Registry project ID must be a positive integer.");
  }
  return [
    nativeToScVal(BigInt(registryProjectId), { type: "u64" }),
    Address.fromString(assertValidContractId(contractId)).toScVal(),
  ];
}

export function paymentActivationArgs(registryProjectId: number) {
  if (!Number.isSafeInteger(registryProjectId) || registryProjectId <= 0) {
    throw new Error("Registry project ID must be a positive integer.");
  }
  return [nativeToScVal(BigInt(registryProjectId), { type: "u64" })];
}

const ALLOWED_TARGET_METHODS = new Map<string, string>([
  ["register_project", "registry"],
  ["add_contract", "registry"],
  ["remove_contract", "registry"],
  ["activate_payments", "payAccess"],
]);

export async function submitSmartAccountCall(params: {
  smartAccountAddress: string;
  targetContractId: string;
  functionName: string;
  args: readonly xdr.ScVal[];
}) {
  const expectedConfigKey = ALLOWED_TARGET_METHODS.get(params.functionName);
  if (!expectedConfigKey)
    throw new Error("This Soroban operation is not supported for passkey accounts.");
  const expectedTarget =
    expectedConfigKey === "registry"
      ? stellarConfig.registryContractId
      : stellarConfig.payAccessContractId;
  const targetContractId = assertValidContractId(params.targetContractId);
  if (!expectedTarget || targetContractId !== expectedTarget) {
    throw new Error("The selected operation does not target Velo's configured Testnet contract.");
  }
  const smartAccountAddress = assertValidContractId(params.smartAccountAddress);
  const config = getSmartAccountConfig();
  const kit = getSmartAccountKit();
  const forceMethod = await getSmartAccountSubmissionMethod();
  if (!kit.wallet || kit.contractId !== smartAccountAddress) {
    throw new Error("Reconnect the selected Velo passkey account before submitting this action.");
  }
  if (forceMethod === "rpc") await assertSmartAccountFeePayerFunded(kit);

  const operation = new Contract(smartAccountAddress).call(
    "execute",
    Address.fromString(targetContractId).toScVal(),
    xdr.ScVal.scvSymbol(params.functionName),
    xdr.ScVal.scvVec([...params.args]),
  );
  const assembled = await contract.AssembledTransaction.buildWithOp(operation, {
    publicKey: kit.deployerPublicKey,
    contractId: smartAccountAddress,
    rpcUrl: config.rpcUrl,
    networkPassphrase: config.networkPassphrase,
    allowHttp: config.rpcUrl.startsWith("http://"),
    method: "execute",
    parseResultXdr: (value) => value,
    timeoutInSeconds: 60,
  });
  const result = await kit.signAndSubmit(assembled, { forceMethod });
  if (!result.success) {
    throw new Error(
      result.error ||
        `Velo's Testnet ${forceMethod === "relayer" ? "relayer" : "RPC fee payer"} could not submit this passkey transaction.`,
    );
  }
  if (!result.hash)
    throw new Error("The smart-account submission completed without returning a transaction hash.");
  return assertValidTransactionHash(result.hash);
}
