Run one autonomous development cycle for Papershare: pick the next highest-value increment and take it all the way to a review-ready PR, without waiting for approval on reversible decisions.

Target increment (optional): $ARGUMENTS — if empty, choose the next highest-value item yourself from `TODO.md` (unchecked items in the current/next phase, or the Technical Debt Backlog) and `docs/TECH-DEBT.md`.

Steps:

1. Read `CLAUDE.md` in full, especially "Autonomous development workflow (mandatory)" and "External dependencies never block autonomous work". Read `TODO.md` and `docs/TECH-DEBT.md` for candidate increments.
2. Pick ONE increment. Prefer something well-scoped (fits in a single PR), valuable, and — all else equal — one that needs no new external dependency. If it does need one, plan from the start to gate it behind a feature flag with a local stub (never block on it).
3. Create a feature branch off `main` (never work on `main` directly).
4. Load the `tlc-spec-driven` skill by name and run its phases in order, dispatching the matching sub-agent from `.claude/agents/` for each: `spec-planner` (Specify, always) → `architect` (Design, only if sized Large/Complex) → `task-planner` (Tasks, only if sized Large/Complex) → `implementer` (Execute, one or more batches per the skill's ~7-task packing rule) → `verifier` (always, after the last task — author ≠ verifier, never skip).
5. Run the gates between phases yourself (the skill's `validate_spec.py`, `validate_tasks.py`, `check_commit.py`, `validate_state.py`) — a non-zero exit means stop and fix before advancing.
6. Once the Verifier reports PASS: run `npm run sf` and `npm test` (start Docker with `npm run services:up` first if needed) — both must exit 0 per the Definition of Done in `CLAUDE.md`. Update `CHANGELOG.md` and `TODO.md` to reflect what shipped, matching this repo's existing entry style.
7. If anything in this increment needed an external dependency, add its entry to `docs/TECH-DEBT.md` using the template there.
8. Push the feature branch (never `main`) and open a PR with `gh pr create`: title in Conventional Commits style, body summarizing what changed, what's behind a flag (if anything), what needs manual action, and the test plan. Report the PR URL back.

Do not stop mid-cycle to ask permission for reversible, local decisions (spec wording, file layout, task breakdown) — proceed and log assumptions per the agents' own instructions. Do stop and ask if you hit a genuine ambiguity about product intent that no amount of code-reading resolves, or if tests/gates can't be made to pass after reasonable effort.
