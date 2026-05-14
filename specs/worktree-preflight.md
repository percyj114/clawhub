# Worktree Preflight

ClawHub linked worktrees should fail loudly before a command accidentally uses the wrong checkout,
shared Convex state, stale dependencies, or a dev server from another branch.

## Invariants

- Linked worktrees should run `bun run setup:worktree` before local app, seed, or proof work.
- A worktree is not ready if `.env.local` and `.convex` are only discoverable in a sibling checkout.
- Port `3000` is unsafe when it is already owned by another checkout; use a free port or stop the
  other process first.
- `node_modules` must include the Vite binary. A copied or stale dependency tree without
  `node_modules/.bin/vite` should be treated the same as missing dependencies.

## Operator Entry Point

Run `bun run worktree:preflight` before starting local UI proof, seeded dev data, or long-running
debugging in a linked checkout. A failed preflight is actionable setup feedback, not a product test
failure.
