use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal, Map, String, Symbol,
};
use velo_web_auth::{VeloWebAuth, VeloWebAuthClient, WebAuthError};

fn add_address_arg(env: &Env, args: &mut Map<Symbol, String>, name: &str, address: &Address) {
    args.set(Symbol::new(env, name), address.to_string());
}

fn challenge_args(
    env: &Env,
    account: &Address,
    server: &Address,
    client_domain: Option<&Address>,
) -> Map<Symbol, String> {
    let mut args = Map::new(env);
    add_address_arg(env, &mut args, "account", account);
    args.set(
        Symbol::new(env, "home_domain"),
        String::from_str(env, "velo.example"),
    );
    args.set(
        Symbol::new(env, "nonce"),
        String::from_str(env, "single-use"),
    );
    args.set(
        Symbol::new(env, "web_auth_domain"),
        String::from_str(env, "velo.example"),
    );
    add_address_arg(env, &mut args, "web_auth_domain_account", server);

    if let Some(client_domain) = client_domain {
        add_address_arg(env, &mut args, "client_domain_account", client_domain);
    }

    args
}

#[test]
fn requires_account_and_server_authorization() {
    let env = Env::default();
    let contract_id = env.register(VeloWebAuth, ());
    let client = VeloWebAuthClient::new(&env, &contract_id);
    let account = Address::generate(&env);
    let server = Address::generate(&env);
    let args = challenge_args(&env, &account, &server, None);
    let invoke = MockAuthInvoke {
        contract: &contract_id,
        fn_name: "web_auth_verify",
        args: (&args,).into_val(&env),
        sub_invokes: &[],
    };

    client
        .mock_auths(&[
            MockAuth {
                address: &account,
                invoke: &invoke,
            },
            MockAuth {
                address: &server,
                invoke: &invoke,
            },
        ])
        .web_auth_verify(&args);
}

#[test]
fn rejects_missing_account_authorization() {
    let env = Env::default();
    let contract_id = env.register(VeloWebAuth, ());
    let client = VeloWebAuthClient::new(&env, &contract_id);
    let account = Address::generate(&env);
    let server = Address::generate(&env);
    let attacker = Address::generate(&env);
    let args = challenge_args(&env, &account, &server, None);
    let invoke = MockAuthInvoke {
        contract: &contract_id,
        fn_name: "web_auth_verify",
        args: (&args,).into_val(&env),
        sub_invokes: &[],
    };

    let result = client
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &invoke,
        }])
        .try_web_auth_verify(&args);

    assert!(result.is_err());
}

#[test]
fn rejects_missing_server_authorization() {
    let env = Env::default();
    let contract_id = env.register(VeloWebAuth, ());
    let client = VeloWebAuthClient::new(&env, &contract_id);
    let account = Address::generate(&env);
    let server = Address::generate(&env);
    let attacker = Address::generate(&env);
    let args = challenge_args(&env, &account, &server, None);
    let invoke = MockAuthInvoke {
        contract: &contract_id,
        fn_name: "web_auth_verify",
        args: (&args,).into_val(&env),
        sub_invokes: &[],
    };

    let result = client
        .mock_auths(&[
            MockAuth {
                address: &account,
                invoke: &invoke,
            },
            MockAuth {
                address: &attacker,
                invoke: &invoke,
            },
        ])
        .try_web_auth_verify(&args);

    assert!(result.is_err());
}

#[test]
fn requires_client_domain_authorization_when_supplied() {
    let env = Env::default();
    let contract_id = env.register(VeloWebAuth, ());
    let client = VeloWebAuthClient::new(&env, &contract_id);
    let account = Address::generate(&env);
    let server = Address::generate(&env);
    let client_domain = Address::generate(&env);
    let args = challenge_args(&env, &account, &server, Some(&client_domain));
    let invoke = MockAuthInvoke {
        contract: &contract_id,
        fn_name: "web_auth_verify",
        args: (&args,).into_val(&env),
        sub_invokes: &[],
    };

    client
        .mock_auths(&[
            MockAuth {
                address: &account,
                invoke: &invoke,
            },
            MockAuth {
                address: &server,
                invoke: &invoke,
            },
            MockAuth {
                address: &client_domain,
                invoke: &invoke,
            },
        ])
        .web_auth_verify(&args);
}

#[test]
fn reports_missing_required_arguments() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(VeloWebAuth, ());
    let client = VeloWebAuthClient::new(&env, &contract_id);
    let account = Address::generate(&env);
    let server = Address::generate(&env);
    let mut args = Map::new(&env);

    add_address_arg(&env, &mut args, "account", &account);
    let missing_server = client.try_web_auth_verify(&args).unwrap_err().unwrap();
    assert_eq!(missing_server, WebAuthError::MissingArgument);

    args = Map::new(&env);
    add_address_arg(&env, &mut args, "web_auth_domain_account", &server);
    let missing_account = client.try_web_auth_verify(&args).unwrap_err().unwrap();
    assert_eq!(missing_account, WebAuthError::MissingArgument);
}
