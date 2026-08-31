use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, BytesN, Env, IntoVal, String,
};
use velo_pay_access::{PayAccessError, PaymentAccessStatus, VeloPayAccess, VeloPayAccessClient};
use velo_registry::{VeloRegistry, VeloRegistryClient};

fn setup(
    mock_all_auths: bool,
) -> (
    Env,
    VeloPayAccessClient<'static>,
    VeloRegistryClient<'static>,
    Address,
    Address,
    Address,
    BytesN<32>,
) {
    let env = Env::default();
    if mock_all_auths {
        env.mock_all_auths();
    }

    let registry_contract_id = env.register(VeloRegistry, ());
    let pay_access_contract_id = env.register(VeloPayAccess, ());
    let registry_client = VeloRegistryClient::new(&env, &registry_contract_id);
    let pay_access_client = VeloPayAccessClient::new(&env, &pay_access_contract_id);
    let owner = Address::generate(&env);
    let mirror_authority = Address::generate(&env);
    let metadata_hash = BytesN::from_array(&env, &[7; 32]);

    pay_access_client.initialize(&registry_contract_id, &mirror_authority);

    (
        env,
        pay_access_client,
        registry_client,
        pay_access_contract_id,
        registry_contract_id,
        owner,
        metadata_hash,
    )
}

fn register_demo_project(
    env: &Env,
    registry_client: &VeloRegistryClient,
    owner: &Address,
    metadata_hash: &BytesN<32>,
) -> u64 {
    registry_client.register_project(owner, &String::from_str(env, "DemoPay"), metadata_hash)
}

#[test]
fn valid_project_activation_consumption_and_status_queries_work() {
    let (env, pay_client, registry_client, _pay_id, _registry_id, owner, metadata_hash) =
        setup(true);
    let project_id = register_demo_project(&env, &registry_client, &owner, &metadata_hash);

    pay_client.activate_payments(&project_id);

    assert_eq!(
        pay_client.get_payment_access_status(&project_id),
        PaymentAccessStatus::Active
    );
    assert_eq!(pay_client.get_checkout_credits(&project_id), 100);

    pay_client.consume_checkout_credit(&project_id, &20);

    assert_eq!(pay_client.get_checkout_credits(&project_id), 80);

    pay_client.deactivate_payments(&project_id);

    assert_eq!(
        pay_client.get_payment_access_status(&project_id),
        PaymentAccessStatus::Inactive
    );
    assert_eq!(pay_client.get_checkout_credits(&project_id), 80);
}

#[test]
fn missing_project_activation_is_rejected() {
    let (_env, pay_client, _registry_client, _pay_id, _registry_id, _owner, _metadata_hash) =
        setup(true);

    let err = pay_client.try_activate_payments(&404).unwrap_err().unwrap();

    assert_eq!(err, PayAccessError::ProjectNotFound);
}

#[test]
fn inactive_project_activation_is_rejected() {
    let (env, pay_client, registry_client, _pay_id, _registry_id, owner, metadata_hash) =
        setup(true);
    let project_id = register_demo_project(&env, &registry_client, &owner, &metadata_hash);

    registry_client.deactivate_project(&project_id);
    let err = pay_client
        .try_activate_payments(&project_id)
        .unwrap_err()
        .unwrap();

    assert_eq!(err, PayAccessError::InactiveProject);
}

