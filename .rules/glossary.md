# Managing the glossary

`docs/glossary.md` holds the terms agreed on for this project. Every doc must
use those terms as defined, and the glossary must never contain conflicts.

## Using terms

- Use glossary terms as defined in every doc, including `README.md`,
  `AGENTS.md`, rules, and decisions.
- Don't introduce synonyms for an existing term. For example, write "working
  directory", not "workspace" or "checkout".
- If a doc needs a concept the glossary doesn't cover, propose a term to the
  user before using it.

## What counts as a conflict

- The same word with two meanings.
- Two words for the same meaning.
- A definition that contradicts another term, an accepted decision, or how
  `README.md` describes the product.

If a change would create a conflict, stop and ask the user to resolve it before
writing anything. Explain both sides of the conflict and suggest how to resolve
it.

## Adding a term

1. Only add terms the user has agreed on, either directly or through an accepted
   decision that uses them.
2. Check the existing terms for the same name or an overlapping meaning, and
   check the definition against accepted decisions and `README.md`.
3. Add the term in alphabetical order, as a `###` heading followed by the
   definition. Link to related terms and to the decision that introduced it, if
   there is one.

## Changing a term

1. Only change a term's name or meaning with the user's agreement.
2. Check that the new definition doesn't conflict with other terms, accepted
   decisions, or `README.md`.
3. Update every use of the term in `README.md`, `AGENTS.md`, `.rules/`, and
   `docs/`, including links to its heading. In decisions, update the wording
   only. Never change what a decision decided.
4. Update other glossary entries that refer to it.

## Removing a term

1. Only remove a term with the user's agreement.
2. Find every use of the term in `README.md`, `AGENTS.md`, `.rules/`, and
   `docs/`, and replace or remove it, so nothing refers to a term that no longer
   exists.
3. Remove links to the term from other glossary entries.
