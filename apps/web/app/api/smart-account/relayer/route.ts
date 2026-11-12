import { reserveSmartAccountFeeBudget } from "@/core/auth/contract-wallet-auth-challenges";
import { env } from "@/core/config/env";
import { stellarConfig } from "@/core/config/stellar";
import { withRouteTelemetry } from "@/core/observability";
import {
  SMART_ACCOUNT_WASM_HASH,
  WEBAUTHN_VERIFIER_CONTRACT_ID,
} from "@/core/stellar/smart-account-config";
import { assertValidContractId } from "@repo/stellar/validation";
import {
  Address,
  BASE_FEE,
  FeeBumpTransaction,
  hash,
  Keypair,
  Operation,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BODY_BYTES = 64 * 1024;
const KIT_DEPLOYER = Keypair.fromRawEd25519Seed(
  // This is the deterministic deployer used by smart-account-kit 0.2.10.
  // Only allow the single constrained deploy operation below through the fee proxy.
  hash(Buffer.from("openzeppelin-smart-account-kit")),
);
const ALLOWED_EXECUTIONS = new Map([
  ["register_project", "registry"],
  ["add_contract", "registry"],
  ["remove_contract", "registry"],
  ["activate_payments", "payAccess"],
]);

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Smart-account relayer request failed.";
}

function isCanonicalBase64(value: string) {
  return (
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) &&
    Buffer.from(value, "base64").toString("base64") === value
  );
}

function readSettings() {
  const endpointValue = process.env.VELO_SMART_ACCOUNT_RELAYER_URL?.trim();
  const authorization = process.env.VELO_SMART_ACCOUNT_RELAYER_AUTHORIZATION?.trim();
  if (!endpointValue || !authorization) {
    throw new Error(
      "Configure VELO_SMART_ACCOUNT_RELAYER_URL and VELO_SMART_ACCOUNT_RELAYER_AUTHORIZATION.",
    );
  }
  const endpoint = new URL(endpointValue);
  if (
    endpoint.username ||
    endpoint.password ||
    (endpoint.protocol !== "https:" &&
      !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname)))
  ) {
    throw new Error("Smart-account relayer URL must use HTTPS, except for local development.");
  }
  const maxFeeValue = process.env.VELO_SMART_ACCOUNT_RELAYER_MAX_FEE_STROOPS ?? "30000000";
  if (!/^[1-9][0-9]{0,9}$/.test(maxFeeValue)) {
    throw new Error("VELO_SMART_ACCOUNT_RELAYER_MAX_FEE_STROOPS must be a positive integer.");
  }
  const maxFeeStroops = BigInt(maxFeeValue);
  if (maxFeeStroops > 100_000_000n) {
    throw new Error("The per-transaction relayer fee ceiling cannot exceed 100,000,000 stroops.");
  }
  const dailyLimitValue =
    process.env.VELO_SMART_ACCOUNT_RELAYER_DAILY_MAX_FEE_STROOPS ?? "300000000";
  if (!/^[1-9][0-9]{0,9}$/.test(dailyLimitValue)) {
    throw new Error("VELO_SMART_ACCOUNT_RELAYER_DAILY_MAX_FEE_STROOPS must be a positive integer.");
  }
  const dailyLimitStroops = BigInt(dailyLimitValue);
  if (dailyLimitStroops > 1_000_000_000n) {
    throw new Error("The daily relayer fee budget cannot exceed 1,000,000,000 stroops.");
  }
  return { endpoint, authorization, maxFeeStroops, dailyLimitStroops };
}

function expectedWasmHash() {
  const value = (process.env.NEXT_PUBLIC_SMART_ACCOUNT_WASM_HASH ?? SMART_ACCOUNT_WASM_HASH)
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value))
    throw new Error("The configured smart-account WASM hash is invalid.");
  return Buffer.from(value, "hex");
}

function expectedVerifierAddress() {
  return assertValidContractId(
    process.env.NEXT_PUBLIC_WEBAUTHN_VERIFIER_CONTRACT_ID ?? WEBAUTHN_VERIFIER_CONTRACT_ID,
  );
}

