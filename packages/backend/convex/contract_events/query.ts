import { v } from "convex/values";

import type { ProjectId } from "../projects/types";

import { internalQuery, query } from "../_generated/server";
import { publicPollStatus } from "../poller_state/helpers";
import { pollerForProject } from "../poller_state/query";
import { projectOwnerOrNull, requireProjectOwnerByToken } from "../projects/helpers";
import {
  MAX_SCHEDULED_CONTRACTS,
  MAX_SCHEDULED_PROJECTS,
  METADATA_HASH_PATTERN,
  normalizePageSize,
} from "./helpers";

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!(await projectOwnerOrNull(ctx, args.projectId))) {
      return null;
    }

    const events = await ctx.db
      .query("contractEvents")
      .withIndex("by_project_ledger", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(normalizePageSize(args.limit));
    const poller = await pollerForProject(ctx, args.projectId);

    return {
      events,
      poller: poller
        ? {
            status: publicPollStatus(poller, events.length),
            lastLedger: poller.lastLedger,
            lastRunAt: poller.lastRunAt,
            errorMessage: poller.errorMessage,
          }
        : {
            status: publicPollStatus(null, events.length),
            lastLedger: undefined,
            lastRunAt: undefined,
            errorMessage: undefined,
          },
    };
  },
});

export const listPublicBySlug = query({
  args: {
    slug: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.trim().toLowerCase()))
      .unique();

    if (
      !project ||
      project.retiredAt !== undefined ||
      project.status !== "registered" ||
      project.registryProjectId === undefined ||
      !METADATA_HASH_PATTERN.test(project.metadataHash.trim())
    ) {
      return [];
    }

    const contracts = await ctx.db
      .query("projectContracts")
      .withIndex("by_project", (q) => q.eq("projectId", project._id))
      .take(100);
    const activeContractIds = new Set(
      contracts
        .filter(
          (contract) =>
            contract.status === "active" &&
            contract.registryProjectId === project.registryProjectId,
        )
        .map((contract) => contract.contractId),
    );

    if (activeContractIds.size === 0) {
      return [];
    }

    const limit = Math.min(10, Math.max(1, args.limit ?? 5));
    const events = await ctx.db
      .query("contractEvents")
      .withIndex("by_project_ledger", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(50);

    return events
      .filter((event) => activeContractIds.has(event.contractId))
      .slice(0, limit)
      .map((event) => ({
        eventId: event.eventId,
        contractId: event.contractId,
        transactionHash: event.transactionHash,
        ledger: event.ledger,
        timestamp: event.timestamp,
        topic: event.topic,
        type: event.type,
        decoded: event.decoded,
        observedAt: event.observedAt,
      }));
  },
});

export const getPollTarget = internalQuery({
  args: {
    projectId: v.id("projects"),
    ownerTokenIdentifier: v.string(),
    ownerSubject: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectOwnerByToken(
      ctx,
      args.projectId,
      args.ownerTokenIdentifier,
      args.ownerSubject,
    );

    if (project.retiredAt !== undefined || project.status !== "registered") {
      throw new Error("Only registered projects can poll contract events");
    }

    const contracts = await ctx.db
      .query("projectContracts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    const poller = await pollerForProject(ctx, args.projectId);

    return {
      contractIds: contracts
        .filter((contract) => contract.status === "active")
        .map((contract) => contract.contractId),
      lastLedger: poller?.lastLedger,
      cursor: poller?.cursor,
    };
  },
});

export const listScheduledTargets = internalQuery({
  args: {},
  handler: async (ctx) => {
    const activeContracts = await ctx.db
      .query("projectContracts")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();
    const projectIds = [...new Set(activeContracts.map((contract) => contract.projectId))];
    const activeProjectIds = new Set(
      (await Promise.all(projectIds.map((projectId) => ctx.db.get(projectId)))).flatMap((project) =>
        project && project.retiredAt === undefined && project.status === "registered"
          ? [project._id]
          : [],
      ),
    );
    const contractIdsByProject = new Map<ProjectId, string[]>();

    for (const contract of activeContracts
      .filter((candidate) => activeProjectIds.has(candidate.projectId))
      .slice(0, MAX_SCHEDULED_CONTRACTS)) {
      const contractIds = contractIdsByProject.get(contract.projectId) ?? [];
      if (contractIds.length < 20) {
        contractIds.push(contract.contractId);
        contractIdsByProject.set(contract.projectId, contractIds);
      }
    }

    const targets = [];
    for (const [projectId, contractIds] of Array.from(contractIdsByProject).slice(
      0,
      MAX_SCHEDULED_PROJECTS,
    )) {
      const project = await ctx.db.get(projectId);
      if (!project || project.retiredAt !== undefined || project.status !== "registered") {
        continue;
      }

      const poller = await pollerForProject(ctx, projectId);
      targets.push({
        projectId,
        contractIds,
        lastLedger: poller?.lastLedger,
        cursor: poller?.cursor,
      });
    }

    return targets;
  },
});

export const getPollTargetInternal = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.retiredAt !== undefined || project.status !== "registered") {
      throw new Error("Only registered projects can poll contract events");
    }

    const contracts = await ctx.db
      .query("projectContracts")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .take(100);
    const poller = await pollerForProject(ctx, args.projectId);

    return {
      contractIds: contracts
        .filter((contract) => contract.status === "active")
        .map((contract) => contract.contractId),
      lastLedger: poller?.lastLedger,
      cursor: poller?.cursor,
    };
  },
});
