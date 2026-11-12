# Velo SEP-45 Web Auth Contract

This Soroban contract implements the `web_auth_verify` entrypoint required by
SEP-45. It requires authorization from the contract account being authenticated
and the Velo server account published as `SIGNING_KEY`. It also supports the
optional SEP-45 `client_domain_account` authorization. Velo's current login
flow does not request client-domain authorization.

The contract is intentionally stateless. Velo validates `home_domain`,
`web_auth_domain`, and the single-use nonce in its authentication service. The
contract binds the full argument map to the authorization entries and requires
the account and server signatures. Do not treat a successful contract call as a
Velo session by itself; Velo's server must still validate and consume its
challenge before issuing a JWT.

## Build and deploy to Testnet

Prerequisites: Rust's Soroban WASM target, Stellar CLI, and a funded Testnet
deployer identity. Keep the deployer secret out of the repository.

Run the contract authorization tests and build its optimized WASM:

```bash
cd contracts/web_auth
cargo test --locked
stellar contract build
stellar contract deploy \
  --wasm target/wasm32v1-none/release/velo_web_auth.wasm \
  --source-account <TESTNET_DEPLOYER> \
  --network testnet
```

The deploy command prints a `C...` contract ID. Set it as
`NEXT_PUBLIC_VELO_WEB_AUTH_CONTRACT_ID` in the web deployment environment. Velo's
`/.well-known/stellar.toml` route publishes that ID along with its SEP-45
endpoint and the public key derived from `VELO_AUTH_SERVER_SECRET` (or the
configured auth key fallback).

The contract ID is public configuration. The deployer secret, Velo auth
signing key, and relayer credentials remain server-side. This crate is
Testnet-targeted and is not included in `pnpm contracts:deploy`, which deploys
the Registry and PayAccess contracts.

## Current Testnet deployment

- Contract ID: `CBPX3F3JSPEWPB3K53U23SNAVFMTUZB75ITIC3UCKK7YPFLI6YJXS4SV`
- WASM hash: `cb3549520e9029464d166c7621edf0e07fb41af240a5f7530b00159e92d44ecc`
- Deployed: 2026-11-12
- Deployment transaction: [4f20645b9b7f42035304d16f10594293ba253e347eb235426974fbf410110809](https://stellar.expert/explorer/testnet/tx/4f20645b9b7f42035304d16f10594293ba253e347eb235426974fbf410110809)
- WASM upload transaction: [6c7e648524d18c0ec7a881e1f6715faa1064daab5926f67689df34028b1ae8a7](https://stellar.expert/explorer/testnet/tx/6c7e648524d18c0ec7a881e1f6715faa1064daab5926f67689df34028b1ae8a7)