function includesString(value: unknown, expected: string): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => includesString(item, expected));
  if (value instanceof Map) {
    return [...value.entries()].some(
      ([key, item]) => includesString(key, expected) || includesString(item, expected),
    );
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => includesString(item, expected));
  }
  return false;
}

function getDeploymentHostFunction(transactionXdr: string, maxFeeStroops: bigint) {
  if (!isCanonicalBase64(transactionXdr))
    throw new Error("Deployment transaction XDR is malformed.");
  const parsed = TransactionBuilder.fromXDR(transactionXdr, stellarConfig.networkPassphrase);
  if (parsed instanceof FeeBumpTransaction)
    throw new Error("Fee-bump deployment envelopes are not supported.");
  if (parsed.source !== KIT_DEPLOYER.publicKey() || parsed.operations.length !== 1) {
    throw new Error("Deployment must use the configured smart-account deployer and one operation.");
  }
  if (BigInt(parsed.fee) > maxFeeStroops)
    throw new Error("Deployment fee exceeds the configured relayer limit.");
  if (parsed.signatures.length !== 1)
    throw new Error("Deployment must have exactly one deployer signature.");
  const signature = parsed.signatures[0]?.signature();
  if (!signature || !KIT_DEPLOYER.verify(parsed.hash(), signature)) {
    throw new Error("Deployment signature is invalid for the configured smart-account deployer.");
  }
  const operation = parsed.operations[0];
  if (
    !operation ||
    operation.type !== "invokeHostFunction" ||
    operation.func.switch().name !== "hostFunctionTypeCreateContractV2"
  ) {
    throw new Error("The relayer only sponsors smart-account WASM deployments.");
  }
  const deploy = operation.func.createContractV2();
  const preimage = deploy.contractIdPreimage();
  if (preimage.switch().name !== "contractIdPreimageFromAddress") {
    throw new Error("Smart-account deployment must derive from the configured deployer address.");
  }
  const deployerAddress = Address.fromScAddress(preimage.fromAddress().address()).toString();
  if (deployerAddress !== KIT_DEPLOYER.publicKey()) {
    throw new Error("Smart-account deployment used an unexpected contract deployer.");
  }
  const executable = deploy.executable();
  if (
    executable.switch().name !== "contractExecutableWasm" ||
    !Buffer.from(executable.wasmHash()).equals(expectedWasmHash())
  ) {
    throw new Error("The relayer only sponsors the configured Testnet smart-account WASM.");
  }
  const constructorArgs = Array.from(deploy.constructorArgs());
  const signers = constructorArgs[0];
  const signerList = signers?.switch().name === "scvVec" ? signers.vec() : null;
  if (constructorArgs.length !== 2 || !signerList || signerList.length !== 1) {
    throw new Error(
      "Smart-account deployment must install one signer for Velo's configured WebAuthn verifier.",
    );
  }
  if (!includesString(scValToNative(signerList[0]!), expectedVerifierAddress())) {
    throw new Error("Smart-account deployment must use Velo's configured WebAuthn verifier.");
  }
  return operation.func;
}

function addressArgument(value: xdr.ScVal | undefined) {
  if (!value || value.switch().name !== "scvAddress")
    throw new Error("Operation contains an invalid address.");
  return Address.fromScAddress(value.address()).toString();
}

function u64Argument(value: xdr.ScVal | undefined) {
  if (!value || value.switch().name !== "scvU64")
    throw new Error("Operation contains an invalid project ID.");
  const amount = BigInt(value.u64().toString());
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Project ID is outside supported bounds.");
}

