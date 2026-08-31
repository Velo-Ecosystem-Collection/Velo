import { defineTable } from "convex/server";
import { v } from "convex/values";

export const billingBookValidator = v.union(v.literal("shadow"), v.literal("commercial"));
export const creditClassValidator = v.union(v.literal("promotional"), v.literal("paid"));
export const billingNetworkValidator = v.union(v.literal("testnet"), v.literal("public"));
export const billingEnvironmentValidator = v.union(
  v.literal("development"),
  v.literal("preview"),
  v.literal("production"),
);
export const launchApprovalAreaValidator = v.union(
  v.literal("product"),
  v.literal("finance"),
  v.literal("legal"),
  v.literal("tax"),
  v.literal("compliance"),
  v.literal("security"),
  v.literal("operations"),
);
export const exceptionSeverityValidator = v.union(
  v.literal("critical"),
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);

export const billingPolicies = defineTable({
  key: v.literal("global"),
  version: v.number(),
  billingLedgerWrite: v.boolean(),
  billingShadowMode: v.boolean(),
  mainnetCreditEnforcement: v.boolean(),
  billingTopupsEnabled: v.boolean(),
  promoGrantEnabled: v.boolean(),
  pdaxBillingEnabled: v.boolean(),
  billingKillSwitch: v.boolean(),
  promoCredits: v.int64(),
  promoValidityMs: v.number(),
  reservationTtlMs: v.number(),
  promoFirst: v.boolean(),
  updatedBy: v.string(),
  updatedAt: v.number(),
}).index("by_key", ["key"]);

export const organizationBillingSettings = defineTable({
  organizationId: v.id("organizations"),
  enforcementEnabled: v.boolean(),
  shadowEnabled: v.boolean(),
  sandboxEnforcementEnabled: v.optional(v.boolean()),
  cohortStage: v.optional(
    v.union(v.literal("internal"), v.literal("design_partner"), v.literal("paid_cohort")),
  ),
  activationState: v.optional(
    v.union(
      v.literal("not_enrolled"),
      v.literal("grace"),
      v.literal("enabled"),
      v.literal("paused"),
    ),
  ),
  graceUntil: v.optional(v.number()),
  migrationNoticeSentAt: v.optional(v.number()),
  lowBalanceNoticeSentAt: v.optional(v.number()),
  enforcementEnabledAt: v.optional(v.number()),
  payAccessMirrorEnabled: v.optional(v.boolean()),
  updatedBy: v.string(),
  updatedAt: v.number(),
}).index("by_organization_id", ["organizationId"]);

export const billingOffers = defineTable({
  sku: v.string(),
  version: v.number(),
  creditQuantity: v.int64(),
  priceAmount: v.string(),
  asset: v.string(),
  network: billingNetworkValidator,
  treasuryAddress: v.string(),
  treasuryId: v.optional(v.id("billingTreasuries")),
  refundPolicy: v.string(),
  active: v.boolean(),
  activeFrom: v.number(),
  activeUntil: v.optional(v.number()),
  createdBy: v.string(),
  createdAt: v.number(),
})
  .index("by_sku_and_version", ["sku", "version"])
  .index("by_active_and_active_from", ["active", "activeFrom"])
  .index("by_network_and_active_and_active_from", ["network", "active", "activeFrom"]);

export const billingLaunchApprovals = defineTable({
  area: launchApprovalAreaValidator,
  status: v.union(v.literal("approved"), v.literal("rejected"), v.literal("revoked")),
  approver: v.string(),
  evidenceReference: v.string(),
  notes: v.string(),
  policyDigest: v.string(),
  recordedAt: v.number(),
})
  .index("by_area_and_recorded_at", ["area", "recordedAt"])
  .index("by_recorded_at", ["recordedAt"]);

export const billingTreasuries = defineTable({
  network: v.literal("public"),
  address: v.string(),
  asset: v.string(),
  verificationEvidenceReference: v.string(),
  signerPolicyReference: v.string(),
  withdrawalPolicyReference: v.string(),
  monitoringOwner: v.string(),
  reconciliationOwner: v.string(),
  incidentProcedureReference: v.string(),
  active: v.boolean(),
  createdBy: v.string(),
  createdAt: v.number(),
}).index("by_network_and_active", ["network", "active"]);

