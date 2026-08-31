# Should Papershare pivot to a product for accountants?

**Author:** PO / product strategy
**Date:** 2026-08-31
**Status:** Analysis for discussion — no decision made. Written in response to
"what's your opinion on taking the current product toward accounting-firm
software (contadores)?"

**TL;DR:** Don't do a full pivot now. The overlap between "what Papershare is"
and "what an accounting firm needs" is real but shallow (~30%), and it does
**not** include the part of the codebase we've invested most in (the
engagement-analytics engine). There **is** a credible vertical wedge — secure,
audit-trailed document exchange with a client-facing "missing documents"
checklist — that reuses ~70% of what exists and repoints the follow-up-email
engine from "sales drop-off" to "client hasn't sent the balancete." That wedge
is worth a **4–6 week validation sprint before writing pivot code.** Full
re-platform (client × competência × obrigações, two-way upload, fiscal
integrations) is a 12+ month bet into an occupied market and should not start
without 3+ design partners with a card on file.

---

## 1. What we actually have today

Grounded in a full read of the repo on 2026-08-31 (35 migrations, 24 models,
43 API routes, Phases 1–14 substantially shipped):

| Capability                                                                                                                 | Maturity                                                               | Reusable in an accounting product?                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Auth (session-based), soft-delete accounts, rate limiting, password reset                                                  | Solid                                                                  | ✅ As-is                                                                                                                             |
| Document upload (PDF/DOCX/PPTX), S3-compatible storage, soft-delete                                                        | Solid                                                                  | ✅ As-is                                                                                                                             |
| Configurable share links: password, expiry, revocation, **NDA/consent gate**, email allow-list, watermark, custom branding | Mature — `shareLink.ts` is the single largest model (27 KB)            | ✅ High value — this is a compliance story for LGPD                                                                                  |
| View tracking: per-page time, page-by-page heatmap, return-visit detection, download tracking, 30-min dedup                | Mature — `linkView.ts` 16 KB                                           | ⚠️ Repurposable as a **delivery log / proof-of-receipt**, but the sales framing ("engagement score", "drop-off") is dead weight here |
| **Engagement score** (weighted: 30% time / 30% pages / 20% visits / 20% download)                                          | Mature, and our most differentiated IP                                 | ❌ Near-worthless to this buyer. An accountant does not care that a client read 60% of the balancete                                 |
| AI: auto-summary, viewer RAG chat, analytics insights, drop-off suggestions, **follow-up-email drafts**                    | Shipped, BYO-key                                                       | ⚠️ Follow-up-email model is the hidden gem (see §3). BYO-key is a blocker (§5)                                                       |
| Team workspaces: multi-user, roles (owner/editor/viewer), invite-by-email                                                  | Shipped                                                                | ⚠️ Bones for multi-tenancy exist; semantics are "one team", not "one firm + N client companies"                                      |
| Data rooms: N documents → one named collection → one link, per-document `allow_download`                                   | Shipped — `dataRoomLink.ts` 19 KB                                      | ✅ Closest existing thing to a "client folder"; framed for M&A/fundraising, not monthly accounting                                   |
| Monetization: Stripe (BRL), Free/Pro/Business, per-workspace plan gating                                                   | Shipped, not live-launched                                             | ✅ Billing rails are done; pricing/packaging would change                                                                            |
| Localization                                                                                                               | Product is pt-BR, Brazil-first, BRL billing, PIX/boleto one click away | ✅ Removes the barrier most US tools hit selling into Brazil                                                                         |

**One-line summary of the product:** a pt-BR DocSend/Papermark clone — "send a
document, see what happens after" — with unusually good gating/compliance
primitives and a sales-oriented analytics layer.

---

## 2. What an accounting-firm document product actually needs

The buyer is a small-to-mid escritório de contabilidade (roughly 10–300 client
companies). Their document problem, in their words, is some mix of:

1. **"I chase clients every month for the same documents."** Notas fiscais,
   extratos bancários, folha, movimento do mês — per client, per competência.
   Today: WhatsApp + email + a shared Drive folder, manually reconciled.
2. **"I need to prove I delivered the guia before the vencimento."** DAS, DARF,
   GPS, FGTS, plus obrigações acessórias. A dispute six months later is "you
   never sent me that" vs. no evidence.
