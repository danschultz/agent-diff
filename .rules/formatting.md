# Formatting new file types

Prettier formats every file type in the repo that it supports. Follow these
steps whenever a change adds a file type the repo doesn't have yet.

## Steps

1. Run `npm run format:check` and check that it covers the new file type.
   Prettier skips files it doesn't recognize without saying so, so also run
   `npx prettier --file-info <file>` and check that it names a parser.
2. If Prettier supports the language but doesn't recognize the file, such as an
   unusual extension or no extension, map it to a parser with `overrides` in
   `.prettierrc.json`. For example:

   ```json
   { "files": "*.code-workspace", "options": { "parser": "json" } }
   ```

3. If only a Prettier plugin would support the file type, or nothing does, ask
   Dan before adding a dependency or leaving the file type unformatted.