export const billingOperationalEvents = defineTable({
  eventType: v.union(
    v.literal("launch_armed"),
    v.literal("launch_activated"),
    v.literal("launch_rollback"),
    v.literal("kill_switch_changed"),
    v.literal("cohort_changed"),
    v.literal("mirror_submitted"),
    v.literal("mirror_verified"),
  ),
  actor: v.string(),
  organizationId: v.optional(v.id("organizations")),
  evidenceJson: v.string(),
  occurredAt: v.number(),
}).index("by_occurred_at", ["occurredAt"]);

export const billingOperatorWallets = defineTable({
  walletAddress: v.string(),
  active: v.boolean(),
  createdBy: v.string(),
  createdAt: v.number(),
  updatedBy: v.string(),
  updatedAt: v.number(),
}).index("by_wallet_address", ["walletAddress"]);

export const billingTopups = defineTable({
  organizationId: v.id("organizations"),
  projectId: v.id("projects"),
  paymentIntentId: v.optional(v.id("paymentIntents")),
  offerId: v.id("billingOffers"),
  sku: v.string(),
  offerVersion: v.number(),
  creditQuantity: v.int64(),
  priceAmount: v.string(),
  asset: v.string(),
  network: billingNetworkValidator,
  treasuryAddress: v.string(),
  refundPolicy: v.string(),
  status: v.union(
    v.literal("created"),
    v.literal("pending"),
    v.literal("settled"),
    v.literal("failed"),
    v.literal("cancelled"),
    v.literal("expired"),
    v.literal("exception"),
  ),
  payerAddress: v.optional(v.string()),
  transactionHash: v.optional(v.string()),
  treasuryReceiptId: v.optional(v.id("treasuryReceipts")),
  createdAt: v.number(),
  updatedAt: v.number(),
  settledAt: v.optional(v.number()),
})
  .index("by_organization_id_and_created_at", ["organizationId", "createdAt"])
  .index("by_payment_intent_id", ["paymentIntentId"])
  .index("by_transaction_hash", ["transactionHash"])
  .index("by_status_and_updated_at", ["status", "updatedAt"]);

export const treasuryReceipts = defineTable({
  organizationId: v.id("organizations"),
  topupId: v.id("billingTopups"),
  paymentIntentId: v.id("paymentIntents"),
  offerId: v.id("billingOffers"),
  transactionHash: v.string(),
  sourceAddress: v.string(),
  destinationAddress: v.string(),
  amount: v.string(),
  asset: v.string(),
  network: billingNetworkValidator,
  sku: v.string(),
  offerVersion: v.number(),
  creditQuantity: v.int64(),
  priceAmount: v.string(),
  refundPolicy: v.string(),
  verifiedAt: v.number(),
})
  .index("by_organization_id_and_verified_at", ["organizationId", "verifiedAt"])
  .index("by_topup_id", ["topupId"])
  .index("by_payment_intent_id", ["paymentIntentId"])
  .index("by_transaction_hash", ["transactionHash"]);