3. **"Everything arrives as a mess and I have to sort it by client and month."**
4. **"LGPD makes the WhatsApp/email habit a liability"** — client financial and
   personal data flowing through channels with no access control or audit trail.

What that implies the product must have — and Papershare **does not** today:

| Need                                                                                       | Papershare gap                                                                                                                     | Effort to close                                                                         |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Two-way exchange** — clients upload _to_ the accountant                                  | The entire model is one-directional (owner shares out; viewer views/downloads). No upload-from-recipient anywhere in the 43 routes | **Large** — new ingestion flow, storage quota model, virus/type scanning, notifications |
| **Client login** (not a tokenised link) so a client sees only their folder over time       | Public access is anonymous token links; "recipients" are not accounts                                                              | Medium — workspaces/roles can be bent toward it                                         |
| **Organise by client × competência**, not by "document" + "link"                           | Documents are a flat per-workspace list                                                                                            | Medium — new hierarchy, but additive                                                    |
| **Recurring request checklists** ("these 8 docs, competência 08/2025") with auto-reminders | Nothing recurring; links are one-shot artefacts                                                                                    | Medium — **and this is where the follow-up-email engine earns its keep** (§3)           |
| **Delivery receipts** framed as compliance evidence (timestamp + audit log, exportable)    | View tracking exists but is framed as marketing analytics                                                                          | **Small** — mostly re-labelling + an export                                             |
| Obrigações/deadline calendar                                                               | None                                                                                                                               | Large — or partner/integrate                                                            |
| Integrations: import from Domínio/Onvio/Acessórias, read NF-e XML, GED                     | None                                                                                                                               | Large — table stakes for displacing an incumbent, not for a wedge                       |
| Scale: a 200-client firm moves thousands of docs/month; bulk everything                    | UI built for a founder sharing a deck with 10 investors                                                                            | Medium–large UX rework                                                                  |

---

## 3. The one genuine strategic asset for this vertical

`models/followupEmail.ts` + the engagement data pipeline were built to answer
_"what should the sender say next to a warm lead?"_. Repointed, the exact same
machinery answers _"which clients haven't sent which documents this month, and
what's the nudge?"_ — the #1 stated pain in §2.

That is not a coincidence to wave at; it's the reason this vertical is even
worth considering. The "content intelligence / know what to do next" bet in
Phase 8 transfers cleanly to "collections intelligence for document requests."
Everything else in the analytics engine (score, heatmaps, drop-off) does not
transfer and should be treated as sunk cost, not as a head start.

---

## 4. Market reality check

**In favour:**

- Large, well-defined TAM: ~70–90k accounting firms in Brazil, CRC-registered,
  reachable through Fenacon/Sescon channels and a dense creator/education scene.
- Firms already buy software and renew it — vertical SaaS churns less than a
  horizontal sales tool.
- LGPD is a real, current forcing function for the compliance framing.
- pt-BR + BRL + PIX/boleto: we're native where US tools are not.

**Against:**

- **The client-portal category is occupied and often bundled.** Acessórias,
  Onvio (Thomson Reuters), Nibo, Contlabs, plus the digital-first firms
  (Contabilizei, Agilize) that ship their own portal. Displacing a point
  solution the incumbent already bundles with the fiscal/ERP suite is hard.
- **We have zero design partners and no domain-insider signal.** Vertical SaaS
  is won on nuance you only get from ~10 deep customer conversations. Building
  first and validating later is the classic vertical-pivot failure.
- **Sunk-cost framing risk:** "we have doc sharing + we have analytics +
  accountants share docs → small leap." The leap is small only if you ignore
  that the needed 70% is the part we haven't built (two-way, recurring,
  client accounts, hierarchy) and the built part we'd lean on (analytics) is
  the part they don't want.
- Solo builder. A vertical bet multiplies the need for either a domain
  co-founder or a very tight validation loop.

---

## 5. Two things that must change regardless of how far we go

1. **BYO Anthropic key is incompatible with this buyer.** An accountant will
   not paste an API key. If AI stays in the product for this segment, it has to
   be platform-provided, which changes unit economics (per-tenant AI cost,
   needs a cap/metering — `aiUsage.ts` already has the shape for it).
