# 0002: The file view can show unchanged files

- Status: Accepted
- Date: 2026-10-09

## Problem

A diff on its own hides context. To judge a change, the reviewer often needs
to read code that didn't change, such as callers, related modules, or tests.
If the file view only lists changed files, the reviewer has to leave the tool
to find that code.

## Solution

By default, the file view lists only files that changed in the selected diff
mode. A "show all files" toggle also lists unchanged files. Selecting an
unchanged file shows its full contents, and changed files stay visually
distinct and keep their git status.

## Tradeoffs

Benefits:

- The reviewer can read the surrounding code without leaving the review.
- The default view stays focused on what changed.

Costs:

- Listing every file in a large repo is expensive, so the tree has to load
  lazily rather than reading the whole repo up front.
- With the toggle on, changed files are harder to spot among many unchanged
  ones, so the UI has to keep them visually distinct.

## Follow-up design choices

- Can the reviewer comment on unchanged files, for example "also update this
  caller"?
- Are ignored files (per `.gitignore`) hidden, or available behind another
  toggle?
- Which version of an unchanged file is shown (working tree or `HEAD`), and
  does it depend on the diff mode?
- Does the file view need search or filtering by name?
