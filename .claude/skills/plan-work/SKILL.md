---
name: plan-work
description:
  Plans work on agent-diff into briefs. Use when Dan asks what to work on next,
  or to plan a feature into briefs.
---

# Planning work

Planning decides what to build and in what order, and turns it into briefs. Each
brief is written with [`/create-brief`](../create-brief/SKILL.md), which also
covers one-off briefs, such as a bug fix, that aren't part of a plan. See
[0039](../../../docs/decisions/0039-work-is-planned-into-briefs.md).

## Choosing what's next

When Dan asks what to work on next, start from what agent-diff is meant to be,
then what's left to decide and build. Read:

- The product docs: [`README.md`](../../../README.md), for what agent-diff does
  and how a review works, and the docs its Documentation section links to, such
  as the [decisions](../../../docs/decisions/README.md) and
  [research](../../../docs/research/README.md).
- The open questions: the Open questions section of `README.md`, and the
  Follow-up design choices section of each decision.
- The open tasks and epics in the Aven project `agent-diff`, such as with
  `aven list --project agent-diff --open`.
- What merged recently, such as with `git log --oneline origin/main`.

Compare what the product docs describe with what's built, and what's open.
Recommend one thing, with your reasons, and list the alternatives briefly.

## Kinds of brief

A plan is made of the decision, research, and build briefs described in
[`/create-brief`](../create-brief/SKILL.md#kinds-of-brief).

Don't open documentation pull requests from the agent session that plans. Agreed
design reaches the repo through decision briefs.

## Splitting a feature into slices

Split a feature into build briefs that are vertical slices. Each one delivers
one thing end to end, through every layer it touches: storage, the API, the CLI,
and the review UI.

- The first slice is the smallest version of the whole flow.
- A later slice that touches something built earlier also updates it. For
  example, a diff mode slice also shows comments in that diff mode.

## Dependencies

Make each build brief depend, with `aven dep add`, on:

- The decision briefs it builds to.
- The slices it builds on.

A brief that changes glossary terms also depends on any brief already renaming
terms in the same files. See
[Depending on another brief](../create-brief/SKILL.md#depending-on-another-brief).

## Waves

Group the briefs into waves that can run together, with at most two briefs in a
wave, because more burns through Dan's usage limit. A dependency means waiting
only for the brief it names, not for the whole wave it's in.

## The plan is an Aven epic

Each feature gets an epic in `agent-diff`, with its briefs added to it:

```sh
aven add "<feature>" --project agent-diff --epic --description-stdin
aven epic add <brief ref> <epic ref>
```

The epic's description holds:

- The wave table, naming briefs already written by ref, and briefs still to
  write by title.
- Notes on what's already agreed for the briefs not written yet.

Plans live in Aven, not in the repo, because Aven refs never appear on GitHub
([0034](../../../docs/decisions/0034-briefs-are-aven-tasks.md)).

## Writing briefs just in time

Write only the briefs in the next waves. Later briefs stay as notes in the epic
until the earlier slices have taught something.

Write each brief with [`/create-brief`](../create-brief/SKILL.md), and add it to
the epic.
