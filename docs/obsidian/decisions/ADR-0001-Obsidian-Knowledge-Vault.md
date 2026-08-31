---
type: decision
area: repository
status: accepted
last_updated: 2026-08-31
source_of_truth: repository
---

# ADR-0001: Obsidian Knowledge Vault

## Context

AI coding agents repeatedly scanning the Velo repository wastes context and increases the chance that architectural relationships are missed.

## Decision

Maintain an Obsidian-compatible knowledge vault under `docs/obsidian` as a repository-level contextual index.

Agents must consult relevant vault documentation before broad source-code exploration and update documentation after meaningful changes.

The vault uses concise notes, YAML freshness metadata, and Obsidian wiki links to connect repository structure, architecture, modules, contracts, data, operations, workflows, and decisions.

## Consequences

Benefits:

- lower agent context usage;
- faster repository navigation;
- persistent architectural memory;
- accumulated project knowledge;
- explicit technical decisions;
- easier onboarding.

Tradeoffs:

- documentation can become stale;
- agents and developers must maintain it;
- repository source remains authoritative when documentation conflicts.

> Source code is the ultimate source of truth. The vault is a navigation and context layer over the source code.

## Maintenance Rule

Update only notes whose documented knowledge changed. Record significant knowledge changes in [[changelog/Knowledge Changelog]] and keep secret values out of all vault files.
