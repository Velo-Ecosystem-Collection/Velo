use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PayAccessError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ProjectNotFound = 3,
    InactiveProject = 4,
    InvalidCreditAmount = 5,
    PaymentAccessInactive = 6,
    InsufficientCheckoutCredits = 7,
    StaleMirrorVersion = 8,
    ConflictingMirrorVersion = 9,
}
