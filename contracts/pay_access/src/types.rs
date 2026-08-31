use soroban_sdk::{contracttype, Address, BytesN, String};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RegistryProject {
    pub id: u64,
    pub owner: Address,
    pub name: String,
    pub metadata_hash: BytesN<32>,
    pub active: bool,
    pub created_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentAccessRecord {
    pub active: bool,
    pub checkout_credits: i128,
    pub activated_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisplayBalance {
    pub credits: i128,
    pub source_version: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PaymentAccessStatus {
    Active,
    Inactive,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    RegistryContract,
    MirrorAuthority,
    Access(u64),
    DisplayBalance(u64),
}
