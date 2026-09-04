# Technical Debt — Manual Actions Required

This file tracks work that autonomous development cycles deliberately
deferred because it needs something only a human can do: a real external
account, a credential, an OAuth consent screen, a dashboard click, or another
manual setup step. Each item was implemented behind a feature flag (or an
unset env var) with a working local stub, so the codebase is never blocked
on this list — but the feature stays off in production until the item below
is done.

See `CLAUDE.md` → "External dependencies never block autonomous work" for
the policy this file implements, and `CLAUDE.md` → "Superadmin access" for
how to flip a `feature_flags` row.

Existing pre-dates for this pattern (already documented in `CLAUDE.md`'s
Environment Variables table and `TODO.md`'s "Stripe / billing" tech-debt
section — not repeated here in full): `STRIPE_SECRET_KEY` /
`billing_stripe` flag, `RESEND_API_KEY`, `ANTHROPIC` per-user keys. New items
from autonomous cycles are appended below, most recent first.

---

## Template for new entries

```markdown
## [Feature] — added YYYY-MM-DD by [cycle/PR]

**What's gated:** [flag key or env var] — off/unset by default.
**What Gustavo needs to do manually:** [exact steps — account creation,
dashboard config, env vars to set].
**How to turn it on:** [flag to flip / env var to set].
**How to validate it worked:** [what to check after flipping it].
**Local stub while off:** [what the code does instead, and where].
```

---

_(No autonomous-cycle-generated items yet. This cycle's increment —
server-side `allow_download` enforcement — needed no external dependency,
so nothing was added here. Future cycles append above this line.)_
