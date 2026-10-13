# Ignoring files

Prettier only reads the root `.gitignore`, so every ignore pattern lives there.
Follow these steps whenever you add or change an ignore pattern.

## Steps

1. Add the pattern to the root `.gitignore`. Never create a `.gitignore` in a
   subdirectory, because Prettier wouldn't see it and would format the ignored
   files.
2. When a pattern applies to only one directory, prefix it with that directory's
   path, such as `/prototype/dist/`.
3. Check with `npm run format:check` that Prettier skips the newly ignored
   files.
