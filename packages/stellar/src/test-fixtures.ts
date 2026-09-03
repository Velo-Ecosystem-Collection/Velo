import { sha256 } from "@noble/hashes/sha256";
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TimeoutInfinite,
  Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

export const GAS_TEST_CONTRACT_ID = StrKey.encodeContract(hashLabel("gas-contract"));
export const GAS_TEST_OTHER_CONTRACT_ID = StrKey.encodeContract(hashLabel("gas-other-contract"));
export const GAS_TEST_SOURCE_KEYPAIR = keypairForLabel("gas-source");
export const GAS_TEST_DESTINATION_KEYPAIR = keypairForLabel("gas-destination");
export const GAS_TEST_RELAYER_KEYPAIR = keypairForLabel("gas-relayer");

export type GasTestEnvelopeKind =
  | "valid"
  | "unsigned"
  | "wrong_network"
  | "classic"
  | "multi"
  | "mixed"
  | "fee_bump";

export type GasTestEnvelopeOptions = Readonly<{
  kind?: GasTestEnvelopeKind;
  fee?: string;
  maxTime?: number | string | null;
  operationSource?: string;
  extraSignature?: Keypair;
  signatureHint?: Uint8Array;
}>;

const MAX_DATE_SECONDS = 8_640_000_000_000n;
type StellarBuffer = Parameters<typeof StrKey.encodeContract>[0];

function hashLabel(label: string): StellarBuffer {
  return sha256(new TextEncoder().encode(`velo-public-test-label:${label}`)) as StellarBuffer;
}

export function keypairForLabel(label: string): Keypair {
  return Keypair.fromRawEd25519Seed(hashLabel(`key:${label}`));
}

export function gasTestEnvelopeTransactionHash(transactionXdr: string): string {
  return new Transaction(transactionXdr, Networks.TESTNET).hash().toString("hex");
}

function invokeContractOperation(contractId: string, source?: string): xdr.Operation {
  return Operation.invokeHostFunction({
    source,
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contractId).toScAddress(),
        functionName: "hello",
        args: [],
      }),
    ),
  });
}

function classicPaymentOperation(): xdr.Operation {
  return Operation.payment({
    destination: GAS_TEST_DESTINATION_KEYPAIR.publicKey(),
    asset: Asset.native(),
    amount: "1",
  });
}

function buildTransaction(
  operations: readonly xdr.Operation[],
  options: GasTestEnvelopeOptions,
): Transaction {
  const networkPassphrase = options.kind === "wrong_network" ? Networks.PUBLIC : Networks.TESTNET;
  const builder = new TransactionBuilder(new Account(GAS_TEST_SOURCE_KEYPAIR.publicKey(), "1"), {
    fee: options.fee ?? (operations.length > 1 ? "200" : "100"),
    networkPassphrase,
  });
  for (const operation of operations) builder.addOperation(operation);

  if (options.maxTime === null) {
    builder.setTimeout(TimeoutInfinite);
  } else {
    const maxTime = typeof options.maxTime === "string" ? Number(options.maxTime) : options.maxTime;
    builder.setTimebounds(0, maxTime ?? TimeoutInfinite);
  }

  const transaction = builder.build();
  if (options.kind !== "unsigned") transaction.sign(GAS_TEST_SOURCE_KEYPAIR);
  return transaction;
}

function withRawMaxTime(transaction: Transaction, maxTime: string): Transaction {
  const envelope = transaction.toEnvelope().v1();
  const base = envelope.tx();
  const alteredTransaction = new xdr.Transaction({
    sourceAccount: base.sourceAccount(),
    fee: base.fee(),
    seqNum: base.seqNum(),
    cond: xdr.Preconditions.precondTime(
      new xdr.TimeBounds({
        minTime: xdr.Uint64.fromString("0"),
        maxTime: xdr.Uint64.fromString(maxTime),
      }),
    ),
    memo: base.memo(),
    operations: base.operations(),
    ext: base.ext(),
  });
  const unsigned = xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({ tx: alteredTransaction, signatures: [] }),
  ).toXDR("base64");
  const signed = new Transaction(unsigned, Networks.TESTNET);
  signed.sign(GAS_TEST_SOURCE_KEYPAIR);
  return signed;
}

function addFixtureSignature(transaction: Transaction, options: GasTestEnvelopeOptions): string {
  if (!options.extraSignature && !options.signatureHint) return transaction.toXDR();

  const envelope = transaction.toEnvelope().v1();
  const signatures = envelope.signatures();
  const signature = signatures[0];
  if (!signature) throw new Error("Expected a signed fixture envelope");
  const decoratedSignature = new xdr.DecoratedSignature({
    hint: (options.signatureHint ?? signature.hint()) as StellarBuffer,
    signature: signature.signature(),
  });
  const extraSignature = options.extraSignature
    ? new xdr.DecoratedSignature({
        hint: options.extraSignature.rawPublicKey().subarray(-4),
        signature: options.extraSignature.sign(transaction.hash()),
      })
    : undefined;
  return xdr.TransactionEnvelope.envelopeTypeTx(
    new xdr.TransactionV1Envelope({
      tx: envelope.tx(),
      signatures: [decoratedSignature, ...(extraSignature ? [extraSignature] : [])],
    }),
  ).toXDR("base64");
}

/** Build deterministic in-memory envelopes without checked-in XDR or signing secrets. */
export function buildGasTestEnvelope(options: GasTestEnvelopeOptions = {}): string {
  const kind = options.kind ?? "valid";
  const invoke = invokeContractOperation(GAS_TEST_CONTRACT_ID, options.operationSource);

  if (kind === "fee_bump") {
    const inner = buildTransaction([invoke], { ...options, kind: "valid" });
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      GAS_TEST_RELAYER_KEYPAIR,
      "200",
      inner,
      Networks.TESTNET,
    );
    feeBump.sign(GAS_TEST_RELAYER_KEYPAIR);
    return feeBump.toXDR();
  }

  const operations =
    kind === "classic"
      ? [classicPaymentOperation()]
      : kind === "multi"
        ? [invoke, invokeContractOperation(GAS_TEST_OTHER_CONTRACT_ID)]
        : kind === "mixed"
          ? [invoke, classicPaymentOperation()]
          : [invoke];
  const rawMaxTime =
    typeof options.maxTime === "string" && BigInt(options.maxTime) > MAX_DATE_SECONDS;
  const transaction = buildTransaction(operations, {
    ...options,
    kind,
    maxTime:
      rawMaxTime || options.maxTime === null
        ? null
        : typeof options.maxTime === "string"
          ? Number(options.maxTime)
          : options.maxTime,
  });
  if (rawMaxTime && kind !== "unsigned") {
    return addFixtureSignature(withRawMaxTime(transaction, String(options.maxTime)), options);
  }
  return addFixtureSignature(transaction, options);
}