function validateSmartAccountExecution(
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[],
) {
  if (func.switch().name !== "hostFunctionTypeInvokeContract") {
    throw new Error("The relayer only sponsors smart-account contract executions.");
  }
  const invoke = func.invokeContract();
  const smartAccount = Address.fromScAddress(invoke.contractAddress()).toString();
  if (!smartAccount.startsWith("C") || invoke.functionName().toString() !== "execute") {
    throw new Error("The relayer only sponsors a smart account's execute invocation.");
  }
  const args = Array.from(invoke.args());
  if (
    args.length !== 3 ||
    args[1]?.switch().name !== "scvSymbol" ||
    args[2]?.switch().name !== "scvVec"
  ) {
    throw new Error("The smart-account execute arguments are malformed.");
  }
  const executeArgs = args[2]!.vec();
  if (!executeArgs) throw new Error("The smart-account execute argument vector is malformed.");
  const target = addressArgument(args[0]);
  const method = args[1]!.sym().toString();
  const argumentList = Array.from(executeArgs);
  const contractType = ALLOWED_EXECUTIONS.get(method);
  const expectedTarget =
    contractType === "registry"
      ? stellarConfig.registryContractId
      : contractType === "payAccess"
        ? stellarConfig.payAccessContractId
        : undefined;
  if (!expectedTarget || target !== expectedTarget) {
    throw new Error("The requested target and method are not enabled for passkey transactions.");
  }

  if (method === "register_project") {
    if (argumentList.length !== 3 || addressArgument(argumentList[0]) !== smartAccount) {
      throw new Error("Passkey project registration must set the smart account as project owner.");
    }
    if (
      argumentList[1]?.switch().name !== "scvString" ||
      !argumentList[1].str().toString().trim()
    ) {
      throw new Error("Project name is invalid.");
    }
    if (argumentList[2]?.switch().name !== "scvBytes" || argumentList[2].bytes().length !== 32) {
      throw new Error("Project metadata hash must be 32 bytes.");
    }
  } else if (method === "add_contract" || method === "remove_contract") {
    if (argumentList.length !== 2)
      throw new Error("Registry contract-link arguments are malformed.");
    u64Argument(argumentList[0]);
    assertValidContractId(addressArgument(argumentList[1]));
  } else if (method === "activate_payments") {
    if (argumentList.length !== 1) throw new Error("Payment activation arguments are malformed.");
    u64Argument(argumentList[0]);
  }

  if (auth.length !== 1)
    throw new Error("Smart-account execution must carry one authorization entry.");
  const entry = auth[0]!;
  if (entry.credentials().switch().name !== "sorobanCredentialsAddress") {
    throw new Error("Smart-account authorization must use address credentials.");
  }
  const credentials = entry.credentials().address();
  if (Address.fromScAddress(credentials.address()).toString() !== smartAccount) {
    throw new Error("Smart-account authorization belongs to a different account.");
  }
  const signature = credentials.signature();
  const signatureValues = signature.switch().name === "scvVec" ? signature.vec() : null;
  if (!signatureValues || signatureValues.length === 0) {
    throw new Error("Smart-account authorization is unsigned.");
  }
  return { smartAccount, auth, func };
}

async function assertFeeWithinLimit(
  func: xdr.HostFunction,
  auth: xdr.SorobanAuthorizationEntry[],
  maxFeeStroops: bigint,
) {
  const server = new rpc.Server(stellarConfig.rpcUrl, { timeout: 30_000 });
  const source = await server.getAccount(KIT_DEPLOYER.publicKey());
  const transaction = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: stellarConfig.networkPassphrase,
  })
    .addOperation(Operation.invokeHostFunction({ func, auth }))
    .setTimeout(60)
    .build();
  const simulation = await server.simulateTransaction(transaction);
  if (rpc.Api.isSimulationError(simulation) || !simulation.result) {
    throw new Error(
      "Stellar RPC could not verify this passkey operation. No relayer request was sent.",
    );
  }
  const estimatedFee = BigInt(simulation.minResourceFee) + BigInt(BASE_FEE);
  if (estimatedFee > maxFeeStroops) {
    throw new Error("Estimated Soroban fees exceed the configured relayer limit.");
  }
  return estimatedFee;
}

