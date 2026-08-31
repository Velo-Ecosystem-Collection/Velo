use soroban_sdk::contractevent;

#[contractevent(topics = ["pay", "init"])]
pub struct PayAccessInitialized {
    pub registry_contract: soroban_sdk::Address,
}

#[contractevent(topics = ["pay", "activate"])]
pub struct PaymentsActivated {
    pub project_id: u64,
    pub credits: i128,
}

#[contractevent(topics = ["pay", "deactivate"])]
pub struct PaymentsDeactivated {
    pub project_id: u64,
}

#[contractevent(topics = ["pay", "consume"])]
pub struct CheckoutCreditConsumed {
    pub project_id: u64,
    pub amount: i128,
    pub remaining: i128,
}

#[contractevent(topics = ["pay", "display"])]
pub struct DisplayBalanceUpdated {
    pub project_id: u64,
    pub credits: i128,
    pub source_version: u64,
}

#[contractevent(topics = ["pay", "mirror_auth"])]
pub struct MirrorAuthorityRotated {
    pub old_authority: soroban_sdk::Address,
    pub new_authority: soroban_sdk::Address,
}
