"use client";

import { api } from "@repo/backend/convex/_generated/api";
import { Badge } from "@repo/ui/components/ui-customs/badge";
import { Alert, AlertDescription, AlertTitle } from "@repo/ui/components/ui/alert";
import { Button } from "@repo/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/ui/card";
import { Input } from "@repo/ui/components/ui/input";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  AlertCircleIcon,
  BookMarkedIcon,
  ExternalLinkIcon,
  LinkIcon,
  SaveIcon,
  ShieldCheckIcon,
  UsersIcon,
  VariableIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { Id } from "@repo/backend/convex/_generated/dataModel";
import type { CanonicalArgumentValue, ContractSpecDocumentV1 } from "@repo/stellar";

type ProjectRequestDraft = {
  functionName: string;
  arguments: Record<string, CanonicalArgumentValue>;
  settings: { baseFee: string; cpuInstructions: number };
};

export function ProjectPlaygroundPanel({
  projectId,
  contract,
  requestDraft,
  onOpenRequest,
  onResolvedPreview,
}: {
  projectId: string;
  contract: ContractSpecDocumentV1 | null;
  requestDraft: ProjectRequestDraft | null;
  onOpenRequest: (version: {
    network: "testnet" | "mainnet";
    contractId: string;
    functionName: string;
    argumentTemplateJson: string;
    sourceArgumentTemplateJson: string;
    resolutionHash: string;
    requestVersionId: Id<"playgroundRequestVersions">;
  }) => void;
  onResolvedPreview: (preview: {
    argumentTemplateJson: string;
    resolvedArgumentsJson: string;
    resolutionHash: string;
    requestVersionId?: Id<"playgroundRequestVersions">;
  }) => void;
}) {
  const convex = useConvex();
  const typedProjectId = projectId as Id<"projects">;
  const access = useQuery(api.playground_projects.queries.getMyAccess, {
    projectId: typedProjectId,
  });
  const savedContracts = useQuery(api.playground_projects.queries.listContracts, {
    projectId: typedProjectId,
  });
  const savedRequests = useQuery(api.playground_projects.queries.listRequests, {
    projectId: typedProjectId,
  });
  const testnetVariables = useQuery(api.playground_projects.queries.listVariables, {
    projectId: typedProjectId,
    network: "testnet",
  });
  const mainnetVariables = useQuery(api.playground_projects.queries.listVariables, {
    projectId: typedProjectId,
    network: "mainnet",
  });
  const members = useQuery(api.playground_projects.queries.listMembers, {
    projectId: typedProjectId,
  });
  const shares = useQuery(api.playground_projects.queries.listShares, {
    projectId: typedProjectId,
  });

  const saveContract = useMutation(api.playground_projects.mutations.saveContract);
  const createRequest = useMutation(api.playground_projects.mutations.createRequest);
  const updateRequest = useMutation(api.playground_projects.mutations.updateRequest);
  const duplicateRequest = useMutation(api.playground_projects.mutations.duplicateRequest);
  const upsertVariable = useMutation(api.playground_projects.mutations.upsertVariable);
  const deleteVariable = useMutation(api.playground_projects.mutations.deleteVariable);
  const upsertMember = useMutation(api.playground_projects.mutations.upsertMember);
  const removeMember = useMutation(api.playground_projects.mutations.removeMember);
  const createShare = useMutation(api.playground_projects.mutations.createShare);
  const revokeShare = useMutation(api.playground_projects.mutations.revokeShare);

  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [variableNetwork, setVariableNetwork] = useState<"testnet" | "mainnet">("testnet");
  const [variableName, setVariableName] = useState("");
  const [variableKind, setVariableKind] = useState<"string" | "address" | "contract">("string");
  const [variableValue, setVariableValue] = useState("");
  const [memberAddress, setMemberAddress] = useState("");
  const [memberRole, setMemberRole] = useState<"editor" | "viewer">("viewer");
  const [requestName, setRequestName] = useState("");
  const [contractName, setContractName] = useState("");
  const [contractDescription, setContractDescription] = useState("");
  const [contractTags, setContractTags] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [documentationUrl, setDocumentationUrl] = useState("");
  const [includePublicArguments, setIncludePublicArguments] = useState(false);
  const [executionSearch, setExecutionSearch] = useState("");
  const [argumentTemplateJson, setArgumentTemplateJson] = useState("{}");
  const [resolutionPreview, setResolutionPreview] = useState<{
    resolvedArguments: unknown;
    resolutionHash: string;
    issues: Array<{ path: string; message: string }>;
  } | null>(null);
  const executions = useQuery(api.playground_projects.queries.listExecutions, {
    projectId: typedProjectId,
    ...(executionSearch.trim() ? { search: executionSearch.trim() } : {}),
  });

  const canEdit = access?.role === "owner" || access?.role === "editor";
  const currentSavedContract = useMemo(
    () =>
      savedContracts?.find(
        (candidate) =>
          candidate.network === contract?.network && candidate.contractId === contract?.contractId,
      ),
    [contract, savedContracts],
  );
  const variables = variableNetwork === "testnet" ? testnetVariables : mainnetVariables;

  useEffect(() => {
    if (requestDraft) {
      setArgumentTemplateJson(JSON.stringify(requestDraft.arguments, null, 2));
      setResolutionPreview(null);
    }
  }, [requestDraft]);

  useEffect(() => {
    if (!contract) return;
    setContractName(currentSavedContract?.displayName ?? contract.contractId);
    setContractDescription(currentSavedContract?.description ?? "");
    setContractTags(currentSavedContract?.tags.join(", ") ?? "");
    setRepositoryUrl(currentSavedContract?.repositoryUrl ?? "");
    setDocumentationUrl(currentSavedContract?.documentationUrl ?? "");
  }, [contract, currentSavedContract]);

  async function run(label: string, operation: () => Promise<void>) {
    setBusy(label);
    setNotice(null);
    try {
      await operation();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Project operation failed");
    } finally {
      setBusy(null);
    }
  }

  async function ensureSavedContract() {
    if (!contract) throw new Error("Load a contract before saving it.");
    return await saveContract({
      projectId: typedProjectId,
      network: contract.network,
      contractId: contract.contractId,
      displayName: contractName.trim() || contract.contractId,
      description: contractDescription.trim(),
      tags: contractTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      wasmHash: contract.wasmHash,
      specHash: contract.specHash,
      ...(repositoryUrl.trim() ? { repositoryUrl: repositoryUrl.trim() } : {}),
      ...(documentationUrl.trim() ? { documentationUrl: documentationUrl.trim() } : {}),
    });
  }

  function saveLoadedContract() {
    void run("contract", async () => {
      await ensureSavedContract();
      setNotice("Contract saved to this Velo project.");
    });
  }

  function saveLoadedRequest() {
    void run("request", async () => {
      if (!requestDraft) throw new Error("Select a valid function and arguments first.");
      const savedContractId = await ensureSavedContract();
      await createRequest({
        projectId: typedProjectId,
        savedContractId,
        name: requestName.trim() || requestDraft.functionName,
        functionName: requestDraft.functionName,
        argumentTemplateJson,
        sourceStrategy: "connected_wallet",
        settings: requestDraft.settings,
        tags: [],
      });
      setRequestName("");
      setNotice("Reusable request saved as immutable version 1.");
    });
  }

  function previewVariables() {
    void run("preview", async () => {
      JSON.parse(argumentTemplateJson);
      const preview = await convex.query(api.playground_projects.queries.previewVariables, {
        projectId: typedProjectId,
        network: contract?.network ?? variableNetwork,
        argumentTemplateJson,
        ...(contract?.wasmHash ? { wasmHash: contract.wasmHash } : {}),
      });
      setResolutionPreview(preview);
      if (!preview.issues.length) {
        onResolvedPreview({
          argumentTemplateJson,
          resolvedArgumentsJson: JSON.stringify(preview.resolvedArguments),
          resolutionHash: preview.resolutionHash,
        });
      }
      setNotice(
        preview.issues.length
          ? "Variable resolution found field-path errors."
          : "Resolved values are ready for review before simulation.",
      );
    });
  }

  function openSavedRequest(
    version: NonNullable<NonNullable<typeof savedRequests>[number]["version"]>,
  ) {
    void run(`open-${version._id}`, async () => {
      const preview = await convex.query(api.playground_projects.queries.previewVariables, {
        projectId: typedProjectId,
        network: version.network,
        argumentTemplateJson: version.argumentTemplateJson,
        wasmHash: version.wasmHash,
        requestVersionId: version._id,
      });
      if (preview.issues.length) {
        setResolutionPreview(preview);
        throw new Error(
          preview.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
        );
      }
      onOpenRequest({
        network: version.network,
        contractId: version.contractId,
        functionName: version.functionName,
        argumentTemplateJson: JSON.stringify(preview.resolvedArguments),
        sourceArgumentTemplateJson: version.argumentTemplateJson,
        resolutionHash: preview.resolutionHash,
        requestVersionId: version._id,
      });
    });
  }

  function saveVariable() {
    void run("variable", async () => {
      await upsertVariable({
        projectId: typedProjectId,
        network: variableNetwork,
        name: variableName,
        kind: variableKind,
        value: variableValue,
      });
      setVariableName("");
      setVariableValue("");
      setNotice(`${variableNetwork} variable saved.`);
    });
  }

  function addMember() {
    void run("member", async () => {
      await upsertMember({
        projectId: typedProjectId,
        walletAddress: memberAddress,
        role: memberRole,
      });
      setMemberAddress("");
      setNotice(`Project ${memberRole} saved.`);
    });
  }

  function shareRequest(
    request: NonNullable<typeof savedRequests>[number],
    visibility: "private_project" | "public_unlisted",
  ) {
    if (!request.version) return;
    void run(`share-${request._id}`, async () => {
      if (
        visibility === "public_unlisted" &&
        includePublicArguments &&
        !window.confirm(
          "Public arguments are visible to anyone with the link. Continue after confirming they contain no private data?",
        )
      ) {
        return;
      }
      const snapshot = {
        schemaVersion: 1,
        network: request.version!.network,
        contractId: request.version!.contractId,
        wasmHash: request.version!.wasmHash,
        functionName: request.version!.functionName,
        ...(visibility === "public_unlisted" && includePublicArguments
          ? { arguments: JSON.parse(request.version!.argumentTemplateJson) as unknown }
          : {}),
      };
      const result = await createShare({
        projectId: typedProjectId,
        requestVersionId: request.version!._id,
        visibility,
        includeArguments: visibility === "public_unlisted" && includePublicArguments,
        snapshotJson: JSON.stringify(snapshot),
      });
      const url =
        visibility === "public_unlisted"
          ? `${window.location.origin}/playground/share/${result.token}`
          : `${window.location.origin}/projects/${projectId}/playground?share=${result.token}`;
      await navigator.clipboard.writeText(url);
      setNotice(
        `${visibility === "public_unlisted" ? "Unlisted public" : "Private project"} share copied. Arguments ${visibility === "public_unlisted" && includePublicArguments ? "are included after explicit review" : "are excluded"}.`,
      );
    });
  }

  function createNewVersion(request: NonNullable<typeof savedRequests>[number]) {
    if (!request.version) return;
    void run(`update-${request._id}`, async () => {
      if (
        !requestDraft ||
        !contract ||
        request.version!.contractId !== contract.contractId ||
        request.version!.network !== contract.network ||
        request.version!.functionName !== requestDraft.functionName
      ) {
        throw new Error("Open this saved request before creating its next version.");
      }
      await updateRequest({
        requestId: request._id,
        argumentTemplateJson,
        sourceStrategy: "connected_wallet",
        settings: requestDraft.settings,
        tags: request.version!.tags,
      });
      setNotice(`Saved immutable version ${request.currentVersion + 1}.`);
    });
  }

  function duplicateSavedRequest(request: NonNullable<typeof savedRequests>[number]) {
    void run(`duplicate-${request._id}`, async () => {
      await duplicateRequest({ requestId: request._id });
      setNotice("Request duplicated as a separate version 1.");
    });
  }

  if (access === null) {
    return (
      <Alert variant="destructive">
        <ShieldCheckIcon />
        <AlertTitle>Project access denied</AlertTitle>
        <AlertDescription>This wallet is not a member of the selected project.</AlertDescription>
      </Alert>
    );
  }

  return (
    <section className="grid gap-6" aria-label="Velo project integration">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-2xl font-semibold">Velo project workflow</h2>
        <Badge variant="info">Sprint 6</Badge>
        {access ? <Badge variant="gray">{access.role}</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Save immutable request versions, resolve non-secret environment values, and trace every
        project invocation without persisting signatures or transaction envelopes.
      </p>

      {notice ? (
        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>Project update</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SaveIcon className="size-4" /> Save current work
            </CardTitle>
            <CardDescription>
              Contract identity includes network and produces an upgrade warning when its Wasm hash
              changes.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {currentSavedContract?.wasmHash !== undefined &&
            currentSavedContract.wasmHash !== contract?.wasmHash ? (
              <Alert>
                <AlertCircleIcon />
                <AlertTitle>Contract Wasm changed</AlertTitle>
                <AlertDescription>
                  Saving updates metadata and the observed Wasm hash. Existing request versions
                  remain immutable and retain their original hash.
                </AlertDescription>
              </Alert>
            ) : null}
            <Input
              value={contractName}
              onChange={(event) => setContractName(event.target.value)}
              placeholder="Contract display name"
              disabled={!canEdit}
            />
            <Input
              value={contractDescription}
              onChange={(event) => setContractDescription(event.target.value)}
              placeholder="Description"
              disabled={!canEdit}
            />
            <Input
              value={contractTags}
              onChange={(event) => setContractTags(event.target.value)}
              placeholder="Tags, comma separated"
              disabled={!canEdit}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={repositoryUrl}
                onChange={(event) => setRepositoryUrl(event.target.value)}
                placeholder="Repository URL"
                disabled={!canEdit}
              />
              <Input
                value={documentationUrl}
                onChange={(event) => setDocumentationUrl(event.target.value)}
                placeholder="Documentation URL"
                disabled={!canEdit}
              />
            </div>
            <Button
              variant="outline"
              disabled={!canEdit || !contract || busy !== null}
              onClick={saveLoadedContract}
            >
              <SaveIcon /> {currentSavedContract ? "Update saved contract" : "Save contract"}
            </Button>
            <Input
              value={requestName}
              onChange={(event) => setRequestName(event.target.value)}
              placeholder="Reusable request name"
              disabled={!canEdit}
            />
            <label className="grid gap-1 text-sm font-medium">
              Canonical argument template
              <textarea
                aria-label="Canonical argument template"
                value={argumentTemplateJson}
                onChange={(event) => {
                  setArgumentTemplateJson(event.target.value);
                  setResolutionPreview(null);
                }}
                className="min-h-32 rounded-md border bg-background p-3 font-mono text-xs"
                spellCheck={false}
                disabled={!canEdit}
              />
            </label>
            <Button
              variant="outline"
              disabled={!requestDraft || busy !== null}
              onClick={previewVariables}
            >
              <VariableIcon /> Preview resolved values
            </Button>
            {resolutionPreview ? (
              <div className="grid gap-2 rounded-md border p-3 text-xs">
                <p className="font-medium">Resolution hash</p>
                <code className="break-all">{resolutionPreview.resolutionHash}</code>
                {resolutionPreview.issues.length ? (
                  resolutionPreview.issues.map((issue) => (
                    <p key={`${issue.path}-${issue.message}`} className="text-destructive">
                      {issue.path}: {issue.message}
                    </p>
                  ))
                ) : (
                  <pre className="max-h-48 overflow-auto bg-zinc-950 p-3 text-zinc-100">
                    {JSON.stringify(resolutionPreview.resolvedArguments, null, 2)}
                  </pre>
                )}
              </div>
            ) : null}
            <Button
              disabled={!canEdit || !requestDraft || busy !== null}
              onClick={saveLoadedRequest}
            >
              <BookMarkedIcon /> Save request version
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <VariableIcon className="size-4" /> Environment variables
            </CardTitle>
            <CardDescription>
              Values are non-secret, network-specific, and previewed before simulation.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid grid-cols-2 gap-2">
              <select
                value={variableNetwork}
                onChange={(event) =>
                  setVariableNetwork(event.target.value as "testnet" | "mainnet")
                }
                className="h-11 rounded-md border bg-background px-3 text-sm"
              >
                <option value="testnet">Testnet</option>
                <option value="mainnet">Mainnet</option>
              </select>
              <select
                value={variableKind}
                onChange={(event) =>
                  setVariableKind(event.target.value as "string" | "address" | "contract")
                }
                className="h-11 rounded-md border bg-background px-3 text-sm"
                disabled={!canEdit}
              >
                <option value="string">String</option>
                <option value="address">Address</option>
                <option value="contract">Contract</option>
              </select>
            </div>
            <Input
              value={variableName}
              onChange={(event) => setVariableName(event.target.value.toUpperCase())}
              placeholder="TREASURY"
              disabled={!canEdit}
            />
            <Input
              value={variableValue}
              onChange={(event) => setVariableValue(event.target.value)}
              placeholder="Non-secret value"
              disabled={!canEdit}
            />
            <Button
              variant="outline"
              onClick={saveVariable}
              disabled={!canEdit || !variableName || !variableValue || busy !== null}
            >
              Save variable
            </Button>
            <div className="grid gap-2 text-sm">
              {variables?.map((variable) => (
                <div key={variable._id} className="flex items-center gap-2 rounded-md border p-2">
                  <code className="min-w-0 flex-1 truncate">
                    {variable.name}={variable.value}
                  </code>
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void deleteVariable({ variableId: variable._id })}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Saved requests and safe shares</CardTitle>
          <CardDescription>
            Opening a request reloads its contract; every replay still requires a fresh simulation.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              aria-label="Include reviewed arguments in public links"
              type="checkbox"
              checked={includePublicArguments}
              onChange={(event) => setIncludePublicArguments(event.target.checked)}
              disabled={!canEdit}
              className="mt-1"
            />
            <span>
              Explicitly include reviewed arguments in new public links. A second confirmation and
              server-side secret scan are required; variable references are rejected.
            </span>
          </label>
          {savedRequests?.length ? (
            savedRequests.map((request) => (
              <div
                key={request._id}
                className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{request.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {request.version?.network} · {request.version?.contractId} ·{" "}
                    {request.version?.functionName} · v{request.currentVersion}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {request.version ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openSavedRequest(request.version!)}
                    >
                      Open
                    </Button>
                  ) : null}
                  {canEdit ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => createNewVersion(request)}>
                        New version
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => duplicateSavedRequest(request)}
                      >
                        Duplicate
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => shareRequest(request, "private_project")}
                      >
                        <LinkIcon /> Private
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => shareRequest(request, "public_unlisted")}
                      >
                        <LinkIcon /> Public
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No saved requests yet.</p>
          )}
          {shares
            ?.filter((share) => share.revokedAt === undefined)
            .map((share) => (
              <div key={share._id} className="flex items-center gap-2 text-xs">
                <Badge variant="gray">{share.visibility}</Badge>
                <span className="flex-1">Created {new Date(share.createdAt).toLocaleString()}</span>
                {canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void revokeShare({ shareId: share._id })}
                  >
                    Revoke
                  </Button>
                ) : null}
              </div>
            ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersIcon className="size-4" /> Project members
            </CardTitle>
            <CardDescription>Owners manage editor and read-only viewer access.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {access?.role === "owner" ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto]">
                <Input
                  value={memberAddress}
                  onChange={(event) => setMemberAddress(event.target.value)}
                  placeholder="G..."
                  className="font-mono"
                />
                <select
                  value={memberRole}
                  onChange={(event) => setMemberRole(event.target.value as "editor" | "viewer")}
                  className="h-11 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                </select>
                <Button onClick={addMember} disabled={!memberAddress || busy !== null}>
                  Add
                </Button>
              </div>
            ) : null}
            {members?.map((member) => (
              <div
                key={member._id ?? `owner-${member.walletAddress}`}
                className="flex items-center gap-2 rounded-md border p-2 text-sm"
              >
                <code className="min-w-0 flex-1 truncate">{member.walletAddress}</code>
                <Badge variant="gray">{member.role}</Badge>
                {access?.role === "owner" && member.role !== "owner" && member._id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void run(`remove-${member.walletAddress}`, async () => {
                        await removeMember({
                          projectId: typedProjectId,
                          membershipId: member._id!,
                        });
                        setNotice("Project member access revoked.");
                      })
                    }
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card id="project-history">
          <CardHeader>
            <CardTitle>Recent project history</CardTitle>
            <CardDescription>Sanitized execution evidence expires after 30 days.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Input
              value={executionSearch}
              onChange={(event) => setExecutionSearch(event.target.value)}
              placeholder="Search contract, function, account, transaction, or status"
              aria-label="Search project history"
            />
            {executions?.length ? (
              executions.slice(0, 8).map((execution) => (
                <div key={execution._id} className="flex items-center gap-2 rounded-md border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {execution.functionName} · {execution.status}
                    </p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {execution.journeyCorrelationId}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" asChild>
                    <Link
                      href={`/projects/${projectId}/logs/${encodeURIComponent(execution.journeyCorrelationId)}`}
                    >
                      <ExternalLinkIcon /> Logs
                    </Link>
                  </Button>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No project executions recorded yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
