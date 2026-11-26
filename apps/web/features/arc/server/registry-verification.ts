import {
  Account,
  Contract,
  Networks,
  rpc,
  scValToNative,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

type RegisteredProject = {
  id: number;
  owner: string;
  name: string;
  metadataHash: string;
  active: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveSafeInteger(value: unknown) {
  const number = typeof value === "bigint" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : null;
}

function addressString(value: unknown) {
  if (value && typeof value === "object" && "toString" in value) {
    return String(value);
  }
  return typeof value === "string" ? value : null;
}

function bytesToHex(value: unknown) {
  if (!(value instanceof Uint8Array) || value.byteLength !== 32) return null;
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyLiveTestnetProject(input: {
  rpcUrl: string;
  registryContractId: string;
  registryProjectId: number;
  ownerAddress: string;
  name: string;
  metadataHash: string;
}) {
  const server = new rpc.Server(input.rpcUrl);
  const projectId = xdr.ScVal.scvU64(xdr.Uint64.fromString(String(input.registryProjectId)));
  const transaction = new TransactionBuilder(new Account(input.ownerAddress, "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(new Contract(input.registryContractId).call("get_project", projectId))
    .setTimeout(30)
    .build();

  const response = await server.simulateTransaction(transaction);
  if ("error" in response || !response.result) return false;

  const value = scValToNative(response.result.retval) as unknown;
  const record = asRecord(value);
  if (!record) return false;

  const id = positiveSafeInteger(record.id);
  const owner = addressString(record.owner);
  const name = typeof record.name === "string" ? record.name : null;
  const metadataHash = bytesToHex(record.metadata_hash);

  return (
    id === input.registryProjectId &&
    owner === input.ownerAddress &&
    name === input.name &&
    metadataHash === input.metadataHash.toLowerCase() &&
    record.active === true
  );
}
