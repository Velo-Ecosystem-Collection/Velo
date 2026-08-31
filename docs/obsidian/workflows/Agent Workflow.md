---
type: workflow
area: agents
status: current
last_updated: 2026-08-31
source_of_truth: repository
---

# Agent Workflow

This is the default knowledge-first workflow for Codex and other repository agents.

## Before Implementing a Task

1. Read `docs/obsidian/Home.md`.
2. Read `docs/obsidian/Repository Map.md`.
3. Identify relevant vault notes for the requested domain.
4. Read those notes.
5. Use them to identify likely source files.
6. Inspect those source files only.
7. Expand exploration only when existing knowledge is insufficient.

Agents should not recursively inspect the whole repository by default. Prefer `rg`/`rg --files` targeted to the paths identified in the vault, while excluding dependencies, build outputs, generated Convex files, Rust targets, lockfiles, binaries, and unrelated temporary files.

## During Implementation

Track important discoveries for the documentation update:

- hidden dependency or architectural boundary;
- unexpected data flow or authorization rule;
- naming/configuration convention;
- dangerous assumption or common failure mode;
- integration requirement or operational command.

## After Implementation

Update relevant notes when a change materially affects architecture, module responsibilities, API contracts, schema, Convex functions, Soroban contracts, Stellar flows, environment variables, commands, dependencies, workflows, or important behavior. Update that note's `last_updated` field and append a concise architectural entry to [[changelog/Knowledge Changelog]].

Do not update notes for trivial formatting/refactoring unless the documentation itself is affected.

## Reliability Rules

- Source code is authoritative when it conflicts with the vault.
- Verify implementation before following stale documentation.
- Never put secrets in the vault.
- Keep notes concise: paths, responsibilities, relationships, entry points, flows, and gotchas are more valuable than copied source.

Related: [[decisions/ADR-0001-Obsidian-Knowledge-Vault]], [[workflows/Feature Development]], [[Repository Map]].