2. **Pricing/packaging would be rebuilt.** "R$29 Pro / R$99 Business" is
   founder-tool pricing. An accounting-firm product is priced per client
   company or per seat, in a R$200–2,000/mo band, and sold, not
   self-serve-only.

---

## 6. Options

### Option A — Vertical wedge on the current core _(recommended path to test)_

Reposition as **"a troca segura de documentos entre o escritório e o cliente,
com trilha de auditoria"** for professional-services firms (accountants first,
lawyers/consultants adjacent). Build only the wedge:

- Client login (bend workspaces/roles: workspace = firm, add a `client`
  membership scoped to a folder).
- Per-client **monthly request checklist** + automated reminders (repoint
  `followupEmail.ts` + reminders scheduler).
- **Delivery receipts**: relabel view/download tracking as a compliance log,
  add PDF/CSV export.
- Two-way upload (the one genuinely large build — but scoped to "client
  uploads into a named request slot", not a general DMS).

Reuse as-is: auth, storage, share links + gating (now "compliance controls"),
NDA/consent gate, Stripe rails, pt-BR everything.
Drop from the pitch: engagement score, heatmaps, drop-off insights.

**Cost:** ~1 quarter to a sellable v1, _after_ validation.
**Risk:** medium. **Reversible:** yes — the wedge is still a usable horizontal
tool if the vertical doesn't convert.

### Option B — Stay horizontal, use "contadores" as one acquisition lane

No product change. A landing page, templates, and a case study aimed at
accountants who need to send documents to _their_ clients (relatórios,
demonstrativos, guias) and know they arrived. Lowest cost, lowest ceiling,
and the horizontal space is crowded and dominated (DocSend, Papermark —
also open source —, Google, Notion).

### Option C — Full pivot / re-platform

Rebuild around client × competência × obrigações, two-way ingestion, and
fiscal integrations. This is a new company's worth of product walking into
Acessórias/Onvio's market. **Only** with 3+ paying design partners and
ideally a domain co-founder. Not now.

---

## 7. Recommendation

1. **Do not start pivot code.** Run a **4–6 week validation sprint**:
   - 8–12 structured interviews with small/mid accounting firms. Do **not**
     demo first. Ask what they use to exchange documents with clients, what
     breaks, what a fix is worth per month.
   - Classify the dominant pain: **"chasing clients for missing docs"**
     (→ our follow-up engine is a real edge, pursue Option A) vs.
     **"organising what we receive"** (→ it's a GED/DMS play, Papershare is
     the wrong foundation, stay Option B).
   - Success bar to proceed to Option A: **≥3 firms say a specific price and
     agree to a paid pilot.**
2. **In parallel, near-zero-cost:** ship the Option B landing lane. It costs a
   page and tells us if the channel has any pull at all.
3. **Revisit in 6 weeks** with interview data. If the bar isn't met, the honest
   answer is "Papershare stays a horizontal document-tracking tool and
   accountants are a marketing segment, not a pivot."

**Why this is the right altitude:** the pivot question is really a bet on one
asset (the follow-up/collections engine) being worth more in a vertical than
the analytics engine is worth horizontally. That's plausible — but it's an
empirical question about a buyer we haven't talked to, and it's cheap to
answer before it's expensive to build.

---

## Appendix — code-level notes for whoever picks this up

- `models/followupEmail.ts` (4 KB) + `models/linkView.ts#getPageBreakdown*` —
  the machinery to repoint for "missing documents" nudges.
- `models/workspace.ts` (14 KB) already has role + membership tables
  (`workspace_members`, migration 025). A `client` role scoped to a folder is
  additive, not a rewrite.
- `models/dataRoom.ts` / `dataRoomLink.ts` — a data room is structurally "a
  named folder of documents with one access surface." Closest starting point
  for "client folder"; the framing and the per-recipient gap (noted in TODO
  Phase 9) are the work.
- `aiUsage.ts` (migration 020) — per-user AI metering already exists; it's the
  hook for platform-provided (non-BYO) AI with a per-tenant cap.
- No upload-from-recipient path exists in `pages/api/v1/**`. This is the single
  biggest greenfield build for any version of the vertical.
- `infra/stripe.ts` + `models/subscription.ts` — billing is per-workspace and
  webhook-driven; re-packaging to per-client-company pricing is a
  `PLAN_LIMITS` + Price-object change, not a rails change.
