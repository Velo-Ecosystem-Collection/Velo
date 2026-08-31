"use client";

import { env } from "@/core/config/env";
import { stellarConfig } from "@/core/config/stellar";
import { useWallet } from "@/core/wallet/wallet-provider";
import { buildSetDisplayBalanceTransaction, submitSignedTransaction } from "@repo/stellar";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/ui/card";
import { Input } from "@repo/ui/components/ui/input";
import { Label } from "@repo/ui/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@repo/ui/components/ui/native-select";
import { Skeleton } from "@repo/ui/components/ui/skeleton";
import { Switch } from "@repo/ui/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/components/ui/tabs";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import {
  AlertTriangleIcon,
  BellIcon,
  CheckCircle2Icon,
  CreditCardIcon,
  HistoryIcon,
  Loader2Icon,
  ReceiptIcon,
  SettingsIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { toast } from "sonner";

import type { Doc, Id } from "@repo/backend/convex/_generated/dataModel";

import { formatBillingOfferAsset, resolveBillingOfferAsset } from "./billing-offer-assets";

type BillingView = {
  organization: Doc<"organizations">;
  billingSettings: Doc<"organizationBillingSettings"> | null;
  balance: Doc<"billingBalances">;
  topupsEnabled: boolean;
  topupsUnavailableReason: string | null;
  activeOffer: Doc<"billingOffers"> | null;
  topups: Doc<"billingTopups">[];
  receipts: Doc<"treasuryReceipts">[];
  ledger: Doc<"billingLedgerEntries">[];
  notifications: Doc<"billingNotifications">[];
  pdaxCharges: Array<{
    settlementTransactionId: Id<"settlementTransactions">;
    paymentIntentId?: Id<"paymentIntents">;
    status: Doc<"settlementTransactions">["status"];
    quotedCost: number;
    actualCost: number;
    spread: number;
    subsidy: number;
    currency: string;
    updatedAt: number;
  }>;
  isOperator: boolean;
};

type OperatorOrganization = Doc<"organizations"> & {
  billingSettings: Doc<"organizationBillingSettings"> | null;
};

type OperatorAccess = {
  walletAddress: string;
  isOperator: boolean;
};

const getBilling = makeFunctionReference<"query">("billing/merchant:get");
const getOperatorAccess = makeFunctionReference<"query">("billing/operators:getAccess");
const createTopup = makeFunctionReference<"mutation">("billing/topups:create");
const markNotificationRead = makeFunctionReference<"mutation">("billing/notifications:markRead");
const listOrganizations = makeFunctionReference<"query">("billing/admin:listOrganizations");
const listExceptions = makeFunctionReference<"query">("billing/exceptions:list");
const listOperators = makeFunctionReference<"query">("billing/operators:list");
const getPolicy = makeFunctionReference<"query">("billing/admin:getPolicy");
const updatePolicy = makeFunctionReference<"mutation">("billing/admin:updatePolicy");
const initializePolicy = makeFunctionReference<"mutation">("billing/admin:initializePolicy");
const setOperator = makeFunctionReference<"mutation">("billing/operators:setOperator");
const setOrganizationPolicy = makeFunctionReference<"mutation">(
  "billing/admin:setOrganizationPolicy",
);
const verifyAndGrantTrial = makeFunctionReference<"mutation">("billing/admin:verifyAndGrantTrial");
const resolveException = makeFunctionReference<"mutation">("billing/exceptions:resolve");
const assignBillingException = makeFunctionReference<"mutation">("billing/exceptions:assign");
const createOffer = makeFunctionReference<"mutation">("billing/offers:create");
const getLaunchReadiness = makeFunctionReference<"query">("billing/launch:getReadiness");
const recordLaunchApproval = makeFunctionReference<"mutation">("billing/launch:recordApproval");
const configureTreasury = makeFunctionReference<"mutation">("billing/launch:configureTreasury");
const activatePlatform = makeFunctionReference<"mutation">("billing/launch:activatePlatform");
const configureCohort = makeFunctionReference<"mutation">("billing/cohort:configure");
const listCostPeriods = makeFunctionReference<"query">("billing/finance:listCostPeriods");
const listFinanceReports = makeFunctionReference<"query">("billing/finance:listReports");
const createCostPeriod = makeFunctionReference<"mutation">("billing/finance:createCostPeriod");
const approveCostPeriod = makeFunctionReference<"mutation">("billing/finance:approveCostPeriod");
const generateFinanceReport = makeFunctionReference<"mutation">("billing/finance:generateReport");
const listMirrorStates = makeFunctionReference<"query">("billing/mirror:list");
const submitMirrorAttempt = makeFunctionReference<"mutation">("billing/mirror:submit");

function credits(value: bigint) {
  return value.toLocaleString();
}

function date(value: number | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

function shortHash(value: string) {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

export function BillingDashboard() {
  const router = useRouter();
  const billing = useQuery(getBilling, {}) as BillingView | null | undefined;
  const operatorAccess = useQuery(getOperatorAccess, {}) as OperatorAccess | undefined;
  const startTopup = useMutation(createTopup);
  const readNotification = useMutation(markNotificationRead);
  const [topupPending, setTopupPending] = useState(false);

  if (billing === undefined || operatorAccess === undefined) {
    return <BillingSkeleton />;
  }

  if (billing === null && operatorAccess.isOperator) {
    return (
      <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Velo platform administration</p>
          <h1 className="text-3xl font-bold tracking-tight">Billing Operations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage platform billing without requiring a merchant organization or project.
          </p>
        </div>
        <OperatorPanel />
      </main>
    );
  }

  if (billing === null) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>No commercial organization</AlertTitle>
          <AlertDescription>
            Create a project before configuring organization billing.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const totalAvailable = billing.balance.promoAvailable + billing.balance.paidAvailable;
  const topupsAvailable = billing.topupsEnabled && billing.activeOffer !== null;
  const handleTopup = async () => {
    setTopupPending(true);
    try {
      const result = (await startTopup({})) as {
        paymentIntentId: Id<"paymentIntents">;
      };
      router.push(`/pay/${result.paymentIntentId}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start top-up");
    } finally {
      setTopupPending(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {billing.organization.displayName}
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Prepaid credits backed by an immutable commercial ledger.
          </p>
        </div>
        <Button
          onClick={handleTopup}
          disabled={topupPending || !topupsAvailable}
          title={billing.topupsUnavailableReason ?? undefined}
          className="cursor-pointer"
        >
          {topupPending ? <Loader2Icon className="animate-spin" /> : <CreditCardIcon />}
          Top up credits
        </Button>
      </div>

      {billing.topupsUnavailableReason && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Credit purchases unavailable</AlertTitle>
          <AlertDescription>{billing.topupsUnavailableReason}</AlertDescription>
        </Alert>
      )}

      {totalAvailable <= 10n && (
        <Alert variant={totalAvailable === 0n ? "destructive" : "default"}>
          <AlertTriangleIcon />
          <AlertTitle>{totalAvailable === 0n ? "No credits available" : "Low balance"}</AlertTitle>
          <AlertDescription>
            {totalAvailable === 0n
              ? "Credit-enforced payments cannot start until credits are granted or purchased."
              : `${credits(totalAvailable)} credits remain.`}
          </AlertDescription>
        </Alert>
      )}

      {billing.billingSettings?.cohortStage && (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>
            Mainnet cohort: {billing.billingSettings.cohortStage.replace("_", " ")}
          </AlertTitle>
          <AlertDescription>
            {billing.billingSettings.graceUntil && billing.billingSettings.graceUntil > Date.now()
              ? `Grace remains active until ${date(billing.billingSettings.graceUntil)}.`
              : `Activation state: ${billing.billingSettings.activationState ?? "not enrolled"}.`}
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <BalanceCard title="Available" value={totalAvailable} icon={<CreditCardIcon />} />
        <BalanceCard
          title="Reserved"
          value={billing.balance.promoReserved + billing.balance.paidReserved}
          icon={<HistoryIcon />}
        />
        <BalanceCard
          title="Promotional"
          value={billing.balance.promoAvailable}
          detail={`Expires ${date(billing.organization.trialExpiresAt)}`}
          icon={<ShieldCheckIcon />}
        />
        <BalanceCard
          title="Paid"
          value={billing.balance.paidAvailable}
          detail="Purchased credits do not expire"
          icon={<ReceiptIcon />}
        />
      </section>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="history">Ledger</TabsTrigger>
          <TabsTrigger value="receipts">Receipts</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          {operatorAccess.isOperator && <TabsTrigger value="operations">Operations</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="grid gap-4 lg:grid-cols-2">
          <OfferCard
            offer={billing.activeOffer}
            onTopup={handleTopup}
            pending={topupPending}
            topupsEnabled={billing.topupsEnabled}
            unavailableReason={billing.topupsUnavailableReason}
          />
          <Card>
            <CardHeader>
              <CardTitle>Commercial terms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <p>
                Credits are consumed only after independently verified successful settlement.
                Failed, cancelled, expired, and abandoned payments consume no credit.
              </p>
              <p>
                Merchant-customer refunds do not automatically restore a Velo service credit.
                Verified Velo billing errors are corrected with auditable compensating entries.
              </p>
              <p>
                PDAX and off-ramp charges are disclosed separately and passed through at verified
                cost during the sandbox cohort.
              </p>
            </CardContent>
          </Card>
          <TopupStatus topups={billing.topups} />
          <PdaxCharges charges={billing.pdaxCharges} />
        </TabsContent>

        <TabsContent value="history">
          <LedgerTable entries={billing.ledger} />
        </TabsContent>

        <TabsContent value="receipts">
          <ReceiptTable receipts={billing.receipts} />
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardContent className="space-y-3 pt-6">
              {billing.notifications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No billing notifications.</p>
              ) : (
                billing.notifications.map((notification) => (
                  <button
                    key={notification._id}
                    type="button"
                    className="flex w-full cursor-pointer gap-3 rounded-lg border p-4 text-left hover:bg-muted/50"
                    onClick={() => readNotification({ notificationId: notification._id })}
                  >
                    <BellIcon className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{notification.title}</span>
                      <span className="block text-sm text-muted-foreground">
                        {notification.message}
                      </span>
                    </span>
                    {!notification.readAt && <Badge>New</Badge>}
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {operatorAccess.isOperator && (
          <TabsContent value="operations">
            <OperatorPanel />
          </TabsContent>
        )}
      </Tabs>
    </main>
  );
}

function PdaxCharges({ charges }: { charges: BillingView["pdaxCharges"] }) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>PDAX and off-ramp costs</CardTitle>
      </CardHeader>
      <CardContent>
        {charges.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No PDAX charges recorded. Verified third-party costs are passed through separately.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Quoted</TableHead>
                <TableHead>Actual fee</TableHead>
                <TableHead>Spread</TableHead>
                <TableHead>Subsidy</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {charges.map((charge) => (
                <TableRow key={charge.settlementTransactionId}>
                  <TableCell>{charge.status}</TableCell>
                  <TableCell>
                    {charge.quotedCost.toFixed(2)} {charge.currency}
                  </TableCell>
                  <TableCell>
                    {charge.actualCost.toFixed(2)} {charge.currency}
                  </TableCell>
                  <TableCell>
                    {charge.spread.toFixed(2)} {charge.currency}
                  </TableCell>
                  <TableCell>
                    {charge.subsidy.toFixed(2)} {charge.currency}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function BalanceCard({
  title,
  value,
  detail,
  icon,
}: {
  title: string;
  value: bigint;
  detail?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className="text-muted-foreground [&>svg]:size-4">{icon}</span>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{credits(value)}</p>
        {detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}
      </CardContent>
    </Card>
  );
}

function OfferCard({
  offer,
  onTopup,
  pending,
  topupsEnabled,
  unavailableReason,
}: {
  offer: Doc<"billingOffers"> | null;
  onTopup: () => void;
  pending: boolean;
  topupsEnabled: boolean;
  unavailableReason: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current offer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {offer ? (
          <>
            <div>
              <p className="text-3xl font-bold">{credits(offer.creditQuantity)} credits</p>
              <p className="text-muted-foreground">
                {offer.priceAmount} {formatBillingOfferAsset(offer.asset)} · Stellar Testnet
              </p>
            </div>
            <p className="text-sm text-muted-foreground">{offer.refundPolicy}</p>
            {unavailableReason && (
              <p className="text-sm text-amber-600 dark:text-amber-400">{unavailableReason}</p>
            )}
            <Button
              onClick={onTopup}
              disabled={pending || !topupsEnabled}
              className="cursor-pointer"
            >
              Purchase test credits
            </Button>
          </>
        ) : (
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>Top-ups unavailable</AlertTitle>
            <AlertDescription>An operator must activate a treasury-backed offer.</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function TopupStatus({ topups }: { topups: Doc<"billingTopups">[] }) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Recent top-ups</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pack</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topups.map((topup) => (
              <TableRow key={topup._id}>
                <TableCell>{credits(topup.creditQuantity)} credits</TableCell>
                <TableCell>
                  {topup.priceAmount} {formatBillingOfferAsset(topup.asset)}
                </TableCell>
                <TableCell>
                  <Badge variant={topup.status === "settled" ? "success" : "secondary"}>
                    {topup.status}
                  </Badge>
                </TableCell>
                <TableCell>{date(topup.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function LedgerTable({ entries }: { entries: Doc<"billingLedgerEntries">[] }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry._id}>
                <TableCell className="font-medium">{entry.entryType}</TableCell>
                <TableCell>{entry.creditClass}</TableCell>
                <TableCell>{credits(entry.amount)}</TableCell>
                <TableCell>{entry.reason}</TableCell>
                <TableCell>{date(entry.occurredAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function ReceiptTable({ receipts }: { receipts: Doc<"treasuryReceipts">[] }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Transaction</TableHead>
              <TableHead>Offer</TableHead>
              <TableHead>Paid</TableHead>
              <TableHead>Credits</TableHead>
              <TableHead>Verified</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipts.map((receipt) => (
              <TableRow key={receipt._id}>
                <TableCell className="font-mono text-xs">
                  {shortHash(receipt.transactionHash)}
                </TableCell>
                <TableCell>
                  {receipt.sku} v{receipt.offerVersion}
                </TableCell>
                <TableCell>
                  {receipt.amount} {formatBillingOfferAsset(receipt.asset)}
                </TableCell>
                <TableCell>{credits(receipt.creditQuantity)}</TableCell>
                <TableCell>{date(receipt.verifiedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function OperatorPanel() {
  const organizations = useQuery(listOrganizations, {}) as OperatorOrganization[] | undefined;
  const exceptions = useQuery(listExceptions, { status: "open" }) as
    | Doc<"billingExceptions">[]
    | undefined;
  const operators = useQuery(listOperators, {}) as Doc<"billingOperatorWallets">[] | undefined;
  const applyOrganizationPolicy = useMutation(setOrganizationPolicy);
  const approveOrganization = useMutation(verifyAndGrantTrial);
  const applyExceptionResolution = useMutation(resolveException);
  const assignException = useMutation(assignBillingException);
  const applyOperator = useMutation(setOperator);
  const applyCohortConfiguration = useMutation(configureCohort);
  const [walletAddress, setWalletAddress] = useState("");

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <PolicyControls />
      <OfferEditor />
      <LaunchReadinessPanel />
      <FinancePanel />
      <MirrorPanel />
      <Card>
        <CardHeader>
          <CardTitle>Operator wallets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              await applyOperator({ walletAddress, active: true });
              setWalletAddress("");
              toast.success("Operator wallet added");
            }}
          >
            <Input
              value={walletAddress}
              onChange={(event) => setWalletAddress(event.target.value)}
              placeholder="G..."
            />
            <Button type="submit" disabled={!walletAddress.trim()} className="cursor-pointer">
              Add
            </Button>
          </form>
          {operators?.map((operator) => (
            <div
              key={operator._id}
              className="flex items-center justify-between gap-3 rounded-lg border p-3"
            >
              <span className="truncate font-mono text-xs">{operator.walletAddress}</span>
              <Switch
                checked={operator.active}
                onCheckedChange={(active) =>
                  applyOperator({ walletAddress: operator.walletAddress, active }).catch((error) =>
                    toast.error(error instanceof Error ? error.message : "Operator update failed"),
                  )
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Organizations and trial access</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {organizations?.map((organization) => (
            <form
              key={organization._id}
              className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_auto_auto_auto] md:items-center"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const graceUntil = new Date(String(form.get("graceUntil"))).getTime();
                try {
                  await applyCohortConfiguration({
                    organizationId: organization._id,
                    cohortStage: "design_partner",
                    enforcementEnabled: true,
                    graceUntil,
                    payAccessMirrorEnabled: true,
                    sendMigrationNotice: true,
                    sendLowBalanceNotice: true,
                  });
                  toast.success("Cohort grace and enforcement schedule saved");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Cohort update failed");
                }
              }}
            >
              <div>
                <p className="font-medium">{organization.displayName}</p>
                <p className="text-xs text-muted-foreground">
                  {organization.verificationStatus} · trial {organization.trialState}
                </p>
              </div>
              <label
                htmlFor={`sandbox-enforcement-${organization._id}`}
                className="flex items-center gap-2 text-sm"
              >
                Sandbox enforcement
                <Switch
                  id={`sandbox-enforcement-${organization._id}`}
                  checked={organization.billingSettings?.sandboxEnforcementEnabled ?? false}
                  onCheckedChange={(sandboxEnforcementEnabled) =>
                    applyOrganizationPolicy({
                      organizationId: organization._id,
                      enforcementEnabled: organization.billingSettings?.enforcementEnabled ?? false,
                      shadowEnabled: organization.billingSettings?.shadowEnabled ?? false,
                      sandboxEnforcementEnabled,
                    })
                  }
                />
              </label>
              <Label>
                Grace deadline
                <Input
                  name="graceUntil"
                  type="datetime-local"
                  defaultValue={new Date(Date.now() + 7 * 24 * 60 * 60_000)
                    .toISOString()
                    .slice(0, 16)}
                  required
                />
              </Label>
              <Button
                variant="outline"
                className="cursor-pointer"
                onClick={() =>
                  approveOrganization({
                    organizationId: organization._id,
                    evidenceReference: "operator-ui-manual-review",
                    reason: "Approved for internal Sprint 2 sandbox",
                    grantTrial: true,
                  }).then(() => toast.success("Organization verified and trial granted"))
                }
              >
                <ShieldCheckIcon />
                Verify + grant
              </Button>
              <Button type="submit" variant="outline" className="cursor-pointer">
                Schedule cohort
              </Button>
            </form>
          ))}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Open reconciliation exceptions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {exceptions?.length === 0 && (
            <p className="text-sm text-muted-foreground">No open exceptions.</p>
          )}
          {exceptions?.map((exception) => (
            <div
              key={exception._id}
              className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center"
            >
              <AlertTriangleIcon className="size-4 text-amber-500" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{exception.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {exception.severity ?? "medium"} · {exception.exceptionType} · opened{" "}
                  {date(exception.createdAt)} · SLA {date(exception.slaDueAt)} ·{" "}
                  {exception.assignee ?? "unassigned"}
                </p>
              </div>
              {!exception.assignee && operators?.[0] && (
                <Button
                  variant="outline"
                  onClick={() =>
                    assignException({
                      exceptionId: exception._id,
                      assignee: operators[0]!.walletAddress,
                      note: "Assigned from billing operations",
                    })
                  }
                >
                  Assign
                </Button>
              )}
              <Button
                variant="outline"
                className="cursor-pointer"
                onClick={() =>
                  applyExceptionResolution({
                    exceptionId: exception._id,
                    action: "retry_verification",
                    note: "Retried from the Sprint 2 operator console",
                  })
                }
              >
                Retry
              </Button>
              <Button
                className="cursor-pointer"
                onClick={() =>
                  applyExceptionResolution({
                    exceptionId: exception._id,
                    action: "acknowledge",
                    note: "Reviewed and acknowledged by operator",
                  })
                }
              >
                <CheckCircle2Icon />
                Resolve
              </Button>
              {exception.organizationId && (
                <Button
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() =>
                    applyExceptionResolution({
                      exceptionId: exception._id,
                      action: "compensating_adjustment",
                      note: "One paid credit restored from the Sprint 2 operator console",
                      adjustmentAmount: 1n,
                      adjustmentCreditClass: "paid",
                    })
                  }
                >
                  +1 paid credit
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function LaunchReadinessPanel() {
  const [readinessAt] = useState(() => Date.now());
  const readiness = useQuery(getLaunchReadiness, { now: readinessAt }) as
    | {
        approvals: Record<string, Doc<"billingLaunchApprovals"> | null>;
        approvalsReady: boolean;
        treasury: Doc<"billingTreasuries"> | null;
        offer: Doc<"billingOffers"> | null;
        ready: boolean;
        blockers: string[];
      }
    | undefined;
  const saveApproval = useMutation(recordLaunchApproval);
  const saveTreasury = useMutation(configureTreasury);
  const saveOffer = useMutation(createOffer);
  const changeLaunch = useMutation(activatePlatform);
  if (!readiness) return <Skeleton className="h-80 xl:col-span-2" />;

  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>Mainnet launch readiness</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <Alert variant={readiness.ready ? "default" : "destructive"}>
            <ShieldCheckIcon />
            <AlertTitle>
              {readiness.ready ? "All launch gates passed" : "Launch disabled"}
            </AlertTitle>
            <AlertDescription>
              {readiness.ready
                ? "Mainnet can be armed behind the global kill switch."
                : "Mainnet remains disabled until every launch gate passes."}
            </AlertDescription>
          </Alert>
          <div>
            <p className="mb-2 text-sm font-medium">Required approvals</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(readiness.approvals).map(([area, approval]) => (
                <Badge key={area} variant={approval?.status === "approved" ? "success" : "outline"}>
                  {area}: {approval?.status ?? "missing"}
                </Badge>
              ))}
            </div>
          </div>
          <form
            className="grid gap-3 rounded-lg border p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              await saveApproval({
                area: String(form.get("area")) as
                  | "product"
                  | "finance"
                  | "legal"
                  | "tax"
                  | "compliance"
                  | "security"
                  | "operations",
                status: "approved",
                evidenceReference: String(form.get("evidenceReference")),
                notes: String(form.get("notes")),
                policyDigest: String(form.get("policyDigest")),
              });
              toast.success("Append-only approval recorded");
            }}
          >
            <NativeSelect name="area" defaultValue="product">
              {["product", "finance", "legal", "tax", "compliance", "security", "operations"].map(
                (area) => (
                  <NativeSelectOption key={area} value={area}>
                    {area}
                  </NativeSelectOption>
                ),
              )}
            </NativeSelect>
            <Input name="evidenceReference" placeholder="Evidence reference" required />
            <Input name="notes" placeholder="Approval notes" required />
            <Input name="policyDigest" placeholder="sha256:..." required />
            <Button type="submit" variant="outline" className="cursor-pointer">
              Record approval
            </Button>
          </form>
          <div className="space-y-2 text-sm text-muted-foreground">
            {readiness.blockers.map((blocker) => (
              <p key={blocker}>• {blocker}</p>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!readiness.ready}
              onClick={() => changeLaunch({ action: "arm_mainnet" })}
            >
              Arm behind kill switch
            </Button>
            <Button
              disabled={!readiness.ready}
              onClick={() => changeLaunch({ action: "activate_mainnet" })}
            >
              Activate controlled Mainnet
            </Button>
            <Button variant="destructive" onClick={() => changeLaunch({ action: "rollback" })}>
              Roll back
            </Button>
          </div>
        </div>
        <div className="space-y-4">
          <form
            className="grid gap-3 rounded-lg border p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const address = String(form.get("address"));
              const asset = String(form.get("asset"));
              await saveTreasury({
                network: "public",
                address,
                asset,
                verificationEvidenceReference: String(form.get("verificationEvidenceReference")),
                signerPolicyReference: String(form.get("signerPolicyReference")),
                withdrawalPolicyReference: String(form.get("withdrawalPolicyReference")),
                monitoringOwner: String(form.get("monitoringOwner")),
                reconciliationOwner: String(form.get("reconciliationOwner")),
                incidentProcedureReference: String(form.get("incidentProcedureReference")),
                active: true,
              });
              toast.success("Production treasury configuration recorded");
            }}
          >
            <p className="font-medium">Production treasury readiness</p>
            <Input name="address" placeholder="Mainnet treasury G..." required />
            <Input name="asset" placeholder="USDC:GISSUER" required />
            <Input
              name="verificationEvidenceReference"
              placeholder="Verification-access evidence"
              required
            />
            <Input name="signerPolicyReference" placeholder="Signer policy" required />
            <Input name="withdrawalPolicyReference" placeholder="Withdrawal controls" required />
            <Input name="monitoringOwner" placeholder="Monitoring owner" required />
            <Input name="reconciliationOwner" placeholder="Reconciliation owner" required />
            <Input name="incidentProcedureReference" placeholder="Incident runbook" required />
            <Button type="submit" variant="outline">
              Save dedicated treasury
            </Button>
          </form>
          {readiness.treasury && (
            <form
              className="grid gap-3 rounded-lg border p-3"
              onSubmit={async (event) => {
                event.preventDefault();
                await saveOffer({
                  sku: "credits-100",
                  creditQuantity: 100n,
                  priceAmount: "20",
                  asset: readiness.treasury!.asset,
                  network: "public",
                  treasuryAddress: readiness.treasury!.address,
                  treasuryId: readiness.treasury!._id,
                  activeFrom: Date.now(),
                  refundPolicy:
                    "Top-ups are prepaid. Verified Velo billing errors receive auditable adjustments.",
                  activate: true,
                });
                toast.success("Controlled Mainnet offer activated behind launch gates");
              }}
            >
              <p className="font-medium">Mainnet 100-credit / 20-USDC SKU</p>
              <p className="text-xs text-muted-foreground">
                {readiness.treasury.asset} → {shortHash(readiness.treasury.address)}
              </p>
              <Button type="submit" variant="outline">
                Create Mainnet offer
              </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FinancePanel() {
  const periods = useQuery(listCostPeriods, {}) as Doc<"billingCostPeriods">[] | undefined;
  const reports = useQuery(listFinanceReports, {}) as Doc<"billingFinanceReports">[] | undefined;
  const createPeriod = useMutation(createCostPeriod);
  const approvePeriod = useMutation(approveCostPeriod);
  const generateReport = useMutation(generateFinanceReport);
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>Finance and margin reporting</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2">
        <form
          className="grid gap-3 rounded-lg border p-3"
          onSubmit={async (event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            await createPeriod({
              periodStart: new Date(String(form.get("periodStart"))).getTime(),
              periodEnd: new Date(String(form.get("periodEnd"))).getTime(),
              infrastructureCostUsd: String(form.get("infrastructureCostUsd")),
              fullyLoadedCostUsd: String(form.get("fullyLoadedCostUsd")),
              evidenceReference: String(form.get("evidenceReference")),
            });
            toast.success("Draft cost period created");
          }}
        >
          <Label>
            UTC period start
            <Input name="periodStart" type="datetime-local" required />
          </Label>
          <Label>
            UTC period end
            <Input name="periodEnd" type="datetime-local" required />
          </Label>
          <Input name="infrastructureCostUsd" placeholder="Infrastructure cost USD" required />
          <Input name="fullyLoadedCostUsd" placeholder="Fully loaded cost USD" required />
          <Input name="evidenceReference" placeholder="Approved cost evidence" required />
          <Button type="submit" variant="outline">
            Create cost period
          </Button>
        </form>
        <div className="space-y-3">
          {periods?.map((period) => (
            <div
              key={period._id}
              className="flex flex-wrap items-center gap-2 rounded-lg border p-3"
            >
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {date(period.periodStart)} – {date(period.periodEnd)}
                </p>
                <p className="text-xs text-muted-foreground">
                  ${period.infrastructureCostUsd} infrastructure · ${period.fullyLoadedCostUsd}{" "}
                  fully loaded · {period.status}
                </p>
              </div>
              {period.status === "draft" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    approvePeriod({
                      periodId: period._id,
                      note: "Approved from billing operations",
                    })
                  }
                >
                  Approve
                </Button>
              ) : (
                <Button size="sm" onClick={() => generateReport({ periodId: period._id })}>
                  Generate report
                </Button>
              )}
            </div>
          ))}
          {reports?.slice(0, 3).map((report) => (
            <div key={report._id} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">
                ${report.netRevenueUsd} net revenue · {report.successfulPayments} successes
              </p>
              <p className="text-xs text-muted-foreground">
                Infrastructure margin{" "}
                {report.infrastructureMarginBps === undefined
                  ? "—"
                  : `${(report.infrastructureMarginBps / 100).toFixed(2)}%`}{" "}
                · fully loaded{" "}
                {report.fullyLoadedMarginBps === undefined
                  ? "—"
                  : `${(report.fullyLoadedMarginBps / 100).toFixed(2)}%`}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MirrorPanel() {
  const wallet = useWallet();
  const states = useQuery(listMirrorStates, {}) as Doc<"payAccessMirrorStates">[] | undefined;
  const submitAttempt = useMutation(submitMirrorAttempt);
  const [signingId, setSigningId] = useState<Id<"payAccessMirrorStates"> | null>(null);
  const sign = async (state: Doc<"payAccessMirrorStates">) => {
    if (!wallet.address || !stellarConfig.payAccessContractId) {
      toast.error("Connect the configured external mirror-authority wallet");
      return;
    }
    setSigningId(state._id);
    try {
      const xdr = await buildSetDisplayBalanceTransaction({
        rpcUrl: stellarConfig.rpcUrl,
        networkPassphrase: stellarConfig.networkPassphrase,
        payAccessContractId: stellarConfig.payAccessContractId,
        sourcePublicKey: wallet.address,
        registryProjectId: state.registryProjectId,
        credits: state.desiredCredits,
        sourceVersion: state.desiredVersion,
      });
      const signedXdr = await wallet.signTransaction(xdr);
      const transactionHash = await submitSignedTransaction({
        rpcUrl: stellarConfig.rpcUrl,
        networkPassphrase: stellarConfig.networkPassphrase,
        signedXdr,
      });
      await submitAttempt({
        mirrorStateId: state._id,
        desiredCredits: state.desiredCredits,
        desiredVersion: state.desiredVersion,
        transactionHash,
      });
      toast.success("PayAccess display mirror submitted for independent verification");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mirror submission failed");
    } finally {
      setSigningId(null);
    }
  };
  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>PayAccess display mirror</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The connected external authority signs display-only balances. Convex entitlements never
          read this contract state.
        </p>
        {states?.map((state) => (
          <div key={state._id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                Project {state.registryProjectId} · {credits(state.desiredCredits)} credits
              </p>
              <p className="text-xs text-muted-foreground">
                version {state.desiredVersion} · {state.status}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={signingId === state._id || state.status === "confirmed"}
              onClick={() => sign(state)}
            >
              {signingId === state._id && <Loader2Icon className="animate-spin" />}
              Sign latest mirror
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PolicyControls() {
  const policy = useQuery(getPolicy, {}) as Doc<"billingPolicies"> | null | undefined;
  const savePolicy = useMutation(updatePolicy);
  const initialize = useMutation(initializePolicy);
  if (!policy) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Safety controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Initialize the deny-by-default billing policy before enabling sandbox monetization.</p>
          <Button className="cursor-pointer" onClick={() => initialize({})}>
            Initialize policy
          </Button>
        </CardContent>
      </Card>
    );
  }

  const patch = async (values: Partial<Doc<"billingPolicies">>) => {
    await savePolicy({
      billingLedgerWrite: values.billingLedgerWrite ?? policy.billingLedgerWrite,
      billingShadowMode: values.billingShadowMode ?? policy.billingShadowMode,
      mainnetCreditEnforcement: false,
      billingTopupsEnabled: values.billingTopupsEnabled ?? policy.billingTopupsEnabled,
      promoGrantEnabled: values.promoGrantEnabled ?? policy.promoGrantEnabled,
      pdaxBillingEnabled: values.pdaxBillingEnabled ?? policy.pdaxBillingEnabled,
      billingKillSwitch: values.billingKillSwitch ?? policy.billingKillSwitch,
      promoCredits: policy.promoCredits,
      promoValidityMs: policy.promoValidityMs,
      reservationTtlMs: policy.reservationTtlMs,
      promoFirst: policy.promoFirst,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Safety controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <PolicyToggle
          label="Global billing kill switch"
          checked={policy.billingKillSwitch}
          onCheckedChange={(billingKillSwitch) => patch({ billingKillSwitch })}
        />
        <PolicyToggle
          label="Commercial ledger writes"
          checked={policy.billingLedgerWrite}
          onCheckedChange={(billingLedgerWrite) => patch({ billingLedgerWrite })}
        />
        <PolicyToggle
          label="Test treasury top-ups"
          checked={policy.billingTopupsEnabled}
          onCheckedChange={(billingTopupsEnabled) => patch({ billingTopupsEnabled })}
        />
        <PolicyToggle
          label="Promotional grants"
          checked={policy.promoGrantEnabled}
          onCheckedChange={(promoGrantEnabled) => patch({ promoGrantEnabled })}
        />
        <p className="text-xs text-muted-foreground">
          Merchant purchases require Test treasury top-ups ON and the global billing kill switch
          OFF.
        </p>
        <p className="text-xs text-muted-foreground">
          Mainnet enforcement and kill-switch release use the guarded launch-readiness workflow.
        </p>
      </CardContent>
    </Card>
  );
}

function PolicyToggle({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      {label}
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function OfferEditor() {
  const saveOffer = useMutation(createOffer);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const offerAsset = String(form.get("offerAsset"));
    setSaving(true);
    try {
      await saveOffer({
        sku: String(form.get("sku")),
        creditQuantity: BigInt(String(form.get("creditQuantity"))),
        priceAmount: String(form.get("priceAmount")),
        asset: resolveBillingOfferAsset(offerAsset, env.NEXT_PUBLIC_USDC_ISSUER),
        network: "testnet",
        treasuryAddress: String(form.get("treasuryAddress")),
        refundPolicy: String(form.get("refundPolicy")),
        activeFrom: Date.now(),
        activate: true,
      });
      toast.success("Billing offer activated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Offer activation failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="size-4" />
          Activate offer
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={submit}>
          <Label>
            SKU
            <Input name="sku" defaultValue="credits-100" required />
          </Label>
          <div className="grid grid-cols-2 gap-3">
            <Label>
              Credits
              <Input name="creditQuantity" type="number" defaultValue="100" min="1" required />
            </Label>
            <Label>
              Price amount
              <Input name="priceAmount" defaultValue="20" required />
            </Label>
          </div>
          <Label>
            Payment asset
            <NativeSelect
              name="offerAsset"
              defaultValue={env.NEXT_PUBLIC_USDC_ISSUER ? "USDC" : "XLM"}
              required
            >
              <NativeSelectOption value="USDC" disabled={!env.NEXT_PUBLIC_USDC_ISSUER}>
                USDC
              </NativeSelectOption>
              <NativeSelectOption value="XLM">XLM</NativeSelectOption>
            </NativeSelect>
          </Label>
          <Label>
            Treasury wallet
            <Input name="treasuryAddress" placeholder="G..." required />
          </Label>
          <Label>
            Refund policy
            <Input
              name="refundPolicy"
              defaultValue="Top-ups are prepaid. Verified Velo billing errors receive auditable adjustments."
              required
            />
          </Label>
          <Button type="submit" disabled={saving} className="cursor-pointer">
            {saving ? <Loader2Icon className="animate-spin" /> : <SettingsIcon />}
            Activate version
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function BillingSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-8">
      <Skeleton className="h-10 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32" />
        ))}
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}