#[test]
fn non_owner_activation_is_rejected() {
    let env = Env::default();
    let registry_contract_id = env.register(VeloRegistry, ());
    let pay_access_contract_id = env.register(VeloPayAccess, ());
    let registry_client = VeloRegistryClient::new(&env, &registry_contract_id);
    let pay_client = VeloPayAccessClient::new(&env, &pay_access_contract_id);
    let owner = Address::generate(&env);
    let non_owner = Address::generate(&env);
    let metadata_hash = BytesN::from_array(&env, &[7; 32]);
    let name = String::from_str(&env, "DemoPay");

    let mirror_authority = Address::generate(&env);
    pay_client.initialize(&registry_contract_id, &mirror_authority);
    let project_id = registry_client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &registry_contract_id,
                fn_name: "register_project",
                args: (&owner, &name, &metadata_hash).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .register_project(&owner, &name, &metadata_hash);

    let result = pay_client
        .mock_auths(&[MockAuth {
            address: &non_owner,
            invoke: &MockAuthInvoke {
                contract: &pay_access_contract_id,
                fn_name: "activate_payments",
                args: (&project_id,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_activate_payments(&project_id);

    assert!(result.is_err());
    assert_eq!(
        pay_client.get_payment_access_status(&project_id),
        PaymentAccessStatus::Inactive
    );
}

#[test]
fn display_balance_is_separate_versioned_and_mirror_authority_controlled() {
    let (env, pay_client, registry_client, pay_id, _registry_id, owner, metadata_hash) =
        setup(true);
    let project_id = register_demo_project(&env, &registry_client, &owner, &metadata_hash);
    let mirror_authority = pay_client.get_mirror_authority();

    pay_client.set_display_balance(&project_id, &75, &1);
    let display = pay_client.get_display_balance(&project_id);
    assert_eq!(display.credits, 75);
    assert_eq!(display.source_version, 1);
    assert_eq!(pay_client.get_checkout_credits(&project_id), 0);

    pay_client.set_display_balance(&project_id, &75, &1);
    assert_eq!(
        pay_client
            .try_set_display_balance(&project_id, &74, &1)
            .unwrap_err()
            .unwrap(),
        PayAccessError::ConflictingMirrorVersion
    );
    assert_eq!(
        pay_client
            .try_set_display_balance(&project_id, &74, &0)
            .unwrap_err()
            .unwrap(),
        PayAccessError::StaleMirrorVersion
    );

    let outsider = Address::generate(&env);
    let result = pay_client
        .mock_auths(&[MockAuth {
            address: &outsider,
            invoke: &MockAuthInvoke {
                contract: &pay_id,
                fn_name: "set_display_balance",
                args: (&project_id, &50_i128, &2_u64).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_set_display_balance(&project_id, &50, &2);
    assert!(result.is_err());
    assert_ne!(outsider, mirror_authority);
}

#[test]
fn mirror_authority_rotation_changes_the_authoritative_signer() {
    let (env, pay_client, registry_client, _pay_id, _registry_id, owner, metadata_hash) =
        setup(true);
    let project_id = register_demo_project(&env, &registry_client, &owner, &metadata_hash);
    let previous_authority = pay_client.get_mirror_authority();
    let next_authority = Address::generate(&env);

    pay_client.rotate_mirror_authority(&next_authority);
    pay_client.set_display_balance(&project_id, &42, &1);

    assert_ne!(previous_authority, next_authority);
    assert_eq!(pay_client.get_mirror_authority(), next_authority);
    assert_eq!(pay_client.get_display_balance(&project_id).credits, 42);
}

#[test]
fn credit_consumption_rejects_invalid_amounts_and_overdrafts() {
    let (env, pay_client, registry_client, _pay_id, _registry_id, owner, metadata_hash) =
        setup(true);
    let project_id = register_demo_project(&env, &registry_client, &owner, &metadata_hash);

    pay_client.activate_payments(&project_id);

    let invalid_amount = pay_client
        .try_consume_checkout_credit(&project_id, &0)
        .unwrap_err()
        .unwrap();
    let overdraft = pay_client
        .try_consume_checkout_credit(&project_id, &101)
        .unwrap_err()
        .unwrap();

    assert_eq!(invalid_amount, PayAccessError::InvalidCreditAmount);
    assert_eq!(overdraft, PayAccessError::InsufficientCheckoutCredits);
    assert_eq!(pay_client.get_checkout_credits(&project_id), 100);
}
