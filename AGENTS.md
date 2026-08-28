How to read this file: the rules in this preamble and everything under `## Strict Guidelines` are binding at all times; ask me before proceeding if there are any ambiguity. Comments inside this file's code examples sometimes annotate the examples for the reader of this file -- they are not necessarily an instruction to write comments in generated code.

- Git: never execute mutating `git` commands (`add`, `commit`, `push`, `checkout`, `restore`, `reset`, `stash`, `rebase`, `merge`, etc.) unless I explicitly instruct it. Read-only `git` commands (`status`, `diff`, `log`, `show`, `blame`) are allowed when useful but most of the times what you see is what you work with -- never use `git` to discard or rewrite changes. Whenever I allow it, never put yourself as the co-author.

## Strict Guidelines

### Implementation Guidelines

- Refer to the codebase, other files, and functions to understand how things are done. Match existing patterns and conventions rather than inventing new ones.
- **Design as if from day 1.** Every implementation must read as if it had always been part of the system's original, intentional design. When new work builds on top of existing functionality -- especially functionality with a lot of weaving between its parts -- do not layer the new behaviour around what exists (wrappers, special-case branches, parallel code paths, adapter shims, duplicated flows that avoid touching the original). Instead, rework the existing implementation so old and new form one coherent whole, as if the feature had been planned from the start. The extra refactoring this demands is expected and preferred over a quicker bolt-on: a reader of the final code should not be able to tell which parts came later. Existing behaviour must still hold after the rework.
- **Reference fidelity.** When a reference implementation is provided or a similar implementation already exists within the system, default to reference fidelity over cleverness: match the existing structure, flow, processing, relative placement of the logic, layers, UI, and abstraction boundary down to the granular level, rather than producing a different but equivalent implementation, unless there is a strong reason not to. Boundary with day-1 design: fidelity governs building something new modelled on an existing sibling; day-1 governs changing an existing feature. When both apply and following the sibling would mean replicating a bolt-on, day-1 wins -- rework toward the coherent shape and flag the divergence in your response.
- **Native-first.** When the codebase, or an installed dependency (and the like) provides a first-class construct for something, use that construct -- never re-implement functionality that already exists in the codebase or in an installed utility/dependency/package. Before writing anything generic, check what the deps, and the packages already provide, and use the existing implementation.
- Do not overdo. Avoid adding excessive safeguards, defensive `try`/`rescue`, fallback values, or re-validation for cases that cannot or most likely not happen -- let it crash or `raise` with a clear message instead.
- Question my method of approaching a problem when necessary, especially if it is not optimal or not sensible to implement.
- Run every project command through mise: prefix commands for mise-managed tools (mix, elixir, erlang, node, npm, ...) with `mise exec -- ` (e.g. `mise exec -- mix test`), since my toolchain versions are controlled by mise. Drop the prefix only when a command fails specifically because the tool is not managed by mise.
- Never add new comments unless instructed to. However, you are required to modify existing comments when necessary -- for example, to keep them accurate after adding or removing functionality -- following a similar writing style.
- All colours should come from the centralized theme layer. Never introduce page-local colour definitions, raw hex/rgb/hsl/oklch literals, or arbitrary-value colour classes (e.g. `text-[#ff0000]`), `color-mix()`. If a needed shade does not exist, add it to the central theme first, flag the addition in your response, and use it through the theme so updates stay global and consistent.
- Adhere to `#### Abstraction / Helper / Function Creation Rules` below.

#### Abstraction / Helper / Function Creation Rules

The default is inline. A new named function is the exception and must earn its place under the rules below; when in doubt, keep the logic inline.

##### Definitions used by these rules

- **Trivial mechanics**: logic readable at a glance as a low-level operation -- a one-to-three-step data transformation, parameter forwarding/reshuffling, primitive normalization, generic technical cleanup, or a single obvious expression. Test: if the best possible name for it would merely restate the code (`trim_and_downcase`, `put_default_status`), it is trivial mechanics.
- **Meaningful operation**: multi-step logic that carries a genuine domain or infrastructure concept -- it has a name in the business/system vocabulary that says *what* it means, not *how* it works (`calculate_invoice_total`, `authorize_export`).

##### Named functions

- Framework-required callback entrypoints and named functions needed for recursion are always allowed. The conditions below govern every other named function.
- A new named function may be created only when **all** of the following hold:
  1. It is a meaningful operation, not trivial mechanics. Trivial mechanics always stay inline -- even when the same mechanics are repeated in multiple places. Reuse alone is never enough.
  2. At least one of:
     - the exact logic is genuinely used in 2 or more places (real reuse, not speculative),
     - it encodes a genuine domain concept with its own meaning,
     - the inline version would be materially harder to read or maintain.
  3. The call site reads at a higher level of abstraction and is understandable without opening the helper.
  4. The function name communicates domain meaning rather than restating the implementation.
- If any condition fails, keep it inline.
- When a named function has multiple clauses matching different inputs, order the clauses identity/pass-through at the top, conversions in the middle, and nil/error/fallback/catch-all at the bottom where possible.

##### Branch-level evaluation

- Evaluate extraction at the branch level, not just the module level: logic used inside only one event branch, one `case`/`cond` branch, or one callback path stays inline in that branch -- do not extract it just because it is a few lines long or looks reusable.
- Branches that merely look similar but are tied to different IDs, fields, or business rules are not duplication. Keep them separate and inline.

##### Wrappers

- Single-use wrappers, thin wrappers, and pass-throughs around existing functions are not allowed -- call the existing function directly. A helper that only forwards parameters, wraps a single obvious expression, or reduces line count while adding indirection is not a valid helper.

##### Consolidating duplicated meaningful operations

- When the same meaningful operation exists (or would now exist) in 2 or more places, consolidate it into the one shared utility/module that already owns that concern. Prefer strengthening the existing utility into the canonical implementation over creating a new feature-local helper or parallel logic at the call site.
- Keep multiple implementations of the same operation only when a real behavioral difference forces it.
- Trivial mechanics are exempt from consolidation: never promote repeated trivial mechanics into a shared utility. Shared utilities already established in the codebase may of course keep being used.

### Description / Explanation / Analysis Guidelines

- When asked to describe, explain, or analyze, be complete within the scope of the request: cover every line, every function, and every module the request targets. For anything outside that scope that interacts with the target, summarize the relationship briefly instead of fully expanding it, and ask me before widening the scope.
- Always provide a simpler explanation along with real-world examples at the end of every explanation when applicable.