export const billingExceptions = defineTable({
  organizationId: v.optional(v.id("organizations")),
  exceptionType: v.union(
    v.literal("topup_mismatch"),
    v.literal("reused_transaction"),
    v.literal("reservation_mismatch"),
    v.literal("ledger_mismatch"),
    v.literal("receipt_mismatch"),
    v.literal("verification_ambiguous"),
  ),
  status: v.union(v.literal("open"), v.literal("resolved")),
  severity: v.optional(exceptionSeverityValidator),
  assignee: v.optional(v.string()),
  slaDueAt: v.optional(v.number()),
  investigationStatus: v.optional(
    v.union(v.literal("unassigned"), v.literal("investigating"), v.literal("resolved")),
  ),
  dedupeKey: v.string(),
  summary: v.string(),
  evidenceJson: v.string(),
  paymentIntentId: v.optional(v.id("paymentIntents")),
  reservationId: v.optional(v.id("creditReservations")),
  topupId: v.optional(v.id("billingTopups")),
  treasuryReceiptId: v.optional(v.id("treasuryReceipts")),
  resolutionAction: v.optional(
    v.union(
      v.literal("acknowledge"),
      v.literal("retry_verification"),
      v.literal("compensating_adjustment"),
    ),
  ),
  resolutionNote: v.optional(v.string()),
  resolutionLedgerEntryId: v.optional(v.id("billingLedgerEntries")),
  resolvedBy: v.optional(v.string()),
  resolvedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_dedupe_key", ["dedupeKey"])
  .index("by_status_and_created_at", ["status", "createdAt"])
  .index("by_organization_id_and_created_at", ["organizationId", "createdAt"]);

export const billingExceptionEvidence = defineTable({
  exceptionId: v.id("billingExceptions"),
  evidenceType: v.string(),
  reference: v.string(),
  digest: v.optional(v.string()),
  addedBy: v.string(),
  addedAt: v.number(),
}).index("by_exception_id_and_added_at", ["exceptionId", "addedAt"]);

export const billingExceptionHistory = defineTable({
  exceptionId: v.id("billingExceptions"),
  action: v.union(
    v.literal("created"),
    v.literal("assigned"),
    v.literal("evidence_added"),
    v.literal("resolved"),
    v.literal("reopened"),
  ),
  actor: v.string(),
  note: v.string(),
  occurredAt: v.number(),
}).index("by_exception_id_and_occurred_at", ["exceptionId", "occurredAt"]);

export const billingCostPeriods = defineTable({
  periodStart: v.number(),
  periodEnd: v.number(),
  revision: v.number(),
  infrastructureCostUsd: v.string(),
  fullyLoadedCostUsd: v.string(),
  evidenceReference: v.string(),
  status: v.union(v.literal("draft"), v.literal("approved")),
  createdBy: v.string(),
  createdAt: v.number(),
  approvedBy: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  approvalNote: v.optional(v.string()),
})
  .index("by_period_start_and_revision", ["periodStart", "revision"])
  .index("by_status_and_period_start", ["status", "periodStart"]);

export const billingRefunds = defineTable({
  organizationId: v.id("organizations"),
  topupId: v.id("billingTopups"),
  treasuryReceiptId: v.id("treasuryReceipts"),
  amountUsd: v.string(),
  accountingTreatment: v.union(
    v.literal("deferred_reduction"),
    v.literal("revenue_reversal"),
    v.literal("expense"),
  ),
  reason: v.string(),
  evidenceReference: v.string(),
  recordedBy: v.string(),
  recordedAt: v.number(),
})
  .index("by_topup_id", ["topupId"])
  .index("by_recorded_at", ["recordedAt"]);

export const billingPdaxEconomics = defineTable({
  organizationId: v.id("organizations"),
  paymentIntentId: v.id("paymentIntents"),
  settlementTransactionId: v.id("settlementTransactions"),
  quotedCost: v.string(),
  actualCost: v.string(),
  passThroughAmount: v.string(),
  spread: v.string(),
  failureCost: v.string(),
  subsidy: v.string(),
  currency: v.string(),
  idempotencyKey: v.string(),
  recordedAt: v.number(),
})
  .index("by_idempotency_key", ["idempotencyKey"])
  .index("by_recorded_at", ["recordedAt"]);

export const billingFinanceReports = defineTable({
  costPeriodId: v.id("billingCostPeriods"),
  periodStart: v.number(),
  periodEnd: v.number(),
  cashCollectedUsd: v.string(),
  unusedPaidCreditValueUsd: v.string(),
  recognizedRevenueUsd: v.string(),
  promotionalCreditsConsumed: v.int64(),
  creditAdjustments: v.int64(),
  refundsAndAdjustmentsUsd: v.string(),
  pdaxPassThroughRevenueUsd: v.string(),
  pdaxActualCostUsd: v.string(),
  netRevenueUsd: v.string(),
  infrastructureCostUsd: v.string(),
  fullyLoadedCostUsd: v.string(),
  infrastructureCostPerSuccessUsd: v.optional(v.string()),
  fullyLoadedCostPerSuccessUsd: v.optional(v.string()),
  infrastructureContributionUsd: v.string(),
  fullyLoadedContributionUsd: v.string(),
  infrastructureMarginBps: v.optional(v.number()),
  fullyLoadedMarginBps: v.optional(v.number()),
  successfulPayments: v.number(),
  usdcTransactionValueUsd: v.string(),
  nonUsdcSuccessesExcluded: v.number(),
  effectiveVeloFeeBps: v.optional(v.number()),
  generatedBy: v.string(),
  generatedAt: v.number(),
}).index("by_period_start_and_generated_at", ["periodStart", "generatedAt"]);

export const billingReplayRuns = defineTable({
  runDate: v.string(),
  status: v.union(v.literal("running"), v.literal("passed"), v.literal("failed")),
  processedBalances: v.number(),
  discrepancies: v.number(),
  digest: v.string(),
  balanceCursorCreationTime: v.optional(v.number()),
  currentBalanceId: v.optional(v.id("billingBalances")),
  ledgerCursorCreationTime: v.optional(v.number()),
  currentTotalsJson: v.optional(v.string()),
  startedAt: v.number(),
  completedAt: v.optional(v.number()),
}).index("by_run_date", ["runDate"]);

export const billingSupportRecords = defineTable({
  organizationId: v.optional(v.id("organizations")),
  recordType: v.union(v.literal("dispute"), v.literal("support")),
  supportMinutes: v.number(),
  notes: v.string(),
  evidenceReference: v.string(),
  recordedBy: v.string(),
  recordedAt: v.number(),
}).index("by_recorded_at", ["recordedAt"]);

export const payAccessMirrorStates = defineTable({
  projectId: v.id("projects"),
  organizationId: v.id("organizations"),
  registryProjectId: v.number(),
  desiredCredits: v.int64(),
  desiredVersion: v.number(),
  submittedCredits: v.optional(v.int64()),
  submittedVersion: v.optional(v.number()),
  confirmedCredits: v.optional(v.int64()),
  confirmedVersion: v.optional(v.number()),
  status: v.union(
    v.literal("pending"),
    v.literal("submitted"),
    v.literal("confirmed"),
    v.literal("failed"),
  ),
  lastError: v.optional(v.string()),
  updatedAt: v.number(),
}).index("by_project_id", ["projectId"]);

export const payAccessMirrorAttempts = defineTable({
  mirrorStateId: v.id("payAccessMirrorStates"),
  projectId: v.id("projects"),
  desiredCredits: v.int64(),
  desiredVersion: v.number(),
  transactionHash: v.string(),
  status: v.union(v.literal("submitted"), v.literal("confirmed"), v.literal("failed")),
  submittedBy: v.string(),
  submittedAt: v.number(),
  verificationAttempts: v.optional(v.number()),
  verifiedAt: v.optional(v.number()),
  error: v.optional(v.string()),
})
  .index("by_transaction_hash", ["transactionHash"])
  .index("by_mirror_state_id_and_submitted_at", ["mirrorStateId", "submittedAt"]);

export const billingNotifications = defineTable({
  organizationId: v.id("organizations"),
  notificationType: v.union(
    v.literal("low_balance"),
    v.literal("zero_balance"),
    v.literal("promotional_expiry"),
    v.literal("reservation_recovery"),
    v.literal("topup_success"),
    v.literal("topup_failure"),
    v.literal("migration_notice"),
    v.literal("enforcement_scheduled"),
  ),
  dedupeKey: v.string(),
  title: v.string(),
  message: v.string(),
  topupId: v.optional(v.id("billingTopups")),
  paymentIntentId: v.optional(v.id("paymentIntents")),
  reservationId: v.optional(v.id("creditReservations")),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
}).index("by_organization_id_and_created_at", ["organizationId", "createdAt"]);

export const billingBalances = defineTable({
  organizationId: v.id("organizations"),
  book: billingBookValidator,
  promoAvailable: v.int64(),
  promoReserved: v.int64(),
  promoConsumed: v.int64(),
  promoExpired: v.int64(),
  paidAvailable: v.int64(),
  paidReserved: v.int64(),
  paidConsumed: v.int64(),
  paidExpired: v.int64(),
  version: v.number(),
  updatedAt: v.number(),
}).index("by_organization_id_and_book", ["organizationId", "book"]);

export const creditLots = defineTable({
  organizationId: v.id("organizations"),
  book: billingBookValidator,
  creditClass: creditClassValidator,
  sourceLedgerEntryId: v.id("billingLedgerEntries"),
  granted: v.int64(),
  available: v.int64(),
  reserved: v.int64(),
  consumed: v.int64(),
  expired: v.int64(),
  expiresAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_organization_id_and_book_and_credit_class", ["organizationId", "book", "creditClass"])
  .index("by_organization_id_and_book_and_credit_class_and_expires_at", [
    "organizationId",
    "book",
    "creditClass",
    "expiresAt",
  ])
  .index("by_expires_at", ["expiresAt"]);

export const billingLedgerEntries = defineTable({
  organizationId: v.id("organizations"),
  book: billingBookValidator,
  creditClass: creditClassValidator,
  entryType: v.union(
    v.literal("promo_grant"),
    v.literal("paid_grant"),
    v.literal("reserve"),
    v.literal("consume"),
    v.literal("release"),
    v.literal("expiry"),
    v.literal("adjustment"),
    v.literal("refund_adjustment"),
  ),
  amount: v.int64(),
  idempotencyKey: v.string(),
  projectId: v.optional(v.id("projects")),
  paymentIntentId: v.optional(v.id("paymentIntents")),
  reservationId: v.optional(v.id("creditReservations")),
  creditLotId: v.optional(v.id("creditLots")),
  topupReference: v.optional(v.string()),
  treasuryReceiptReference: v.optional(v.string()),
  actor: v.string(),
  reason: v.string(),
  environment: billingEnvironmentValidator,
  network: billingNetworkValidator,
  calculationVersion: v.number(),
  occurredAt: v.number(),
})
  .index("by_organization_id_and_book", ["organizationId", "book"])
  .index("by_organization_id_and_book_and_idempotency_key", [
    "organizationId",
    "book",
    "idempotencyKey",
  ])
  .index("by_payment_intent_id", ["paymentIntentId"])
  .index("by_reservation_id", ["reservationId"]);

export const creditReservations = defineTable({
  organizationId: v.id("organizations"),
  projectId: v.id("projects"),
  paymentIntentId: v.optional(v.id("paymentIntents")),
  book: billingBookValidator,
  network: billingNetworkValidator,
  creditClass: creditClassValidator,
  creditLotId: v.id("creditLots"),
  amount: v.int64(),
  status: v.union(
    v.literal("active"),
    v.literal("consumed"),
    v.literal("released"),
    v.literal("expired"),
  ),
  reserveIdempotencyKey: v.string(),
  terminalIdempotencyKey: v.optional(v.string()),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_organization_id_and_book_and_status", ["organizationId", "book", "status"])
  .index("by_payment_intent_id", ["paymentIntentId"])
  .index("by_status_and_expires_at", ["status", "expiresAt"])
  .index("by_organization_id_and_book_and_reserve_idempotency_key", [
    "organizationId",
    "book",
    "reserveIdempotencyKey",
  ]);

export const shadowBillingDecisions = defineTable({
  organizationId: v.optional(v.id("organizations")),
  projectId: v.id("projects"),
  paymentIntentId: v.optional(v.id("paymentIntents")),
  reservationId: v.optional(v.id("creditReservations")),
  phase: v.union(
    v.literal("would_reserve"),
    v.literal("would_consume"),
    v.literal("would_release"),
  ),
  outcome: v.union(
    v.literal("applied"),
    v.literal("fee_exempt"),
    v.literal("insufficient_balance"),
    v.literal("unmatched_success"),
    v.literal("disabled"),
    v.literal("error"),
  ),
  reason: v.string(),
  route: v.union(v.literal("stellar"), v.literal("pdax")),
  network: billingNetworkValidator,
  idempotencyKey: v.string(),
  legacyCheckoutCredits: v.optional(v.number()),
  correlationId: v.optional(v.string()),
  transactionHash: v.optional(v.string()),
  settlementTransactionId: v.optional(v.id("settlementTransactions")),
  quotedCost: v.optional(v.string()),
  actualCost: v.optional(v.string()),
  spread: v.optional(v.string()),
  failureCost: v.optional(v.string()),
  subsidy: v.optional(v.string()),
  costCurrency: v.optional(v.string()),
  rawCostInputsJson: v.optional(v.string()),
  calculationVersion: v.number(),
  createdAt: v.number(),
})
  .index("by_idempotency_key", ["idempotencyKey"])
  .index("by_project_id_and_created_at", ["projectId", "createdAt"])
  .index("by_organization_id_and_created_at", ["organizationId", "createdAt"])
  .index("by_payment_intent_id", ["paymentIntentId"]);

export const organizationMigrationCollisions = defineTable({
  ownerAddress: v.string(),
  tokenIdentifiers: v.array(v.string()),
  projectIds: v.array(v.id("projects")),
  reason: v.string(),
  detectedAt: v.number(),
}).index("by_owner_address", ["ownerAddress"]);
