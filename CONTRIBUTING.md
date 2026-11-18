# Contributing

Thanks for helping! Issues and pull requests are welcome.

## Setup

```sh
pnpm install
pnpm test        # unit tests (vitest)
pnpm typecheck   # TypeScript across the workspace
```

Run the app against a throwaway library:

```sh
PROTOTYPER_LIBRARY=/tmp/pt-lib PROTOTYPER_USER_DATA=/tmp/pt-data pnpm --filter @prototyper/desktop dev
```

Run the share server locally:

```sh
pnpm --filter @prototyper/overlay build
ADMIN_TOKEN=$(openssl rand -hex 32) DATA_DIR=/tmp/pt-server pnpm --filter @prototyper/server dev
```

Then add `http://127.0.0.1:3700` as a share domain in the app's Settings, with the same admin token.

## Where things are

- **The content contract** (`packages/shared`) is the core: every editable element has a `data-pt` key, and client edits are spliced into the HTML by source position. Changes here need tests.
- **What Claude is told** lives in `packages/prototype-kit` (`templates/CLAUDE.md` and the prompts in `src/index.ts`). If you change a prompt, run a real generation (`apps/desktop/scripts/e2e-generate.ts`) and check that the linter still passes.
- **The client overlay** (`packages/overlay`) is vanilla TypeScript in a Shadow DOM, with Italian and English strings in `src/i18n.ts`.
- **App translations** are in `apps/desktop/src/renderer/src/i18n.tsx`, keyed by the English text.

## Guidelines

- Keep it small and readable; prefer plain files and explicit code over frameworks.
- Code, comments and docs in English. The UI is translated.
- Add or update tests for behavior changes (`pnpm test` must pass).
- One topic per pull request, with a short description of what and why.
