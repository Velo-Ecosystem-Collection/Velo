#![no_std]

mod errors;
mod events;
mod types;

pub use errors::PayAccessError;
pub use events::{
    CheckoutCreditConsumed, DisplayBalanceUpdated, MirrorAuthorityRotated, PayAccessInitialized,
    PaymentsActivated, PaymentsDeactivated,
};
pub use types::{DisplayBalance, PaymentAccessRecord, PaymentAccessStatus, RegistryProject};

use soroban_sdk::{contract, contractimpl, vec, Address, Env, IntoVal, Symbol, Val, Vec};
use types::DataKey;

const DEFAULT_CHECKOUT_CREDITS: i128 = 100;
const TTL_THRESHOLD: u32 = 17_280;
const TTL_EXTEND_TO: u32 = 518_400;

#[contract]
pub struct VeloPayAccess;

#[contractimpl]
impl VeloPayAccess {
    pub fn initialize(
        env: Env,
        registry_contract: Address,
        mirror_authority: Address,
    ) -> Result<(), PayAccessError> {
        if env.storage().instance().has(&DataKey::RegistryContract) {
            return Err(PayAccessError::AlreadyInitialized);
        }

        env.storage()
            .instance()
            .set(&DataKey::RegistryContract, &registry_contract);
        env.storage()
            .instance()
            .set(&DataKey::MirrorAuthority, &mirror_authority);
        extend_instance_ttl(&env);

        PayAccessInitialized { registry_contract }.publish(&env);

        Ok(())
    }

    pub fn get_mirror_authority(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::MirrorAuthority)
            .expect("mirror authority is not initialized")
    }

    pub fn set_display_balance(
        env: Env,
        project_id: u64,
        credits: i128,
        source_version: u64,
    ) -> Result<(), PayAccessError> {
        if credits < 0 {
            return Err(PayAccessError::InvalidCreditAmount);
        }
        require_registry_project(&env, project_id)?;
        let authority = Self::get_mirror_authority(env.clone());
        authority.require_auth();
        let key = DataKey::DisplayBalance(project_id);
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<DataKey, DisplayBalance>(&key)
        {
            if source_version < existing.source_version {
                return Err(PayAccessError::StaleMirrorVersion);
            }
            if source_version == existing.source_version {
                if credits == existing.credits {
                    env.storage()
                        .persistent()
                        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
                    extend_instance_ttl(&env);
                    return Ok(());
                }
                return Err(PayAccessError::ConflictingMirrorVersion);
            }
        }
        let display = DisplayBalance {
            credits,
            source_version,
        };
        env.storage().persistent().set(&key, &display);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        extend_instance_ttl(&env);
        DisplayBalanceUpdated {
            project_id,
            credits,
            source_version,
        }
        .publish(&env);
        Ok(())
    }

    pub fn get_display_balance(env: Env, project_id: u64) -> DisplayBalance {
        let key = DataKey::DisplayBalance(project_id);
        let display = env
            .storage()
            .persistent()
            .get::<DataKey, DisplayBalance>(&key)
            .unwrap_or(DisplayBalance {
                credits: 0,
                source_version: 0,
            });
        if display.source_version > 0 {
            env.storage()
                .persistent()
                .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
        display
    }

    pub fn rotate_mirror_authority(env: Env, new_authority: Address) -> Result<(), PayAccessError> {
        let old_authority = Self::get_mirror_authority(env.clone());
        old_authority.require_auth();
        new_authority.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::MirrorAuthority, &new_authority);
        extend_instance_ttl(&env);
        MirrorAuthorityRotated {
            old_authority,
            new_authority,
        }
        .publish(&env);
        Ok(())
    }

    pub fn activate_payments(env: Env, project_id: u64) -> Result<(), PayAccessError> {
        let project = require_active_registry_project(&env, project_id)?;
        project.owner.require_auth();

        let existing = get_access_record(&env, project_id);
        let checkout_credits = existing
            .map(|record| record.checkout_credits)
            .unwrap_or(DEFAULT_CHECKOUT_CREDITS);
        let record = PaymentAccessRecord {
            active: true,
            checkout_credits,
            activated_ledger: env.ledger().sequence(),
        };

        set_access_record(&env, project_id, &record);
        PaymentsActivated {
            project_id,
            credits: checkout_credits,
        }
        .publish(&env);

        Ok(())
    }

    pub fn deactivate_payments(env: Env, project_id: u64) -> Result<(), PayAccessError> {
        let project = require_registry_project(&env, project_id)?;
        project.owner.require_auth();

        let mut record = get_access_record(&env, project_id).unwrap_or(PaymentAccessRecord {
            active: false,
            checkout_credits: 0,
            activated_ledger: 0,
        });
        record.active = false;

        set_access_record(&env, project_id, &record);
        PaymentsDeactivated { project_id }.publish(&env);

        Ok(())
    }

    pub fn consume_checkout_credit(
        env: Env,
        project_id: u64,
        amount: i128,
    ) -> Result<(), PayAccessError> {
        if amount <= 0 {
            return Err(PayAccessError::InvalidCreditAmount);
        }

        let project = require_active_registry_project(&env, project_id)?;
        project.owner.require_auth();

        let mut record =
            get_access_record(&env, project_id).ok_or(PayAccessError::PaymentAccessInactive)?;
        if !record.active {
            return Err(PayAccessError::PaymentAccessInactive);
        }
        if record.checkout_credits < amount {
            return Err(PayAccessError::InsufficientCheckoutCredits);
        }

        record.checkout_credits -= amount;
        let remaining = record.checkout_credits;
        set_access_record(&env, project_id, &record);

        CheckoutCreditConsumed {
            project_id,
            amount,
            remaining,
        }
        .publish(&env);

        Ok(())
    }

    pub fn get_payment_access_status(env: Env, project_id: u64) -> PaymentAccessStatus {
        get_access_record(&env, project_id)
            .filter(|record| record.active)
            .map(|_| PaymentAccessStatus::Active)
            .unwrap_or(PaymentAccessStatus::Inactive)
    }

    pub fn get_checkout_credits(env: Env, project_id: u64) -> i128 {
        get_access_record(&env, project_id)
            .map(|record| record.checkout_credits)
            .unwrap_or(0)
    }
}

