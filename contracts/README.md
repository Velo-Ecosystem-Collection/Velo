# Velo Contract Deployment

Velo's deployment script handles both Soroban contracts as one ordered release:

1. Test and build `velo_registry`.
2. Test and build `velo_pay_access`.
3. Upload and deploy the registry.
4. Upload and deploy pay access.
5. Initialize pay access with the deployed registry contract ID and dedicated mirror authority.
6. Run read-only smoke calls and write a deployment manifest.

The script always supplies the RPC URL and canonical network passphrase explicitly. It does not
depend on a mutable Stellar CLI network alias.

## Prerequisites

- Install the Stellar CLI and confirm it is available with `stellar --version`.
- Configure and fund a Stellar CLI identity for the target network. Keep secret keys out of shell
  arguments and repository files.

For example, create or import a local Testnet identity:

```bash
stellar keys add deployer
stellar keys fund deployer --network testnet
```

Use an appropriately secured production identity for Mainnet. Hardware-backed signing and a
documented deployer/key-rotation policy are strongly recommended.

## Testnet

Inspect the exact plan without sending transactions:

```bash
pnpm contracts:deploy --network testnet --mirror-authority <PUBLIC_KEY> --dry-run
```

Deploy both contracts:

```bash
pnpm contracts:deploy --network testnet --source deployer --mirror-authority <PUBLIC_KEY>
```

The command runs both Rust test suites and builds optimized, locked WASM artifacts by default. Use
`--skip-tests` only when the same commit already passed its contract tests, and `--skip-build` only
when the expected optimized artifacts already exist.

## Mainnet

Before Mainnet deployment, verify all of the following:

- Both contracts pass their local tests and a deployed Testnet end-to-end smoke flow.
- Authorization, malformed-input, overflow, storage TTL, and cross-contract-call paths are reviewed.
- The deployment has independent peer review; high-value deployments have an appropriate audit or
  documented risk acceptance.
- Admin key custody, upgrade/immutability policy, emergency response, monitoring, and rollback SOPs
  are documented.
- The commit and WASM artifacts being deployed are the reviewed versions.

Preview the Mainnet plan:

```bash
pnpm contracts:deploy --network mainnet --mirror-authority <PUBLIC_KEY> --dry-run
```

After the checklist is complete, deploy with the explicit safety acknowledgement:

```bash
pnpm contracts:deploy \
  --network mainnet \
  --source production-deployer \
  --mirror-authority <PUBLIC_KEY> \
  --confirm-mainnet
```

The Mainnet passphrase is locked to `Public Global Stellar Network ; September 2015`. The script
will not perform a live Mainnet deployment without `--confirm-mainnet`.

## Deployment Output

Successful deployments write `deployments/<network>.json` by default. The manifest records:

- network, RPC URL, and passphrase;
- UTC deployment time and Git commit;
- Stellar CLI version and deployer public key;
- registry/pay-access contract IDs and uploaded WASM hashes;
- the registry ID and mirror-authority public key used to initialize pay access.

Use `--output <path>` to select a different manifest location. The command also prints the web and
backend environment variables that must be updated after deployment.
