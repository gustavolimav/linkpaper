# Papershare — Product & Engineering Roadmap

> Maintained jointly by PO and TL. Each phase builds on the previous one.
> Phases are ordered by value delivery. Items within a phase are ordered by priority.

---

## Status

| Phase | Name                               | Status                                                                   |
| ----- | ---------------------------------- | ------------------------------------------------------------------------ |
| 1     | Foundation                         | ✅ Done                                                                  |
| 2     | Authorization & Account Management | ✅ Done                                                                  |
| 3     | Documents Core                     | ✅ Done                                                                  |
| 4     | Share Links                        | ✅ Done                                                                  |
| 5     | Analytics & Tracking               | ✅ Done                                                                  |
| 6     | Frontend                           | ✅ Done                                                                  |
| 7     | Engagement, Trust & Growth         | ✅ Done                                                                  |
| 8     | AI Features                        | ✅ Done                                                                  |
| 9     | Team Workspaces & Data Rooms       | ✅ Done (US-55 data rooms shipped; custom domain per workspace deferred) |
| 10    | Monetization                       | ✅ Done                                                                  |
| 11    | Visual Identity & UI Redesign      | ✅ Done (US-39–51 all shipped; US-39/47 on `main`, remainder on PR)      |
| 12    | Activity Feed                      | ⏳ Views/link-creation/revisits done; NDA/blocked-download deferred      |
| 13    | Global Links Inventory             | ✅ Done                                                                  |
| 14    | Contacts / Viewer Directory        | ✅ Done                                                                  |

---

## Phase 1 — Foundation ✅

Core authentication infrastructure. All items delivered.

- [x] User registration (`POST /api/v1/users`)
- [x] Login with session cookie (`POST /api/v1/sessions`)
- [x] Session validation middleware (`infra/auth.ts`)
- [x] Authenticated user profile (`GET /api/v1/users/[username]`)
- [x] User profile update (`PATCH /api/v1/users/[username]`)
- [x] Database migrations system
- [x] Custom error classes with HTTP status mapping
- [x] Integration test suite

---

## Phase 2 — Authorization & Account Management ✅

**Goal:** Users can only manage their own resources. Provide complete session lifecycle.

### API

- [x] `DELETE /api/v1/sessions` — Logout (delete session, clear cookie)
- [x] Authorization guard: `PATCH /api/v1/users/[username]` must verify `req.user.username === params.username`
- [x] `DELETE /api/v1/users/[username]` — Soft-delete account (add `deleted_at` column)

### Model

- [x] `session.deleteByUserId(userId)` — Invalidate all sessions on account deletion
- [x] Add `ForbiddenError` (403) to `infra/errors.ts` for authorization failures

### Infrastructure

- [x] Rate limiting middleware (protect login and registration endpoints)
- [x] Input validation with Zod (replace ad-hoc validation in models)
- [x] Database connection pool (replace single-connection pattern in `infra/database.ts`)

### Tests

- [x] Logout flow: session deleted, cookie cleared, subsequent requests return 401
- [x] Forbidden: user A cannot PATCH user B's profile
- [x] Account deletion: user gone, sessions invalidated

### Password Recovery

- [x] `POST /api/v1/password-reset` — request a reset link by email; always
      `204` regardless of whether the email is registered (no enumeration),
      rate-limited. `password_reset_tokens` migration (`031`) +
      `models/passwordReset.ts`, same hashed-token-at-rest shape as `sessions`.
- [x] `PATCH /api/v1/password-reset/[token]` — consume the (single-use,
      1-hour) token, set a new password via `models/user.ts#resetPassword`,
      then invalidate every existing session for that user.
- [x] `/forgot-password` and `/reset-password/[token]` frontend pages;
      "Esqueceu sua senha?" link on the login form.

---

## Phase 3 — Documents Core ✅

**Goal:** Users can upload, manage, and retrieve documents. This is the core product.

### Database

- [x] Migration: `documents` table (`infra/migrations/005-create-documents.sql`)
  ```sql
  id, title, description, original_filename, storage_key,
  mime_type, size_bytes, page_count, user_id,
  created_at, updated_at, deleted_at
  ```
  `size_bytes` is `INTEGER`, not `BIGINT` — max upload size is capped well under
  2GB, and `pg` returns `BIGINT`/`int8` columns as strings (precision safety),
  which would have leaked into the API response as a string instead of a number.

### Storage

- [x] Storage adapter (`infra/storage.ts`), S3-compatible (`@aws-sdk/client-s3`)
      backed by MinIO locally (`infra/compose.yaml`) and AWS S3 / Cloudflare R2 in
      production — same code path in both, only env vars differ. Local filesystem
      storage was considered and rejected (see `US-P3-02`): it doesn't survive
      serverless/ephemeral deploy targets like Vercel Preview Deployments.
- [x] File type validation (PDF, DOCX, PPTX only) — `infra/schemas.ts#ALLOWED_MIME_TYPES`
- [x] File size limit (configurable via `MAX_FILE_SIZE_MB`, default 50; set to 2 in `.env.development`)

### API

- [x] `POST /api/v1/documents` — Upload document (multipart/form-data via `formidable`)
- [x] `GET /api/v1/documents` — List authenticated user's documents (paginated)
- [x] `GET /api/v1/documents/[id]` — Get document metadata
- [x] `PATCH /api/v1/documents/[id]` — Update title/description
- [x] `DELETE /api/v1/documents/[id]` — Soft-delete document + storage cleanup

### Model