fn require_active_registry_project(
    env: &Env,
    project_id: u64,
) -> Result<RegistryProject, PayAccessError> {
    let project = require_registry_project(env, project_id)?;
    if !project.active {
        return Err(PayAccessError::InactiveProject);
    }

    Ok(project)
}

fn require_registry_project(env: &Env, project_id: u64) -> Result<RegistryProject, PayAccessError> {
    let registry_contract = env
        .storage()
        .instance()
        .get::<DataKey, Address>(&DataKey::RegistryContract)
        .ok_or(PayAccessError::NotInitialized)?;
    let args: Vec<Val> = vec![env, project_id.into_val(env)];

    env.invoke_contract::<Option<RegistryProject>>(
        &registry_contract,
        &Symbol::new(env, "get_project"),
        args,
    )
    .ok_or(PayAccessError::ProjectNotFound)
}

fn get_access_record(env: &Env, project_id: u64) -> Option<PaymentAccessRecord> {
    let record = env
        .storage()
        .persistent()
        .get::<DataKey, PaymentAccessRecord>(&DataKey::Access(project_id));

    if record.is_some() {
        extend_access_ttl(env, project_id);
    }

    record
}

fn set_access_record(env: &Env, project_id: u64, record: &PaymentAccessRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Access(project_id), record);
    extend_access_ttl(env, project_id);
    extend_instance_ttl(env);
}

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn extend_access_ttl(env: &Env, project_id: u64) {
    env.storage().persistent().extend_ttl(
        &DataKey::Access(project_id),
        TTL_THRESHOLD,
        TTL_EXTEND_TO,
    );
}