async function parseRequest(body: unknown, maxFeeStroops: bigint) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Request body must be an object.");
  const value = body as Record<string, unknown>;
  if (typeof value.xdr === "string" && Object.keys(value).length === 1) {
    const func = getDeploymentHostFunction(value.xdr, maxFeeStroops);
    const tx = TransactionBuilder.fromXDR(value.xdr, stellarConfig.networkPassphrase);
    let estimatedFee = 0n;
    if (!(tx instanceof FeeBumpTransaction) && tx.operations[0]?.type === "invokeHostFunction") {
      estimatedFee = await assertFeeWithinLimit(func, [], maxFeeStroops);
    }
    const transactionFee = !(tx instanceof FeeBumpTransaction) ? BigInt(tx.fee) : 0n;
    const feeStroops = transactionFee > estimatedFee ? transactionFee : estimatedFee;
    return { request: { xdr: value.xdr }, feeStroops: Number(feeStroops) };
  }

  if (
    typeof value.func !== "string" ||
    !Array.isArray(value.auth) ||
    Object.keys(value).some((key) => key !== "func" && key !== "auth") ||
    value.auth.length !== 1 ||
    value.func.length > 32_768
  ) {
    throw new Error("Expected one allowed smart-account operation and its authorization entry.");
  }
  const funcValue = value.func;
  if (!isCanonicalBase64(funcValue)) throw new Error("Soroban host-function XDR is malformed.");
  const func = xdr.HostFunction.fromXDR(funcValue, "base64");
  const auth = value.auth.map((entry) => {
    if (typeof entry !== "string" || entry.length > 32_768 || !isCanonicalBase64(entry)) {
      throw new Error("Authorization entry XDR is malformed.");
    }
    return xdr.SorobanAuthorizationEntry.fromXDR(entry, "base64");
  });
  validateSmartAccountExecution(func, auth);
  const feeStroops = await assertFeeWithinLimit(func, auth, maxFeeStroops);
  return { request: { func: funcValue, auth: value.auth }, feeStroops: Number(feeStroops) };
}

export const POST = withRouteTelemetry("smart_account.relayer", async (request) => {
  const allowedOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").origin;
  if (request.headers.get("origin") !== allowedOrigin)
    return json({ error: "Request origin is not allowed." }, 403);

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return json({ error: "Relayer request is too large." }, 413);

  let settings: ReturnType<typeof readSettings>;
  try {
    if (!env.NEXT_PUBLIC_ENABLE_PASSKEYS) throw new Error("Velo passkey accounts are disabled.");
    if (stellarConfig.network !== "testnet")
      throw new Error("Passkey relaying is configured for Testnet only.");
    settings = readSettings();
  } catch (error) {
    return json({ error: errorMessage(error) }, 503);
  }

  let body: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES)
      return json({ error: "Relayer request is too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Relayer request must contain valid JSON." }, 400);
  }

  let parsedRequest: {
    request: { func: string; auth: unknown[] } | { xdr: string };
    feeStroops: number;
  };
  try {
    parsedRequest = await parseRequest(body, settings.maxFeeStroops);
  } catch (error) {
    const message = errorMessage(error);
    const status = /rpc|network|stellar/i.test(message) ? 503 : 400;
    return json({ error: message }, status);
  }

  try {
    const reserved = await reserveSmartAccountFeeBudget({
      feeStroops: parsedRequest.feeStroops,
      dailyLimitStroops: Number(settings.dailyLimitStroops),
    });
    if (!reserved) {
      return json(
        { error: "Velo's daily Testnet smart-account relayer fee budget is exhausted." },
        429,
      );
    }
  } catch {
    return json({ error: "Velo could not reserve the Testnet relayer fee budget." }, 503);
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 110_000);
    let response: Response;
    try {
      response = await fetch(settings.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: settings.authorization },
        body: JSON.stringify(parsedRequest.request),
        signal: controller.signal,
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }
    const result = await response.json().catch(() => ({ error: "Relayer returned invalid JSON." }));
    return json(result, response.ok ? 200 : Math.min(response.status, 599));
  } catch (error) {
    console.error("[smart-account.relayer] Upstream submission failed", {
      reason: errorMessage(error),
    });
    return json({ error: "The configured Testnet relayer could not be reached." }, 502);
  }
});
