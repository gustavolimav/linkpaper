# Where Papershare fits best in the market, and who the buyer is

**Author:** PO / product strategy
**Date:** 2026-08-31
**Status:** Analysis for discussion. Companion to
`2026-08-31-accounting-vertical-analysis.md` — that one answered "should we go
vertical into accounting?" (no). This one answers the prior question: given what
we've actually built, **what is this product's best-fit position, and who is the
target audience?**

**TL;DR:** Papershare is a pt-BR, Brazil-native DocSend. Its best fit is
**"document intelligence for documents that need to produce a reply"** —
decks, proposals, contracts — sold self-serve to **Brazilian founders raising a
round (beachhead)** and **small B2B sales teams at Brazilian SMBs and agencies
(expansion)**. That is the one position where every constraint we have (solo
builder, no capital, pt-BR, OSS, analytics-heavy) turns into an advantage
instead of a liability. It is explicitly **not** a fit for enterprise M&A,
compliance/archival exchange, or the US/global horizontal market.

---

## 1. What the product is, stated without ambition

A **pt-BR, Brazil-first clone of DocSend / Papermark**:

- Configurable secure links: password, expiry, revocation, NDA/consent gate,
  email allow-list, watermark, per-link branding, OG preview cards.
- Deep viewer analytics: per-page dwell time, page-by-page heatmap,
  return-visit detection, download tracking, a composite **engagement score**,
  plus an AI layer that turns that data into **"who to follow up with and what
  to say"** (analytics insights, drop-off suggestions, follow-up-email drafts).
- **Data rooms**: many documents → one named collection → one gated link, with
  per-document download control.
- Team workspaces (roles, invites). Stripe billing in BRL, per-workspace plan
  gating, PIX/boleto one click away. MIT open source.

The differentiated part is not the sharing — it's the **engagement +
what-to-do-next layer**. Any positioning that doesn't put that to work is
leaving the only moat on the table.

---

## 2. The category's proven wedges, scored against our constraints

DocSend-style tools historically win in five places. Our real constraints —
**solo builder, no capital, no sales team, no customers, pt-BR, OSS** — score
them very differently:

| Wedge                                                                                           | $ / willingness to pay      | Fit with our constraints                                                                                                                            | Verdict                      |
| ----------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **Fundraising** — founders sending decks to investors, tracking engagement, timing follow-ups   | Modest, episodic            | **High.** Self-serve, viral inside cohorts, cheap to reach, and DocSend is absent/unlocalized in Brazil. Uses our analytics + follow-up IP directly | **Beachhead**                |
| **Sales collateral / proposals** — reps sending proposals, following up on opens                | High, recurring, seat-based | **Medium-high.** Recurring revenue, low churn, but more competition (PandaDoc has PT, local proposal tools) and needs some sales motion             | **Expansion**                |
| **Agencies / consultants** — sending deliverables, reports, SOWs with a branded, tracked portal | Medium, recurring           | **Medium.** Same channels and mechanics as sales; branding + data rooms fit well                                                                    | **Segment within expansion** |
| **M&A / due diligence (serious end)** — bankers, PE, corp dev                                   | Very high                   | **Low.** Needs SOC2, SSO, granular per-user permissions, redaction, Q&A workflow, staffed support. Not a solo-builder product                       | **Out**                      |
| **Compliance / archival exchange** — accountants, legal records, regulated back-office          | Medium, sticky              | **Low.** Model is backwards (two-way ingest), analytics IP is wasted, category is bundled by incumbents (see the accounting analysis)               | **Out**                      |

---

## 3. Why Brazil-native + self-serve is the actual moat

- **DocSend is effectively not in Brazil.** No pt-BR product/support, no BRL
  billing, deck-tracking framing only, priced in USD. A Brazilian founder today
  uses a Google Drive link (zero visibility) or wrestles with DocSend's free
  tier. That is an unserved gap, not a contested one.
- **Papermark** (the OSS comparable) is global/English-first. It will not
  prioritise pt-BR onboarding, BRL/PIX billing, or the LatAm fundraising
  context. The niche is defensible precisely because it is too small and too
  local for DocSend or Papermark to chase.
- **Brazilian CRMs** (RD Station, Pipedrive, Agendor) track the _deal_, not the
  _document_. "What happened after I sent the proposal" is a real seam next to
  them — and a partnership/integration surface later.
- **OSS is top-of-funnel, not the business.** GitHub presence + self-host
  option earns trust with privacy-conscious and technical early users; revenue
  comes from the hosted product. Keep the free tier generous for this reason.

Every one of our "weaknesses" (small, local, solo, analytics-obsessed) is an
asset in this one position and a liability in every other.

---

## 4. Target audience

### ICP 1 — Beachhead: Brazilian founders actively raising a round

- **Who:** pre-seed to Series A founders, sending a deck to 20–60
  investors over 6–12 weeks. Often technical, community-connected, English-
  comfortable but working day-to-day in Portuguese.
- **Job to be done:** "Know which investors are engaged, when a deck is being
  forwarded, and who to chase on Monday — so I run a tight process instead of
  guessing."
