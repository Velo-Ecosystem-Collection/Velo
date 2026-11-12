#![no_std]

mod errors;

pub use errors::WebAuthError;

use soroban_sdk::{contract, contractimpl, Address, Env, Map, String, Symbol};

#[contract]
pub struct VeloWebAuth;

#[contractimpl]
impl VeloWebAuth {
    /// Authorizes a SEP-45 challenge for the contract account and Web Auth server.
    ///
    /// The server validates the domain and nonce off-chain and supplies its own
    /// signed authorization entry. Soroban verifies both required authorizations
    /// when this function is simulated or invoked.
    pub fn web_auth_verify(env: Env, args: Map<Symbol, String>) -> Result<(), WebAuthError> {
        let account = required_address(&env, &args, "account")?;
        account.require_auth();

        let server = required_address(&env, &args, "web_auth_domain_account")?;
        server.require_auth();

        if let Some(client_domain_account) = args.get(Symbol::new(&env, "client_domain_account")) {
            Address::from_string(&client_domain_account).require_auth();
        }

        Ok(())
    }
}

fn required_address(
    env: &Env,
    args: &Map<Symbol, String>,
    name: &str,
) -> Result<Address, WebAuthError> {
    let value = args
        .get(Symbol::new(env, name))
        .ok_or(WebAuthError::MissingArgument)?;

    Ok(Address::from_string(&value))
}
