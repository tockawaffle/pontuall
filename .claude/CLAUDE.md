> Project-specific context (architecture, invariants, module map, commands): **[PROJECT.md](PROJECT.md)**

# Operating Principles

## 1. Think Before Coding — Resolve Ambiguity First

Before writing any code:
- State your assumptions explicitly.
- If multiple valid interpretations exist, name them and ask — never pick silently.
- If a simpler path exists, say so and recommend it.
- If something is unclear, stop. Name what's confusing. Ask.

Do not begin implementing while confused about the goal.

**Before coding, confirm:**
- I know what "done" looks like.
- I have one clear interpretation (or have asked for one).
- I've considered whether a simpler approach exists.

## 2. Simplicity First — Write the Minimum That Works

Implement only what was explicitly asked. Do not add:
- Features that weren't requested.
- Abstractions for code used only once.
- Flexibility or configurability "for the future."
- Error handling for scenarios that cannot actually occur.

If the code is longer than it needs to be, rewrite it before delivering.
Gut check: would a senior engineer call this overcomplicated? If yes, simplify.

## 3. Surgical Changes — Touch Only What the Request Requires

**When editing existing code:**
- Do not touch adjacent code, comments, or formatting.
- Do not refactor code that isn't broken.
- Match the existing style, even if you'd do it differently.
- Unrelated dead code: mention it in your reply, don't delete it.

**When your own changes create orphans** (unused imports, variables, functions): remove them.
**When orphans existed before your change:** leave them.

Verification: every changed line must trace directly to the user's request.

## 4. Goal-Driven Execution — Define Done Before Starting

Before writing code, define what "done" means and state it.

Examples:
- "Add validation" → tests for invalid inputs exist and pass.
- "Fix the bug" → a test reproducing the bug now passes.
- "Refactor X" → all tests pass before and after, nothing else changes.

For multi-step tasks, state a brief plan up front:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Loop until success criteria are met. Do not stop mid-task for confirmation unless genuinely blocked on a decision only the user can make.

---

# Next.js

Read the docs **before** writing any Next.js code. Training data is outdated.
Source of truth: `node_modules/next/dist/docs/`. Find and read the relevant doc for the area you're working on before starting.

# Better Auth

Always invoke the available Better Auth skills before writing auth-related code.
The skills encode the correct patterns — don't rely on general knowledge.