- **Why we win:** pt-BR, BRL, data room ready for the due-diligence phase
  (already built), and engagement score → follow-up-email suggestion answers
  _exactly_ the founder's weekly question. DocSend's founding use case,
  re-served locally.
- **Reach (near-zero CAC):** accelerators and programs (ACE, Bossa Invest,
  Canary/Norte portfolio founders, YC LatAm cohorts), angel groups (Anjos do
  Brasil, GVAngels), "estou captando" LinkedIn/Twitter in PT, founder
  WhatsApp/Slack communities. Offer free Pro during the raise for feedback + a
  logo.
- **Economics:** low LTV per user (they churn after the raise), but CAC is
  near zero and word-of-mouth inside a cohort is strong. Alumni refer the next
  cohort; some expand into the sales use case as the company grows.
- **Risk:** episodic usage. Mitigated by (a) the expansion path to ICP 2 built
  into the same account, (b) treating each raise as a renewable event.

### ICP 2 — Expansion: small B2B sales teams (2–15 reps) at Brazilian SMBs and agencies

- **Who:** commercial teams sending proposals, commercial one-pagers,
  contracts. Agencies/consultancies sending deliverables and SOWs.
- **Job to be done:** "I sent the proposal and the client went quiet — tell me
  who actually opened it, what they read, and draft the nudge."
- **Why we win:** engagement tracking + AI follow-up draft + per-link branding,
  positioned as the layer _after_ the CRM. Seat-based pricing, recurring, lower
  churn than founders.
- **Reach:** same PT sales communities, RD Station/Pipedrive user groups,
  agency networks; content on "o que fazer depois de enviar a proposta."
- **Economics:** R$40–80/seat/mo, annual option, the real LTV engine.

### Secondary segment — agencies & consultants delivering client work

Not a separate product: a marketing lane and a few branding/data-room polish
items. Same channels as ICP 2.

### Who is explicitly not the audience

Enterprise / regulated M&A; compliance and records exchange (accountants,
legal back-office); e-signature buyers (that is Clicksign/ZapSign/DocuSign — a
different job); and the US/global horizontal market (DocSend + Papermark +
Notion, no moat, no capital).

---

## 5. Positioning statement

> Para **founders e times de vendas brasileiros** que enviam documentos que
> precisam gerar uma resposta — deck, proposta, contrato — o **Papershare**
> mostra **quem engajou e o que dizer a seguir**, em português, com cobrança em
> real e uma data room pronta para due diligence.
> Diferente do **Google Drive** (nenhuma visibilidade) e do **DocSend** (sem
> Brasil, sem real, só deck), a gente une o rastreio de engajamento com a
> sugestão de follow-up.

Category line: **"inteligência de documentos comerciais"** — not "compartilhamento
de documentos" (too generic, invites the Drive comparison we lose on price).

---

## 6. Implications for what we've built

| Area                                                 | Implication                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Homepage / onboarding**                            | Currently a feature showcase across Phases 3–9. Rebuild around **one** use case (fundraising) with a single activation path: upload deck → tracked link → first view → first follow-up suggestion. That sequence is the aha; instrument it. |
| **Engagement score & AI follow-up**                  | This is the moat. Make it the headline, not a deep-menu feature. A "raise dashboard" (all investors, engagement, last activity, suggested next action) is the missing view ICP 1 needs.                                                     |
| **Data rooms**                                       | Reframe from "M&A/fundraising collection" to "the due-diligence folder you send once an investor leans in." Already built; needs framing and a lighter create flow.                                                                         |
| **BYO Anthropic key**                                | Acceptable for a technical founder audience _today_; becomes a conversion tax as ICP 2 grows. Plan a platform-key tier with metering (`aiUsage.ts` already has the shape).                                                                  |
| **Pricing**                                          | Free/Pro/Business at R$29/R$99 is roughly right for ICP 1. Add seat-based Business + annual for ICP 2. Keep Free generous — it is the OSS/word-of-mouth funnel.                                                                             |
| **Workspaces**                                       | Fine as-is for both ICPs (a founder's cap-table helpers; a sales team). No change needed.                                                                                                                                                   |
| **Compliance features (NDA, allow-list, watermark)** | Keep as Pro hooks; they matter for the due-diligence moment in ICP 1 and for agencies. Do not build the roadmap around them.                                                                                                                |

---

## 7. Recommendation

1. **Adopt the position:** Brazil-native document intelligence for
   commercial/fundraising documents. Stop describing the product as
   "compartilhamento e análise de documentos."
2. **Aim the next 90 days at ICP 1** (founders raising): rewrite homepage +
   onboarding for that one use case, ship the "raise dashboard" view, and do
   manual distribution through 10 accelerators / founder communities with a
   free-Pro-during-your-raise offer.
3. **Watch one metric:** of the founders who land, how many keep an active
   paid workspace 60+ days after their raise closes, using it for sales. That
   number tells you whether ICP 2 is a real expansion or whether the business
   is a low-LTV founder tool that needs a different plan.
4. **Do not** spread onto accounting, legal records, e-signature, or a global
   English launch until ICP 1 activation and ICP 2 expansion are both proven.