- [x] `models/document.ts` — CRUD + ownership validation (`ForbiddenError` on cross-user access)
- [x] PDF page count extraction on upload (`pdf-parse`'s `PDFParse#getInfo()`; `null` on failure, never throws)

### Tests

- [x] Upload, list, get, update, delete flows
- [x] Authorization: user cannot manage another user's documents (403)
- [x] Invalid file type / size / missing file or title: returns 400

---

## Phase 4 — Share Links ✅

**Goal:** Users can generate configurable sharing links for documents.

### Security decision: share link tokens are not hashed at rest

Session tokens (hardening sprint, pre-Phase-3) are hashed before storage because
the server never needs to show one back to its owner — the browser already
holds it. Share link tokens are different: `GET /api/v1/documents/[id]/links`
must keep returning the full shareable URL every time an owner lists their
links, potentially long after creation, so it can be re-copied and re-shared.
Hashing the token would make that impossible to fulfill (a hash can't be
reversed back into the original URL). So the token stays a plaintext UUID
(122 bits of entropy, matching how most products — Dropbox, Google Drive,
Notion — implement "share link" URLs), and the security budget went instead
into the parts of this feature that don't conflict with that requirement:

- `GET /api/v1/share/[token]` only accepts the optional password via the
  `X-Share-Password` header, never a query param — query strings end up in
  server/proxy access logs, browser history, and `Referer` headers
- The same endpoint is rate-limited (`infra/rate-limit.ts`, 20 req/min) since
  it's the only unauthenticated route that accepts a secret and would
  otherwise be brute-forceable
- Passwords are still bcrypt-hashed (`password_hash`), expiry and revocation
  (`is_active`) are enforced server-side, and the public response is a
  deliberately narrow shape that never includes `password_hash`,
  `storage_key`, or the document owner's `user_id`

### Database

- [x] Migration `006-create-share-links.sql`: `share_links` table
  ```sql
  id, token (UUID), document_id, user_id,
  label, password_hash, expires_at,
  allow_download, is_active,
  created_at, updated_at
  ```

### API

- [x] `POST /api/v1/documents/[id]/links` — Create share link
- [x] `GET /api/v1/documents/[id]/links` — List links for a document
- [x] `PATCH /api/v1/documents/[id]/links/[linkId]` — Update link config
- [x] `DELETE /api/v1/documents/[id]/links/[linkId]` — Revoke link (soft: `is_active = FALSE`)
- [x] `GET /api/v1/share/[token]` — Public endpoint: validates expiration, active
      status, password, and document soft-delete state; returns share link +
      document metadata. Does not yet return a viewer URL or stream file
      bytes — that's Phase 6 (frontend viewer) territory; `allow_download` is
      returned as a flag for the viewer to respect, not enforced by the API.

### Model

- [x] `models/shareLink.ts`
- [x] Password-protected links: hash on create/update, verify on access

### Tests

- [x] Link creation with/without password and expiration
- [x] Expired link returns 403
- [x] Revoked link returns 403
- [x] `allow_download: false` is reflected in the public response (enforcement is a viewer-level concern, see above)

---

## Phase 5 — Analytics & Tracking ✅

**Goal:** Document owners see engagement data for each share link.

### Database

- [x] Migration `007-create-link-views.sql`: `link_views` table (`share_link_id` FK `ON DELETE CASCADE`, `updated_at` for dedup, indexed on `share_link_id`/`created_at`/dedup composite)

### API

- [x] `POST /api/v1/share/[token]/view` — Record view event (public, no password required — the viewer page already gated on the password via the public GET endpoint)
- [x] `GET /api/v1/documents/[id]/links/[linkId]/analytics` — Analytics summary per link (total views, unique viewers, avg time on page, avg pages viewed, first/last viewed, 30-day zero-filled `views_by_day`)
- [x] `GET /api/v1/documents/[id]/analytics` — Aggregated analytics across all links, plus `top_links` (top 5 by view count)
- [ ] Page-level heatmap — deferred; `pages_viewed` is recorded per view but not yet broken down by individual page number

### Model

- [x] `models/linkView.ts` — `recordView`, `getAnalyticsByLinkId`, `getAnalyticsByDocumentId` (raw SQL, `::int`/`::float` casts so aggregates come back as numbers, not the strings `pg` returns for `bigint`/`numeric` by default — same lesson as `documents.size_bytes` in Phase 3)
- [x] `models/shareLink.ts#validateToken()` — existence/active/expiry check without the password gate, reused by view recording

### Tests

- [x] View event recorded correctly (full body, empty body, 404/403 on invalid/expired/revoked link)
- [x] Duplicate fingerprint within 30 min updates the existing row instead of inserting a new one (`SELECT ... FOR UPDATE` in a transaction on a dedicated client, not the shared pool, to close the race window)
- [x] Analytics endpoints return correct aggregations, including zero/null on no-data and `top_links` ordering/limit

---

## Phase 6 — Frontend ✅

**Goal:** Full UI on top of the existing API. No new backend work in this phase.

### Architecture decision: App Router, not Pages Router

All Phase 6 pages/components below go under `app/`, not `pages/`. Next.js treats
Pages Router as maintenance-only; starting the one large remaining chunk of
frontend work on it would mean building a dashboard-heavy UI on a legacy
foundation from day one. Reasons:

- Server Components can read the `session_id` cookie via `next/headers` and
  gate protected routes (`/dashboard`, `/documents/[id]`, `/account`) before
  render — no client-side auth-check flicker, less boilerplate than
  per-page `getServerSideProps`.
- SWR still has a role for client-side mutation/revalidation (uploads, editing
  share links) inside Client Components — it's not either/or with Server
  Components, it's Server Components for the authenticated initial fetch and
  SWR for interactive updates.
- `pages/api/v1/*` (7 route files, fully covered by integration tests) stay
  exactly as they are. Next.js supports `pages/` and `app/` side by side, so
  there is no need to rewrite working, tested API routes for zero functional
  gain. Only `pages/index.tsx` and `pages/status/index.tsx` move to
  `app/page.tsx` / `app/status/page.tsx` since they're trivial and avoid
  routing collisions once `app/` exists.

### Stack decisions made during Block 1

- **Styling:** Tailwind CSS v4 + shadcn/ui (Radix base — not the CLI's newer
  "Base UI" preset; Radix has the `asChild`/`Slot` pattern and far more
  precedent to build against reliably). 15 base components installed under
  `components/ui/`: button, input, label, card, dialog, alert-dialog,
  checkbox, textarea, badge, separator, skeleton, sonner (toast), switch,
  dropdown-menu, avatar. **Reuse these — don't recreate custom versions.**
- **Charts (US-12):** `recharts`, not yet installed — it's what shadcn/ui's
  own chart wrapper is built on, fits better than `chart.js` here.
- **Toasts:** `sonner`, already installed and mounted (`<Toaster />` in
  `app/layout.tsx`). Use `toast()` from the `sonner` package directly.
- **Auth gate pattern for protected pages:** Server Component calls
  `getServerUser()` (`lib/auth-server.ts`) and `redirect("/login")` if null,
  before any HTML renders — established by the landing page
  (`app/page.tsx`), reused for dashboard/documents/analytics/settings.
- **Route paths corrected vs. the original list below:** the public viewer
  is `/view/[token]` (matches `US-11`, not `/share/[token]`) and the
  settings page is `/settings` (matches `US-13`, not `/account`).

### Progress by block (see `user-stories/phase-6-frontend/` for full specs)

- [x] **Block 1** — `GET /api/v1/sessions`, `AuthContext` + SWR (US-06),
      shared Header/Footer + landing page (US-07). Tailwind v4 + shadcn/ui
      set up. `pages/index.tsx`/`pages/status/index.tsx` migrated to
      `app/page.tsx`/`app/status/page.tsx`; `pages/api/v1/*` untouched.
- [x] **Block 2** — Registration & login forms (US-08)
- [x] **Block 3** — Dashboard: document list + upload (US-09)
- [x] **Block 4** — Document detail page + share link manager (US-10)
- [x] **Block 5** — Public PDF viewer (US-11). Added
      `infra/storage.ts#getFile()` (S3 `GetObjectCommand`) and
      `GET /api/v1/share/[token]/file` (public, rate-limited proxy route) —
      neither existed yet; the original spec assumed a local `/uploads/`
      path that was never built (Phase 3 went S3/MinIO-only, see `US-P3-02`).
      **Gotcha:** `pdfjs-dist`'s bundled `.mjs` gets corrupted by Next's
      webpack (`TypeError: Object.defineProperty called on non-object`,
      thrown from inside the library's own module code) — fixed by loading
      both the library and its worker as native ES modules from the jsdelivr
      CDN (`import(/* webpackIgnore: true */ ...)`) instead of importing the
      npm package directly. See `components/viewer/PDFViewer.tsx`.
- [x] **Block 6** — Analytics visualization (US-12) + Account settings (US-13)

### Infrastructure

- [x] Deploy to Vercel (connect GitHub repo, configure env vars) — live at
      papershare.com.br as of 2026-07-15
- [ ] Set up webapp-testing skill (`anthropics/skills`) for automated UI regression tests

### Known test flakiness

- [ ] `tests/orchestrator.ts#createUser()` generates a test username via
      `faker.internet.username()`, which occasionally exceeds the
      `username varchar(30)` column limit and fails the insert
      intermittently. Bound/truncate the generated value to fit the schema.
- [ ] `tests/e2e/` (Playwright, added alongside US-37) runs against `next
dev`, which occasionally serves a corrupted chunk under rapid
      automated navigation — a page-crashing `SyntaxError` unrelated to
      application code. `playwright.config.ts` sets `retries: 2` to absorb
      it. Switching `npm run test:e2e` to `next build && next start` would
      remove the root cause entirely, but needs `.env.development` loaded
      under Next's production-mode env-file convention (`.env`/
      `.env.production`, not `.env.development`) — deferred rather than
      renaming/duplicating the project's env file for this alone.

---

## Phase 7 — Engagement, Trust & Growth ✅

**Goal:** Close the feature gap against the direct competitive set (DocSend,
Papermark, PandaDoc) with the specific capabilities that come up as their
headline differentiators, before investing further in AI or monetization —
these are comparatively low-effort, high-signal wins that also make the
later phases more valuable (better data for AI insights, more to gate
behind a paid plan). Researched 2026-07-15; sources: DocSend/PandaDoc/Papermark
comparisons on papermark.com and digify.com, and 2026 sales-enablement/
e-signature trend coverage (Gartner DSR prediction via heyiris.ai, AI
engagement scoring via cirrusinsight.com).

### Real-time engagement (the single biggest gap vs. the competitive set)

- [x] Email notification to the document owner when a share link is opened
      by a new viewer, mirroring Papermark's "new document notifications".
      `infra/mailer.ts` (Resend, no-op without `RESEND_API_KEY` or in
      `NODE_ENV=test`, matching `infra/storage.ts`'s existing pattern);
      `models/linkView.ts#recordView()` now detects a genuinely new viewer
      (no prior row for that fingerprint on this link, at any time — not
      just outside the 30-min dedup window) and returns `is_new_viewer` on
      the `POST /api/v1/share/[token]/view` response;
      `models/shareLink.ts#getNotificationInfo()` looks up the
      owner/document/link for the email. Fire-and-forget from the route
      handler so a mailer failure never affects the response to the
      anonymous viewer.
- [x] Per-link toggle to mute notifications (not every link is high-stakes).
      Migration `008-add-notify-on-view-to-share-links.sql` adds
      `notify_on_view BOOLEAN NOT NULL DEFAULT TRUE`; exposed on
      create/update (`ShareLinkCreateInput`/`ShareLinkUpdateInput`) and
      checked in the view-recording route before the fire-and-forget
      email. `Switch` in both `CreateShareLinkModal.tsx` and
      `EditShareLinkModal.tsx`, matching the existing `is_active` pattern.
- [x] Per-page time-on-page tracking (not just an aggregate per view) —
      literally DocSend's headline differentiator ("page-level heatmaps
      remain the gold standard" for this category). Migration
      `009-create-link-view-pages.sql` adds `link_view_pages`
      (`link_view_id`, `page_number`, `time_on_page_seconds`, unique on
      `(link_view_id, page_number)` — repeat reports for the same
      view+page accumulate via `ON CONFLICT ... DO UPDATE`, never
      overwrite). `ViewerPage.tsx` tracks per-page dwell time client-side
      (closes out the previous page's timer on every `onPageChange`, plus
      once more on `beforeunload`) and includes it as `page_times` in the
      same `sendBeacon` payload already used for the aggregate
      `time_on_page`. `GET /api/v1/documents/[id]/links/[linkId]/analytics`
      now returns `page_breakdown` (avg time + view count per page number),
      rendered as a bar chart (`PageHeatmapChart.tsx`, recharts) in
      `LinkAnalyticsDrawer.tsx` — per-link only, since a page-by-page
      breakdown doesn't aggregate meaningfully across a document's
      different links. Verified end-to-end in-browser with a 3-page PDF
      (real per-page times matched the chart and tooltip exactly), plus
      130/130 integration tests passing.
- [x] Composite engagement score per viewer (weighted blend of time on
      page, % of pages viewed, return visits, download) surfaced in the
      analytics dashboard — 2026 market trend is scoring viewer interest
      as a single signal instead of raw time-on-page, so sales/investor
      relations teams know who to follow up with first. Migration `018`
      adds `link_views.downloaded`; new per-viewer list in
      `LinkAnalyticsDrawer.tsx` sorted by score. See CHANGELOG for details.

### Trust & access control (needed to compete for data-room / high-stakes use cases)

- [x] Optional NDA/consent gate per share link — viewer must accept a
      custom NDA text and provide name + email before the document loads.
      Migrations `016`/`017` add `share_links.nda_text` +
      `link_views.viewer_name`; enforced last in the gating pipeline,
      independent of the allow-list so both can coexist on the same link.
      NDA text served pre-credential via a new permission-free
      `GET /api/v1/share/[token]/nda` endpoint. See CHANGELOG for details.
- [x] Optional "require email" per share link (today viewing is anonymous
      by fingerprint only) — also what makes the notification feature above
      actually name the viewer. Migrations `011`/`012` add
      `share_links.require_email` + `link_views.viewer_email`; gated via a
      new `X-Viewer-Email` header, checked after the password gate. See
      CHANGELOG for details.
- [x] Dynamic watermark overlay (viewer email + timestamp burned into the
      PDF canvas render) — deters leaking a "confidential" document,
      standard in every data-room competitor. Migration `014` adds
      `share_links.watermark_enabled`; enabling it implies email is
      required, same as the allow-list. See CHANGELOG for details.
- [x] Email allow-list per share link — only pre-approved addresses can
      unlock it, even with the correct password. Migration `013` adds
      `share_link_allowed_emails`; presence of a list implies email is
      required regardless of the `require_email` toggle. See CHANGELOG
      for details.

### Growth / perceived polish

- [x] Open Graph meta tags on public share/view pages so links render as
      a proper preview card in Slack/iMessage/Twitter instead of a bare URL.
      `app/view/[token]/page.tsx` gained `generateMetadata()`; document
      title/description shown even for gated links (title not leaked only
      for revoked/expired/deleted/nonexistent ones). See CHANGELOG for
      details.
- [x] "Duplicate settings" when creating a new share link from an existing
      one (password/expiry/branding), reducing friction for repeat senders.
      New "Duplicar" button on `ShareLinkCard.tsx` opens `CreateShareLinkModal`
      pre-filled from the source link; password can't be carried over (only
      its hash is ever available) so that field starts blank. See CHANGELOG
      for details.
- [x] Custom branding per share link (accent color, welcome message)
      — cheap to build now, becomes a paid-tier hook in Phase 10. Migration
      `015` adds `share_links.brand_accent_color` + `brand_welcome_message`;
      applied only on the "ready" viewer state, not the gate screens. Logo
      upload deferred — out of scope for this pass. See CHANGELOG for details.

---

## Phase 8 — AI Features ✅

**Goal:** Add AI-powered value on top of existing data.

> **Tools to evaluate:** Flowise (drag-and-drop agent builder, fast prototyping) or LangChain (full control, better for RAG pipelines over user documents). Ended up needing neither — a thin shared Anthropic client wrapper (`infra/ai.ts`) was enough for all six stories.

- [x] Auto-summarization on upload (extract text → Claude API → store summary).
      Migration `019` adds `documents.ai_summary`/`ai_summary_generated_at`;
      fire-and-forget after upload, PDF-only extraction for this pass. See
      CHANGELOG for details.
- [x] `GET /api/v1/documents/[id]/summary` — Return AI summary. `POST` to the
      same route regenerates synchronously, rate-limited to 3/hour per user.
      See CHANGELOG for details.
- [x] "Ask about this document" chat interface on the viewer page (RAG).
      `POST /api/v1/share/[token]/chat`, SSE streaming, keyword-based
      retrieval over per-page chunks (migration `022`) — no vector DB for
      this MVP. See CHANGELOG for details.
- [x] Analytics insights: natural language summary of engagement ("Most
      viewers drop off at page 4"). Cached on the document row (migration
      `021`), regenerated only when the underlying analytics change. See
      CHANGELOG for details.
- [x] Improvement suggestions based on engagement drop-off data. Uses real
      per-page data aggregated across a document's links
      (`getPageBreakdownByDocumentId`) rather than the `avg_pages_viewed`
      estimate originally scoped here — Phase 7's per-page tracking landed
      after this item was written, so the more precise version was cheap to
      build instead. See CHANGELOG for details.
- [x] AI-drafted follow-up email suggestion for the document owner, based on
      a viewer's engagement score and the page they dropped off at (depends
      on Phase 7's per-page tracking + engagement score) — matches the 2026
      "content intelligence" trend: knowing what to say next, not just what
      was viewed. Spec written this session as
      `user-stories/phase-7-ai/US-27-followup-email-suggestion.md`. See
      CHANGELOG for details.

---

## Phase 9 — Team Workspaces & Data Rooms ✅

**Goal:** Move beyond single-user accounts toward the collaborative,
multi-document product shape that DocSend/Papermark call a "data room" —
the recognized format for M&A, fundraising, and due-diligence sharing
(a growing, high-willingness-to-pay niche). This is a bigger structural
change than Phase 7/8 (touches the ownership model throughout the app), so
it's sequenced after the lower-effort wins above.

> Design validated and detailed stories written 2026-07-16:
> `docs/plans/2026-07-16-team-workspaces-design.md` (key decisions +
> rationale) and `user-stories/phase-9-workspaces/US-28` through `US-33`
> (implementation-ready specs). The first slice ("workspaces básico") is
> scoped below; data rooms and custom domain are deliberately deferred to
> a later slice of this same phase.

- [x] **Workspaces básico** — multi-user workspaces with invite, shared
      document library, and role-based permissions (owner/editor/viewer of
      the workspace itself). Every user gets an automatic personal
      workspace at registration; documents always belong to exactly one
      workspace (no more direct user ownership). Broken into 6 stories:
  - [x] US-28 — Workspace data model & migration (`workspaces`,
        `workspace_members`, `documents.workspace_id` backfill,
        `users.active_workspace_id`). See CHANGELOG for details.
  - [x] US-29 — Workspace CRUD + switching (create/list/rename/delete,
        `.../activate`). See CHANGELOG for details.
  - [x] US-30 — Member invitation & role management (invite by email —
        existing accounts only, no token/accept flow — role change,
        remove/leave, last-owner protection). See CHANGELOG for details.
  - [x] US-31 — Document & share-link authorization migrates from direct
        `user_id` ownership to workspace role checks. See CHANGELOG for
        details.
  - [x] US-32 — AI features resolve the workspace creator's key instead of
        the document uploader's. See CHANGELOG for details.
  - [x] US-33 — Frontend: header workspace switcher, workspace-creation
        modal, "Equipe" settings tab, "Enviado por" on document cards. See
        CHANGELOG for details.
- [x] **Data rooms** — US-55, group multiple documents from the same
      workspace into one named collection with a single shareable link.
      Scoped down from the original goal during implementation (confirmed
      with the user 2026-07-23): permissions are **per-document only**,
      not per-recipient — the link model has no authenticated-recipient
      concept to hang a per-recipient override on (e.g. "recipient A can
      download the term sheet but only view the cap table" would need an
      invite/login system of its own, out of scope). See CHANGELOG for
      the full implementation (new tables, models, API routes, frontend
      pages).
- [ ] Custom domain per workspace (e.g. `docs.yourcompany.com`) for
      white-labeled sharing — pairs with Phase 7's custom branding.
      Explicitly deferred out of US-55 (confirmed with the user
      2026-07-23): a real implementation needs DNS verification + SSL
      provisioning via the Vercel Domains API (`VERCEL_API_TOKEN` isn't
      configured in this project, and there's no real domain available to
      validate an end-to-end flow against in this environment) — not yet
      scoped into a story.
- [x] **Data room feature parity with single-document links** — US-55
      deliberately shipped data room links as a separate, smaller
      mechanism than `share_links` (password/expiry/revocation only).
      Seven follow-up stories written 2026-07-23, all implemented the
      same day. See CHANGELOG for the full implementation.
  - [x] US-56 — View analytics
  - [x] US-57 — Access control: require email + per-email allow-list
  - [x] US-58 — NDA gate
  - [x] US-59 — View notifications
  - [x] US-60 — Watermarking (reuses the existing client-side canvas
        mechanism as-is)
  - [x] US-61 — Custom branding (accent color + welcome message)
  - [x] US-62 — AI viewer chat, scoped to one document at a time (not
        whole-room retrieval — that would be its own, bigger story)

---

## Phase 10 — Monetization ⏳

**Goal:** Gate premium features behind a paid plan, scoped per workspace
(not per user) since documents/links already belong to `workspace_id`
since Phase 9.

> Design validated with the user 2026-07-17:
> `docs/plans/2026-07-17-monetization-design.md` (key decisions +
> rationale) and `user-stories/phase-10-monetization/US-35` through
> `US-38` (implementation-ready specs).

> **Tools:** Stripe for subscriptions (Checkout + Customer Portal, BRL). Real billing launch, not just infrastructure — no grandfathering needed since there are no paying users yet.

- [x] US-35 — Billing infrastructure: `subscriptions` table
      (`workspace_id`-scoped), `infra/stripe.ts`, `models/subscription.ts`,
      checkout/portal endpoints, signed webhook handler. See CHANGELOG for
      details.
- [x] US-36 — Plan gating: Free capped at 10 documents/10 active links;
      watermark/NDA/allow-list/branding/engagement-score become Pro-only;
      downgrades keep existing data working, just block new creation. See
      CHANGELOG for details.
- [x] US-37 — Frontend: "Faturamento" settings tab, usage display,
      upgrade/manage-subscription buttons, disabled states on
      gated fields/actions instead of dead-end submits. See CHANGELOG for
      details.
- [x] US-38 — Homepage revamp: replace the Phase-6-era 3-card grid with a
      full themed feature showcase (covering everything shipped through
      Phase 9) plus a Free/Pro/Business pricing table. See CHANGELOG for
      details.
- [x] Soft-launch safety switch: real billing isn't ready to expose to
      every user yet (see the production checklist below), so US-35–38's
      checkout/portal are gated behind a new `billing_stripe` feature flag
      (`/superadmin/feature-flags`, superadmin-only, off by default) — the
      Faturamento tab's action buttons route to `/em-breve` instead of
      calling the API until a superadmin turns it on. See CHANGELOG for
      details.

### Production checklist — before enabling `billing_stripe`

All Dashboard/Vercel setup, no code changes:

- [ ] Finish Stripe account activation in **live mode** (business details,
      bank account for payouts) — Stripe won't process real charges until
      this is done
- [ ] Create the Pro and Business Price objects in **live mode**
      (separate from the test-mode ones used in `.env.development`) —
      note the new `price_...` IDs
- [ ] Register a **live** webhook endpoint (Dashboard → Developers →
      Webhooks) at `https://<domínio>/api/v1/webhooks/stripe`, subscribed
      to at least `customer.subscription.created`/`.updated`/`.deleted`
      and `invoice.payment_failed` — copy the signing secret
- [ ] Configure the **Customer Portal** (Settings → Billing → Customer
      portal) — business info/logo, which plans customers can switch
      between, cancellation policy — the "Gerenciar assinatura" button
      needs this configured at least once
- [ ] Set `STRIPE_SECRET_KEY` (`sk_live_...`), `STRIPE_WEBHOOK_SECRET`,
      `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_BUSINESS` on Vercel's
      **Production** environment specifically (Preview can keep the
      test-mode values)
- [ ] Only then, flip `billing_stripe` on via `/superadmin/feature-flags`

**Deliberately still deferred** (not blockers for the above): Stripe
Tax/`automatic_tax` — no registration yet, enabling it without one
silently collects R$0 tax (see the Stripe follow-ups note below). Boleto
and PIX are a one-click optional add (Settings → Payment methods)
whenever wanted, no code change either way.

### Plans

- **Free** — 10 documents, 10 active share links per workspace, no
  watermark/NDA/allow-list/branding/engagement score.
- **Pro** — R$29/mês — unlimited documents/links, watermarking, NDA
  gate, email allow-list, custom branding, engagement scoring.
- **Business** — R$99/mês — everything in Pro + team workspaces (already
  built); data rooms and custom domain fold in automatically once those
  ship in a later slice, no billing rework needed then.

---

## Phase 11 — Visual Identity & UI Redesign ⏳

**Goal:** Replace the current all-neutral shadcn default theme (grayscale
only, stock Inter font, zero brand color — unchanged since Phase 6
scaffolding) with a real visual identity, applied across every existing
screen. This phase is a restyle only — no new functionality, no new
endpoints, no schema changes. New features discovered alongside this
design are scoped as their own phases below (12–14) so this phase stays
mergeable on its own and doesn't block on unrelated backend work.

> Source of truth: a Claude-generated design prototype
> (`Papershare Standalone.html`, reviewed 2026-07-20) covering the
> homepage, dashboard, document detail, analytics, activity, links,
> contacts, settings, and public-viewer/error states. Key tokens pulled
> from it: warm cream background + terracotta/rust accent (`oklch(0.58
0.16 38)`, i.e. an accent hue around 38°), `Source Serif 4` for
> headings paired with `Manrope` for body text (replacing `Inter`
> everywhere), `0.5rem`–`0.625rem` corner radii.
>
> Design validated and detailed stories written 2026-07-21:
> `docs/plans/2026-07-21-visual-identity-design.md` (key decisions +
> rationale, including the full color/typography spec) and
> `user-stories/phase-11-visual-identity/US-39` through `US-47`
> (implementation-ready specs). Sidebar nav ships with only
> Documentos/Configurações for now — Atividade/Links/Contatos are added
> by Phases 12–14 respectively, not built as placeholders here. No
> Google OAuth (the prototype's login button is decorative only).

- [x] **Design tokens** (US-39) — replace `app/globals.css`'s neutral-only
      shadcn theme with the new color system (background, accent, chart
      colors all currently grayscale) and typography (`Source Serif 4` +
      `Manrope`, replacing `next/font/google`'s `Inter`); also finishes
      the previously-half-installed dark mode wiring. See CHANGELOG.
- [x] **App shell** (US-40) — persistent left sidebar (workspace switcher +
      Documentos/Configurações nav, Atividade/Links/Contatos added when
      Phases 12–14 ship) replacing today's top-header-only nav, for every
      authenticated page — this is the shell those phases' new pages will
      live in. See CHANGELOG.
- [x] **Marketing homepage** (`/`, US-41) — restyle the US-38 feature
      sections + pricing table to the new visual language; hero
      copy/layout revamp. See CHANGELOG.
- [x] **Auth** (`/login`, `/register`) — restyle to match (US-42). See CHANGELOG.
- [x] **Dashboard** (`/dashboard`) (US-43) — document list becomes a data
      table (Nome/Visualizações/Links/Pontuação/Atualizado) with a
      per-document aggregate score column, replacing the current card
      grid; added a stat-card row (Documentos, Links ativos, Engajamento
      médio, Visualizações totais) — raw numbers only, no trend deltas
      (need historical snapshots this phase doesn't have). See CHANGELOG.
- [x] **Document detail & share-link manager** (`/documents/[id]`) (US-44) —
      restyle, no behavior change. See CHANGELOG.
- [x] **Analytics dashboard** (`/documents/[id]/analytics`, US-45) —
      restyle the heatmap, per-viewer engagement list, and AI-insight
      callout. See CHANGELOG.
- [x] **Settings** (`/settings`) (US-46) — restyle Perfil/Chave de IA/
      Equipe/Faturamento/Zona de perigo to the new visual language
      (prototype uses tab-based navigation instead of today's stacked
      sections). See CHANGELOG.
- [x] **Public-facing pages** (`/view/[token]`) (US-47) — restyled the
      viewer, the password/NDA gates, and added a "Desenvolvido com
      Papershare" footer (light product-attribution branding on pages
      seen by people who aren't Papershare customers themselves). See
      CHANGELOG.
- [x] **Error/empty states** (US-47) — restyled (expired-link page,
      404, revoked link, and other gate/error states share the new
      `ViewerCardShell`/`ViewerStateCard` pattern). See CHANGELOG.

**Story breakdown** (see `user-stories/phase-11-visual-identity/`):
US-39 (design tokens + finishing the dark-mode wiring) → US-40 (app
shell / sidebar — the one item every other page in this phase depends
on) → US-41 through US-47 (homepage, auth, dashboard, document detail,
analytics, settings, public viewer/error states — each independent of
the others once US-40 lands).

**Post-launch audit fixes** — a visual audit against the design
prototype (2026-07-21, run after PRs #33/#39/#41/#46 turned out to have
all merged into `feat/phase11-01-design-tokens` instead of `main`,
opened as PR #47) found the restyle itself matches closely once PR #47
merges. Two concrete gaps surfaced, scoped as their own stories rather
than folded into the (already-merged) originals:

- [x] **Document detail responsive fix** (US-48) — the header
      actions row and each share link's Editar/Revogar/Duplicar row
      overflow instead of wrapping at narrow viewport widths (~530–700px),
      clipping buttons off-screen. Isolated to two components; every
      other restyled page already reflows correctly at the same widths.
      See CHANGELOG.
- [x] **Superadmin as Settings subsection** (US-49) — per explicit
      request, folded Migrations + Feature Flags into Configurações as
      two more (superadmin-only) tabs, removed the separate top-level
      "Superadmin" sidebar item and the `/superadmin/*` routes. See
      CHANGELOG.

A second, deeper pass (2026-07-22, using the actual rendered prototype
side-by-side instead of just its source) found the first audit had been
too shallow — the Analytics page in particular was missing its most
visually dominant element. Fixed directly rather than re-queued as
another story, since both were small and already covered by the
existing US-45/US-43 scope:

- [x] Document-level analytics page was missing the page-attention
      heatmap the prototype shows prominently (it only rendered inside
      the per-link drawer) — wired the already-existing
      `getPageBreakdownByDocumentId` aggregation into the document
      analytics response and render `PageHeatmapChart` inline, matching
      the prototype's layout order. See CHANGELOG.
- [x] Dashboard document list was missing the "Buscar documentos..."
      search input the prototype shows in its header row — added
      client-side title filtering. See CHANGELOG.

Sidebar nav also gained three more destinations (Atividade, Links,
Contatos) as frontend-only mocks matching the prototype — see Phase
12/13/14 below for what's real vs. mocked there.

A third pass (2026-07-22, after merging PR #47) found two more concrete
IA mismatches, scoped as their own stories since both are structural
(shared components spanning two routes each) rather than one-file CSS
fixes:

- [x] **Auth tabs** (US-50) — the prototype's login/register is one
      screen with a segmented "Entrar / Criar conta" tab switcher; ours
      was two separate pages linked only by a small text link at the
      bottom. Added a shared tab switcher (real navigation between the
      existing `/login`/`/register` routes, no route merge, no behavior
      change). See CHANGELOG.
- [x] **Document detail tabs** (US-51) — the prototype's document page
      is one screen with a "Visão geral / Análises" tab bar; ours was an
      "Analytics" button linking to a separate route with its own
      breadcrumb. Added a shared tab bar (real navigation between the
      existing `/documents/[id]` and `/documents/[id]/analytics`
      routes, same route-preserving approach as US-50) —
      `tests/e2e/engagement-score.spec.ts` (which navigates directly to
      the analytics URL) re-run and still passes. See CHANGELOG.

---

## Phase 12 — Activity Feed ⏳

**Goal:** One reverse-chronological, cross-document feed of everything
happening in a workspace — views, NDA acceptances, link creation, blocked
download attempts, revisits — grouped by day (Hoje/Ontem/Esta semana), so
an owner doesn't have to open each document individually to know what
just happened. Confirmed as a genuinely new capability (doesn't exist
today) while reviewing the Phase 11 design prototype's "Atividade" page.

> 2026-07-22: `/activity` shipped as a frontend-only mock first (a nav
> item + a static, hardcoded event list matching the prototype's
> grouping/copy), then got its real backend (US-52) the same day. Scoped
> down from the original goal: views, link creation, and revisits are
> real; NDA-acceptance and blocked-download events are deferred (see
> below) since neither is persisted anywhere today.

- [x] Frontend: `/activity` page grouped by day (`components/activity/ActivityFeed.tsx`), one row per event with an icon + description matching its type. See CHANGELOG.
- [x] Aggregation query joining `link_views` and `share_links`, scoped
      to a workspace and ordered by `created_at desc` — covers views,
      link creation, and revisits (`models/activity.ts`). NDA
      acceptances and blocked-download attempts excluded: neither is
      persisted anywhere today (`nda_text` is link config, not an
      acceptance record; `allow_download` isn't enforced server-side,
      only hidden in the UI) — would need new columns/tables and, for
      blocked downloads, new server-side enforcement. Follow-up item,
      not silently dropped:
  - [ ] Persist NDA acceptance (e.g. a `link_views.nda_accepted_at`
        column, set when a viewer with `nda_text` set on their link
        submits the gate) and surface it as an activity event
  - [ ] Enforce `allow_download` server-side on the file-download route
        (today `pages/api/v1/share/[token]/file` never checks it — it's
        a client-side-only hide in `ViewerControls.tsx`) and persist a
        record of each blocked attempt to surface as an activity event
- [x] `GET /api/v1/activity` (paginated) — scoped to
      `request.user.active_workspace_id`, same trust boundary as `GET
/api/v1/documents` (no separate `requireRole` call needed). See
      CHANGELOG.
- [x] Wire `ActivityFeed` up to the real endpoint above, replacing the
      mock data. See CHANGELOG.
- [x] Depends on Phase 11's app-shell sidebar (this is one of its nav
      destinations)

---

## Phase 13 — Global Links Inventory ✅

**Goal:** One page listing every share link across every document in a
workspace — label/document/view-count/status — instead of only being able
to see a document's links from inside that document's own detail page.
Confirmed as new (today's `ShareLinkList` is always scoped to a single
document) while reviewing the prototype's "Links" page.

> 2026-07-22: `/links` shipped as a frontend-only mock first (a nav item
>
> - a static table matching the prototype's columns/copy, with a working
>   copy-link button), then got its real backend (US-53) the same day.
>   Unlike Phase 12's Activity Feed — which trusts
>   `request.user.active_workspace_id` directly — this endpoint takes a
>   workspace `id` from the URL path, so it needs an explicit
>   `workspace.requireRole()` check, same as the existing
>   `/workspaces/[id]/members` endpoint.

- [x] Frontend: `/links` page (`components/links-inventory/LinksInventory.tsx`) — table (link, document, views, status) + copy-link action per row. See CHANGELOG.
- [x] `GET /api/v1/workspaces/[id]/links` (paginated) — joins
      `share_links` → `documents`, scoped to the workspace via
      `workspace.requireRole(workspaceId, userId, "viewer")`, returning
      document title and a computed `view_count`/`status` alongside each
      link (`models/shareLink.ts#findAllByWorkspaceId`). `status` folds
      revoked and expired links into one `"expired"` value, matching the
      two-state badge the design prototype uses — the exact
      revoked-vs-expired distinction is still visible on the link's own
      document detail page. See CHANGELOG.
- [x] Wired `LinksInventory` up to the real endpoint above, replacing the
      mock data. See CHANGELOG.
- [x] Depends on Phase 11's app-shell sidebar

---

## Phase 14 — Contacts / Viewer Directory ✅

**Goal:** Turn per-link viewer analytics (Phase 5/7, currently scoped to
one link at a time) into a workspace-wide contact directory: group a
recipient's activity by email across every document/link they've
touched, showing document count, last-seen, and a blended engagement
score — plus surface the existing AI follow-up-email suggestion (US-27)
directly from this directory instead of only from a single link's
analytics view. Confirmed as new (no cross-document viewer identity
exists today — `ViewerEngagement` is always scoped to one link) while
reviewing the prototype's "Contatos" page.

> 2026-07-22: `/contacts` shipped as a frontend-only mock first (a nav
> item + a static contact list matching the prototype's layout/copy),
> then got its real backend (US-54) the same day. The engagement score
> here is a deliberately separate formula from `linkView.ts`'s per-link
> one (same weights/targets, but normalizes "% pages read" per view
> before averaging, since a contact may have viewed documents with
> different page counts) — see US-54 for why it isn't a reuse.

- [x] Frontend: `/contacts` page (`components/contacts/ContactsList.tsx`) — one row per contact — currently static mock data, not wired to a real query
- [x] Aggregation query: groups `link_views` by `viewer_email` across the
      workspace, computing distinct-document count, most recent view,
      and a blended engagement score across all their views
      (`models/contact.ts#findAllByWorkspaceId`). See CHANGELOG.
- [x] `GET /api/v1/workspaces/[id]/contacts` — new endpoint, same
      explicit `workspace.requireRole()` pattern as US-53's `/links`
      endpoint. See CHANGELOG.
- [x] Wired `ContactsList` up to the real endpoint above, replacing the
      mock data, and wired "Gerar follow-up" to the existing
      follow-up-email endpoint (US-27) using each contact's
      most-recently-viewed document/link/fingerprint. See CHANGELOG.
- [x] Known limitation, unchanged: a viewer only has an email on file if
      the link required one (NDA gate or `require_email`) —
      fingerprint-only anonymous viewers won't appear here, so this
      directory is necessarily a subset of total viewers, not everyone
- [x] Depends on Phase 11's app-shell sidebar

---

## Technical Debt Backlog

These are not tied to a specific phase but should be addressed progressively.

### Developer Experience

- [ ] Install Repomix (`npx repomix`) + MCP plugin for richer Claude Code context in exploratory sessions

### Code Quality

- [x] Replace `any` types in `DatabaseQuery.values` with proper typing — new `QueryParam` union (`string | number | boolean | Date | Buffer | null | undefined`) in `types/index.ts`. See CHANGELOG.
- [x] Add `ForbiddenError` (403) — already in `infra/errors.ts`
- [x] Standardize error message language (mix of PT-BR and EN) — audit found the codebase had already drifted to near-full compliance; fixed the four remaining English strings, all in `infra/errors.ts`'s class defaults and `infra/database.ts`. See CHANGELOG.
- [x] Connection pooling in `infra/database.ts` (uses `Pool` from `pg`)
- [x] Environment variable validation on startup (fail fast) — `infra/env.ts` + `instrumentation.ts`, only for vars with no graceful runtime fallback (Postgres, `PEPPER`, storage credentials); everything else already degrades gracefully and just warns. See CHANGELOG.
- [ ] API response envelope (`{ data, meta }`) for list endpoints
- [x] Pagination helper utility — `infra/pagination.ts#parsePagination`, adopted by all 4 paginated list endpoints (documents, activity, links, contacts) that existed by the time this was picked up. See CHANGELOG.
- [x] Move migration endpoint behind an admin auth guard — `MIGRATIONS_SECRET` header check via `infra/auth.ts#migrationsAuthMiddleware`
  - [x] Extended (2026-07-15): `users.is_superadmin` column + `/superadmin/migrations` page, so a logged-in superadmin session works as an alternative to the secret header. Named "superadmin" (not "admin") to stay distinct from any future customer-facing admin role. No API/UI grants superadmin — promotion is a manual SQL `UPDATE`, documented in `CLAUDE.md`, to keep real emails out of this public repo's committed code.
- [x] Add `updated_at` trigger function in migrations (currently updated manually) — migration `032`, applied to all 9 tables that have the column today (grew from the original 4). See CHANGELOG.
- [x] CI: add TypeScript type-check step to GitHub Actions — `typecheck` job in `.github/workflows/linting.yaml`
- [x] Non-PDF documents (`.docx`/`.pptx`) show a "preview not available" message in the public viewer instead of any content, and — because `ViewerPage.tsx`'s non-PDF branch skips the file fetch entirely — never record a view either, so their analytics stay at zero regardless of real traffic. **Investigated (2026-07-22), findings in `user-stories/tech-debt/US-34-investigate-non-pdf-viewer.md`**: reproduced firsthand (no crash, matches the fallback message exactly), confirmed the view-tracking gap is real and total (`view_count`/`engagement_score` stay `0` despite real visits), confirmed the download button works end-to-end when `allow_download: true`. **Recommendation: don't build inline preview** (every option — client rendering, server-side PDF conversion, third-party iframe — has a real cost not justified without evidence of demand, and DocSend/Papermark-class competitors have the same limitation); **do fix the view-tracking gap** instead, since an owner sharing a non-PDF file today has zero visibility into whether anyone opened it. Two follow-up stories to file:
  - [ ] Record real view events for non-PDF documents — call `POST /api/v1/share/[token]/view` regardless of mime type (omitting page-based fields that don't apply), so non-PDF documents get the same view-count/engagement-score/owner-notification treatment PDFs already have.
  - [ ] `models/shareLink.ts#getFileByToken` doesn't check `allow_download` at all — confirmed via direct `curl` that a `allow_download: false` link's `/file` endpoint still serves the bytes (the restriction is a UI-only hide, not server-enforced). Should return `403` when `allow_download` is `false`, for both PDF and non-PDF links.

### Security hardening (2026-07-12)

- [x] Fixed `UnathorizedError` typo → `UnauthorizedError` (was baked into the API error contract)
- [x] Hash session tokens before persisting (`models/session.ts`) — DB now stores SHA-256 hash, never the raw bearer token
- [x] Explicit `sameSite: "lax"` on all session cookies
- [x] Backstop against the check-then-insert race on unique username/email: unique-violation (`23505`) from Postgres is now caught and mapped to `ValidationError` in `models/user.ts`
- [x] Rate limiter (`infra/rate-limit.ts`) now uses a Postgres-backed counter (new `rate_limit_log` table, migration `033`) instead of an in-memory `Map`, so it survives multi-instance/serverless deploys (e.g. Vercel). Still a no-op outside `NODE_ENV=production` — that gate stays, since existing test fixtures (login/upload helpers) make many rapid same-"IP" requests that would otherwise trip it — but the core counting logic (`checkAndRecord`) is now directly covered by `tests/integration/api/v1/rate-limit.test.ts`, closing most of the "isn't exercised by CI" gap. See CHANGELOG.
- [x] DB connection pool in `infra/database.ts` now sizes itself for the deploy target: `max: 1` / a short `idleTimeoutMillis` when `process.env.VERCEL` is set (a platform var Vercel provides automatically), since each serverless invocation gets its own process/pool and the real constraint is total connections _across_ concurrent invocations, not within one — `max: 10` (pg's own default) unchanged for local Docker/Node. Remaining action is a deployment config choice, not code: if/when a Postgres provider with a pooled endpoint (Neon's `-pooler` host, Supabase's transaction pooling mode) is chosen for production, point `POSTGRES_HOST` at it — no code change needed, since the connection is already built from plain host/port/user/db/password vars. See CHANGELOG.

### Stripe / billing (2026-07-17)

Follow-ups from a best-practices review of US-35 (`infra/stripe.ts`) against Stripe's own integration guidance — all Stripe Dashboard configuration, no code changes needed for these three:

- [ ] Replace the raw secret key (`sk_...`) used for `STRIPE_SECRET_KEY` with a Restricted API Key (`rk_...`) scoped to only what this app calls: Checkout Sessions (write), Billing Portal Sessions (write), Subscriptions (read), Customers (read). Limits blast radius if the key ever leaks.
- [ ] Enable Boleto and PIX in Stripe Dashboard → Settings → Payment methods. `checkout.sessions.create()` already omits `payment_method_types` (correct — lets Stripe pick dynamically), so this alone makes both available to Brazilian customers with no code change, likely relevant for Business-tier B2B checkout.
- [ ] Confirmed no separate Invoicing API integration needed for now — every subscription already generates an Invoice automatically each billing cycle via Stripe Billing. Revisit only if a need for one-off/custom invoices outside the subscription cycle comes up.
- [ ] **Tax not implemented — deliberately deferred.** No `automatic_tax` on the checkout session; confirmed with the user (2026-07-17) there's no active Stripe Tax registration yet, and enabling `automatic_tax` without one silently collects R$0 tax with no error (the most common Stripe Tax mistake). Before implementing: (1) confirm with an accountant whether Stripe Tax actually covers Brazilian domestic tax obligations (ISS/ICMS/PIS-COFINS) — Stripe Tax's core strength is US sales tax/EU VAT/UK VAT, and Brazil's coverage needs to be checked against Stripe's current supported-countries list, not assumed; (2) only then add a registration via the Tax Registrations API/Dashboard and turn on `automatic_tax: { enabled: true }` on the Checkout Session.
