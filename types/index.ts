/* eslint-disable no-unused-vars */
import type { QueryResult, QueryResultRow } from "pg";
import type { NextApiRequest, NextApiResponse } from "next";

// Database Models
export interface User {
  id: string;
  username: string;
  email: string;
  password: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  is_superadmin: boolean;
  active_workspace_id: string | null;
}

export interface UserPublic {
  id: string;
  username: string;
  email: string;
  created_at: Date;
  updated_at: Date;
  is_superadmin: boolean;
  active_workspace_id: string | null;
}

export interface Session {
  id: string;
  token: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface PasswordResetToken {
  id: string;
  token: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
}

export type WorkspaceRole = "owner" | "editor" | "viewer";

export interface Workspace {
  id: string;
  name: string;
  created_by: string;
  is_personal: boolean;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface WorkspaceWithRole extends Workspace {
  role: WorkspaceRole;
  member_count: number;
  // Whether the workspace creator has an Anthropic key configured — same
  // boolean-only pattern as AiKeyStatusResponse, just scoped to the
  // workspace's AI identity (its creator) instead of the requester.
  ai_configured: boolean;
  // Resolved the same way as models/subscription.ts#getPlanForWorkspace —
  // "free" when there's no subscriptions row or it isn't currently active.
  plan: SubscriptionPlan;
  document_count: number;
  active_link_count: number;
}

export type SubscriptionPlan = "free" | "pro" | "business";

// Never "free" — a row only exists once a workspace has actually
// subscribed. "free" is represented by the absence of a row.
export type PaidSubscriptionPlan = Exclude<SubscriptionPlan, "free">;

export type SubscriptionStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

export interface Subscription {
  id: string;
  workspace_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  plan: PaidSubscriptionPlan;
  status: SubscriptionStatus;
  current_period_end: Date;
  created_at: Date;
  updated_at: Date;
}

export interface UpsertSubscriptionInput {
  workspaceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  plan: PaidSubscriptionPlan;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
}

export interface PlanLimits {
  maxDocuments: number | null;
  maxActiveLinks: number | null;
  features: PlanFeature[];
}

export type PlanFeature =
  | "watermark"
  | "nda"
  | "allowlist"
  | "branding"
  | "engagement_score";

export interface CheckoutSessionResponse {
  url: string;
}

// Every flag the app currently gates on. Absence of a `feature_flags` row
// for a key means disabled — same "no row = off" pattern as a workspace
// with no `subscriptions` row resolving to the Free plan — so shipping a
// new flag never needs a seed migration, just an entry here.
export const FEATURE_FLAG_KEYS = ["billing_stripe"] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export interface FeatureFlag {
  id: string;
  key: FeatureFlagKey;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

export type FeatureFlagsResponse = Record<FeatureFlagKey, boolean>;

export interface WorkspaceMember {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: Date;
}

export interface WorkspaceMemberResponse {
  user_id: string;
  username: string;
  email: string;
  role: WorkspaceRole;
  created_at: Date;
}

export interface Document {
  id: string;
  title: string;
  description: string | null;
  original_filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  // Who uploaded it — audit/display field only ("Enviado por"); no longer
  // consulted for authorization, which is workspace-scoped (see workspace_id).
  user_id: string;
  workspace_id: string;
  ai_summary: string | null;
  ai_summary_generated_at: Date | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export type DocumentResponse = Document;

// Only the list endpoint joins the uploader's username in — a single
// document fetch (findOneById) has no need for it.
//
// view_count/active_link_count/engagement_score are computed, read-only
// aggregates added for the dashboard table (US-43) — same pattern as
// WorkspaceWithRole's document_count/active_link_count (US-36). Additive
// only: findOneById's DocumentResponse doesn't gain these fields.
export interface DocumentListItem extends Document {
  uploaded_by_username: string;
  view_count: number;
  active_link_count: number;
  engagement_score: number;
}

export interface DocumentSummaryResponse {
  summary: string | null;
  generated_at: Date | null;
}

export interface DocumentListResponse {
  documents: DocumentListItem[];
  total: number;
}

// One row per event in a workspace's activity feed (Phase 12). "view" and
// "link_created" are the only event types persisted today — NDA
// acceptance and blocked-download attempts aren't recorded anywhere yet,
// so they can't appear here until that's built (see TODO.md Phase 12).
export interface ActivityEvent {
  event_type: "view" | "link_created";
  id: string;
  document_id: string;
  document_title: string;
  // null for an anonymous viewer (no viewer_name/viewer_email on file);
  // the link's creator username for a "link_created" row.
  actor_name: string | null;
  actor_email: string | null;
  link_label: string | null;
  pages_viewed: number | null;
  page_count: number | null;
  time_on_page: number | null;
  // Only meaningful for "view" rows — true when this viewer_fingerprint
  // already has an earlier link_views row on the same link.
  is_revisit: boolean;
  created_at: Date;
}

export interface ActivityListResponse {
  events: ActivityEvent[];
  total: number;
}

// One row per share link across every document in a workspace (Phase 13's
// global links inventory, `/links`) — narrower than ShareLinkResponse,
// which is scoped to a single document and includes settings fields this
// cross-document table doesn't display. "expired" folds together both an
// actually-expired link and a revoked one (is_active: false); the
// distinction between the two is still visible on the link's own
// document detail page (ShareLinkCard's "Revogado"/"Ativo" badges).
export interface WorkspaceLinkSummary {
  id: string;
  token: string;
  label: string | null;
  document_id: string;
  document_title: string;
  view_count: number;
  status: "active" | "expired";
  created_at: Date;
}

export interface WorkspaceLinksResponse {
  links: WorkspaceLinkSummary[];
  total: number;
}

// One row per distinct viewer_email across every document/link in a
// workspace (Phase 14's contacts directory, `/contacts`) — groups
// link_views by email instead of by link, unlike ViewerEngagement (Phase
// 5/7), which is always scoped to one link. A viewer without an email on
// file (no NDA gate, no require_email) never appears here — this
// directory is necessarily a subset of total viewers, not everyone.
// most_recent_* exist so the frontend can wire "Gerar follow-up" straight
// to the existing per-link follow-up-email endpoint without a second
// round-trip to find which document/link/fingerprint to use.
export interface WorkspaceContactSummary {
  viewer_email: string;
  viewer_name: string | null;
  document_count: number;
  last_viewed_at: Date;
  engagement_score: number;
  most_recent_document_id: string;
  most_recent_link_id: string;
  most_recent_viewer_fingerprint: string | null;
}

export interface WorkspaceContactsResponse {
  contacts: WorkspaceContactSummary[];
  total: number;
}

// US-55: a room groups several documents under one shareable link.
// Deliberately its own tables/types, not a ShareLink extension — see
// user-stories/phase-9-workspaces/US-55-data-rooms.md's scope note.
export interface DataRoom {
  id: string;
  workspace_id: string;
  name: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

// One row per document in a room, joined with the document's own title/
// mime_type — allow_download is per-document, not per-recipient (no
// authenticated-recipient concept exists to hang per-recipient overrides
// on today).
export interface DataRoomDocumentSummary {
  document_id: string;
  title: string;
  mime_type: string;
  page_count: number | null;
  allow_download: boolean;
}

// Owner-facing only (US-56) — never returned by the public
// data-room-share routes, which use the plain DataRoomDocumentSummary.
export interface DataRoomDocumentWithStats extends DataRoomDocumentSummary {
  view_count: number;
  last_viewed_at: Date | null;
}

export interface DataRoomResponse {
  id: string;
  workspace_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
  documents: DataRoomDocumentWithStats[];
}

// One row per room across a workspace (list view) — narrower than
// DataRoomResponse, same "summary vs. full detail" split as
// WorkspaceLinkSummary vs. ShareLinkResponse.
export interface DataRoomSummary {
  id: string;
  name: string;
  document_count: number;
  created_at: Date;
}

export interface DataRoomListResponse {
  data_rooms: DataRoomSummary[];
  total: number;
}

export interface DataRoomCreateInput {
  name: string;
  document_ids: string[];
}

// document_ids/allow_download are provided together as a full-replace set
// (same semantics as the share link update input's allowed-emails field)
// — the frontend always submits "here's the current membership," not
// incremental add/remove calls.
export interface DataRoomUpdateInput {
  name?: string;
  documents?: { document_id: string; allow_download: boolean }[];
}

export interface DataRoomLink {
  id: string;
  token: string;
  data_room_id: string;
  user_id: string;
  label: string | null;
  password_hash: string | null;
  expires_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  require_email: boolean;
  notify_on_view: boolean;
  watermark_enabled: boolean;
  nda_text: string | null;
  brand_accent_color: string | null;
  brand_welcome_message: string | null;
}

export interface DataRoomLinkResponse {
  id: string;
  token: string;
  data_room_id: string;
  label: string | null;
  expires_at: Date | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  has_password: boolean;
  require_email: boolean;
  allowed_emails: string[];
  notify_on_view: boolean;
  watermark_enabled: boolean;
  nda_text: string | null;
  brand_accent_color: string | null;
  brand_welcome_message: string | null;
}

export interface DataRoomLinkCreateInput {
  label?: string;
  password?: string;
  expires_at?: string;
  require_email?: boolean;
  allowed_emails?: string[];
  notify_on_view?: boolean;
  watermark_enabled?: boolean;
  nda_text?: string;
  brand_accent_color?: string;
  brand_welcome_message?: string;
}

export interface DataRoomLinkUpdateInput {
  label?: string | null;
  password?: string | null;
  expires_at?: string | null;
  is_active?: boolean;
  require_email?: boolean;
  allowed_emails?: string[] | null;
  notify_on_view?: boolean;
  watermark_enabled?: boolean;
  nda_text?: string | null;
  brand_accent_color?: string | null;
  brand_welcome_message?: string | null;
}

// Public, unauthenticated shape returned by the data-room-share token
// route — deliberately excludes workspace_id/user_id and the documents'
// storage_key (same narrowing rationale as ShareLinkWithDocument).
// watermark_enabled/nda_text/brand_* ARE included (same rationale as
// ShareLinkWithDocument: the viewer's own client needs them to render).
export interface DataRoomLinkWithDocuments {
  id: string;
  token: string;
  label: string | null;
  expires_at: Date | null;
  is_active: boolean;
  has_password: boolean;
  watermark_enabled: boolean;
  nda_text: string | null;
  brand_accent_color: string | null;
  brand_welcome_message: string | null;
  ai_chat_available: boolean;
  data_room: {
    id: string;
    name: string;
  };
  documents: DataRoomDocumentSummary[];
}

export interface DataRoomLinkViewCreateInput {
  document_id: string;
  viewer_fingerprint?: string;
  viewer_email?: string;
  viewer_name?: string;
  time_on_page?: number;
  pages_viewed?: number;
  downloaded?: boolean;
  ip_address?: string;
  user_agent?: string;
}

export interface DataRoomLinkView {
  id: string;
  data_room_link_id: string;
  document_id: string;
  viewer_fingerprint: string | null;
  viewer_email: string | null;
  viewer_name: string | null;
  ip_address: string | null;
  country_code: string | null;
  user_agent: string | null;
  time_on_page: number | null;
  pages_viewed: number | null;
  downloaded: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RecordedDataRoomLinkView extends DataRoomLinkView {
  is_new_viewer: boolean;
}

// Used to notify the room's creator when a data-room link gets a new
// viewer — mirrors ShareLinkNotificationInfo, scoped to the specific
// document viewed (a room link can cover several).
export interface DataRoomLinkNotificationInfo {
  owner_email: string;
  data_room_id: string;
  data_room_name: string;
  document_id: string;
  document_title: string;
  link_label: string | null;
  notify_on_view: boolean;
}

// Shared shape every paginated model function takes, computed once by
// infra/pagination.ts#parsePagination instead of each model re-deriving
// `offset` from `page`/`perPage` itself.
export interface PaginationParams {
  page: number;
  perPage: number;
  offset: number;
}

// Not currently returned by any endpoint (every existing list response
// keeps its own plain `total` field, and the one frontend consumer that
// needs page count — DocumentList.tsx — already computes it inline from
// `total`) — kept ready via infra/pagination.ts#buildPaginationMeta for
// a future list endpoint to adopt without redesigning this shape then.
export interface PaginationMeta {
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface ShareLink {
  id: string;
  token: string;
  document_id: string;
  user_id: string;
  label: string | null;
  password_hash: string | null;
  expires_at: Date | null;
  allow_download: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  notify_on_view: boolean;
  require_email: boolean;
  watermark_enabled: boolean;
  nda_text: string | null;
  brand_accent_color: string | null;
  brand_welcome_message: string | null;
}

export interface ShareLinkResponse {
  id: string;
  token: string;
  document_id: string;
  user_id: string;
  label: string | null;
  expires_at: Date | null;
  allow_download: boolean;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  has_password: boolean;
  notify_on_view: boolean;
  require_email: boolean;
  allowed_emails: string[];
  watermark_enabled: boolean;
  nda_text: string | null;
  brand_accent_color: string | null;
  brand_welcome_message: string | null;
}

// Deliberately narrower than ShareLinkResponse: this is what the public,
// unauthenticated endpoint returns, so it must not leak the link's
// document_id/user_id/updated_at or the document's storage_key/user_id/timestamps.
// watermark_enabled/nda_text/brand_* ARE included (unlike allowed_emails) —
// the viewer's own client needs them to render the watermark, the NDA gate,
// and the branding, none of which are sensitive (the owner set them for
// display).
export interface ShareLinkWithDocument {
  id: string;
  token: string;
  label: string | null;
  expires_at: Date | null;
  allow_download: boolean;
  is_active: boolean;
  created_at: Date;
  has_password: boolean;
  watermark_enabled: boolean;
  nda_text: string | null;
  brand_accent_color: string | null;
  brand_welcome_message: string | null;
  // Whether the document owner has an Anthropic key configured — tells the
  // viewer whether to show the chat toggle at all, without exposing
  // anything about the key itself.
  ai_chat_available: boolean;
  document: {
    id: string;
    title: string;
    description: string | null;
    mime_type: string;
    size_bytes: number;
    page_count: number | null;
  };
}

export interface LinkView {
  id: string;
  share_link_id: string;
  viewer_fingerprint: string | null;
  viewer_email: string | null;
  viewer_name: string | null;
  ip_address: string | null;
  country_code: string | null;
  user_agent: string | null;
  time_on_page: number | null;
  pages_viewed: number | null;
  downloaded: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RecordedLinkView extends LinkView {
  is_new_viewer: boolean;
}

export interface ShareLinkNotificationInfo {
  owner_email: string;
  document_id: string;
  document_title: string;
  link_label: string | null;
  notify_on_view: boolean;
}

export interface ViewsByDay {
  date: string;
  count: number;
}

export interface LinkViewAnalytics {
  total_views: number;
  unique_viewers: number;
  avg_time_on_page: number | null;
  avg_pages_viewed: number | null;
  first_viewed_at: Date | null;
  last_viewed_at: Date | null;
  views_by_day: ViewsByDay[];
}

export interface PageBreakdown {
  page_number: number;
  avg_time_seconds: number;
  view_count: number;
}

// One row per distinct viewer (grouped by fingerprint) on a single link,
// aggregated across all of their visits — a viewer can have more than one
// link_views row if they return after the 30-min dedup window closes.
export interface ViewerEngagement {
  // A hashed per-browser fingerprint, not sensitive to the document owner
  // who already sees the rest of this viewer's activity — surfaced so the
  // frontend can reference a specific viewer (e.g. to request a follow-up
  // email suggestion for them) without a separate persisted "viewer" id.
  viewer_fingerprint: string | null;
  viewer_email: string | null;
  viewer_name: string | null;
  total_time_on_page: number;
  max_pages_viewed: number;
  visit_count: number;
  downloaded: boolean;
  first_viewed_at: Date;
  last_viewed_at: Date;
  // 0-100, weighted blend of time on page / % of pages viewed / return
  // visits / download — see models/linkView.ts#computeEngagementScore for
  // the exact weights and rationale.
  engagement_score: number;
}

export interface FollowUpEmailSuggestion {
  subject: string;
  body: string;
  viewer_email: string | null;
}

// Only on the per-link response: the per-viewer engagement list needs one
// link's context (the follow-up-email suggestion is requested per link).
// The page-by-page breakdown doesn't have this problem — the document-level
// response below aggregates it across every link, since they all point at
// the same file.
export interface LinkAnalyticsResponse extends LinkViewAnalytics {
  page_breakdown: PageBreakdown[];
  // null on a Free-plan workspace — engagement scoring is a Pro feature
  // (see models/subscription.ts#PLAN_LIMITS); every other field here is
  // unaffected, since only this one is gated.
  viewers: ViewerEngagement[] | null;
}

export interface TopLink {
  link_id: string;
  label: string | null;
  total_views: number;
}

export interface DocumentAnalyticsResponse extends LinkViewAnalytics {
  top_links: TopLink[];
  // Aggregated across every share link of the document — unlike the
  // per-viewer engagement list, a page-by-page breakdown means the same
  // thing regardless of which link a view came in through (every link
  // points at the same file), so this rolls up cleanly at the document
  // level.
  page_breakdown: PageBreakdown[];
}

export interface Suggestion {
  type: "drop_off" | "engagement";
  message: string;
  page_number: number | null;
}

export interface AnalyticsInsightResponse {
  insight: string | null;
  suggestions: Suggestion[];
  generated_at: Date | null;
}

// Input Types
export interface UserCreateInput {
  username: string;
  email: string;
  password: string;
}

export interface UserUpdateInput {
  username?: string;
  email?: string;
  password?: string;
}

export interface AuthenticationInput {
  email: string;
  password: string;
}

export interface DocumentCreateInput {
  title: string;
  description?: string;
  original_filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  page_count: number | null;
  user_id: string;
  workspace_id: string;
}

export interface DocumentUpdateInput {
  title?: string;
  description?: string;
}

export interface ShareLinkCreateInput {
  label?: string;
  password?: string;
  expires_at?: string;
  allow_download?: boolean;
  notify_on_view?: boolean;
  require_email?: boolean;
  allowed_emails?: string[];
  watermark_enabled?: boolean;
  nda_text?: string;
  brand_accent_color?: string;
  brand_welcome_message?: string;
}

export interface ShareLinkUpdateInput {
  label?: string | null;
  password?: string | null;
  expires_at?: string | null;
  allow_download?: boolean;
  is_active?: boolean;
  notify_on_view?: boolean;
  require_email?: boolean;
  allowed_emails?: string[] | null;
  watermark_enabled?: boolean;
  nda_text?: string | null;
  brand_accent_color?: string | null;
  brand_welcome_message?: string | null;
}

export interface PageTimeInput {
  page: number;
  seconds: number;
}

export interface LinkViewCreateInput {
  viewer_fingerprint?: string;
  viewer_email?: string;
  viewer_name?: string;
  ip_address?: string;
  user_agent?: string;
  time_on_page?: number;
  pages_viewed?: number;
  page_times?: PageTimeInput[];
  downloaded?: boolean;
}

export interface ViewNotificationInput {
  to: string;
  documentTitle: string;
  documentId: string;
  linkLabel: string | null;
  analyticsUrl: string;
  viewerEmail?: string | null;
}

export interface PasswordResetEmailInput {
  to: string;
  resetUrl: string;
}

// Database Query Types
export type QueryParam =
  | string
  | number
  | boolean
  | Date
  | Buffer
  | null
  | undefined
  // `pg` serializes a JS array into a Postgres array literal, used by
  // e.g. `= ANY($1::uuid[])` — only string[] so far (UUID lists).
  | string[];

export interface DatabaseQuery {
  text: string;
  values?: QueryParam[];
}

export interface DatabaseResult<T extends QueryResultRow = any>
  extends QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

// API Response Types
export interface ApiResponse<T = any> {
  data?: T;
  message?: string;
  action?: string;
}

export interface StatusResponse {
  updated_at: string;
  dependencies: {
    database: {
      version: string;
      max_connections: number;
      opened_connections: number;
    };
  };
}

// Error Types
export interface ErrorResponse {
  name: string;
  message: string;
  action: string;
  status: number;
}

export interface ErrorConstructorOptions {
  cause?: Error;
  message?: string;
  action?: string;
  statusCode?: number;
}

// Next.js API Types
export interface AuthenticatedNextApiRequest extends NextApiRequest {
  user?: User;
  session?: Session;
}

export type NextApiHandler = (
  req: NextApiRequest,
  res: NextApiResponse,
) => void | Promise<void>;

// Migration Types
export interface Migration {
  id: number;
  name: string;
  run_on: Date;
}

export interface RunMigration {
  path: string;
  name: string;
  timestamp: string;
}

// Model Interface Types
export interface UserModel {
  create(userInput: UserCreateInput): Promise<UserPublic>;
  findOneById(id: string): Promise<User>;
  findOneByUsername(username: string): Promise<User>;
  findOneByEmail(email: string): Promise<User>;
  updateByUsername(
    username: string,
    userInput: UserUpdateInput,
  ): Promise<UserPublic>;
  deleteByUsername(username: string): Promise<void>;
  setAiApiKey(userId: string, apiKey: string | null): Promise<void>;
  hasAiApiKey(userId: string): Promise<boolean>;
  // Internal use only (decrypted plaintext) — never returned over the API.
  getAiApiKey(userId: string): Promise<string | null>;
  resetPassword(userId: string, newPassword: string): Promise<void>;
}

export interface AiKeyStatusResponse {
  configured: boolean;
}

export interface PasswordModel {
  hash(password: string): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
}

export interface SessionModel {
  create(userId: string): Promise<Session>;
  findOneByToken(token: string): Promise<Session | null>;
  deleteByToken(token: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
  EXPIRATION_IN_MILLISECONDS: number;
}

export interface PasswordResetModel {
  create(userId: string): Promise<PasswordResetToken>;
  findValidByToken(token: string): Promise<PasswordResetToken | null>;
  deleteByToken(token: string): Promise<void>;
  deleteByUserId(userId: string): Promise<void>;
}

export interface AuthenticationModel {
  getAuthentication(email: string, password: string): Promise<User>;
}

export interface DocumentModel {
  create(input: DocumentCreateInput): Promise<DocumentResponse>;
  findAllByWorkspaceId(
    workspaceId: string,
    pagination: PaginationParams,
  ): Promise<DocumentListResponse>;
  findOneById(id: string, userId: string): Promise<DocumentResponse>;
  updateById(
    id: string,
    userId: string,
    input: DocumentUpdateInput,
  ): Promise<DocumentResponse>;
  deleteById(id: string, userId: string): Promise<{ storage_key: string }>;
  updateSummary(id: string, summary: string): Promise<DocumentSummaryResponse>;
}

export interface WorkspaceModel {
  create(userId: string, name: string): Promise<Workspace>;
  findAllByUserId(userId: string): Promise<WorkspaceWithRole[]>;
  // Throws NotFoundError if the workspace doesn't exist, is deleted, or the
  // user isn't a member (same response for all three, to avoid leaking
  // which workspaces exist); throws ForbiddenError if the user's role is
  // below minRole. Central authorization check reused by US-30/US-31.
  requireRole(
    workspaceId: string,
    userId: string,
    minRole: WorkspaceRole,
  ): Promise<void>;
  updateById(
    workspaceId: string,
    userId: string,
    name: string,
  ): Promise<Workspace>;
  deleteById(workspaceId: string, userId: string): Promise<void>;
  activate(workspaceId: string, userId: string): Promise<Workspace>;
  // Resolves the AI "identity" for any document in this workspace — whoever
  // created the workspace, regardless of who uploaded the specific document
  // or who's currently acting. Returns null if the document/workspace can't
  // be resolved (e.g. a deleted document).
  getCreatorIdForDocument(documentId: string): Promise<string | null>;
  listMembers(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMemberResponse[]>;
  inviteMember(
    workspaceId: string,
    actingUserId: string,
    email: string,
    role: "editor" | "viewer",
  ): Promise<WorkspaceMemberResponse>;
  updateMemberRole(
    workspaceId: string,
    actingUserId: string,
    targetUserId: string,
    newRole: WorkspaceRole,
  ): Promise<WorkspaceMemberResponse>;
  removeMember(
    workspaceId: string,
    actingUserId: string,
    targetUserId: string,
  ): Promise<void>;
}

export interface SubscriptionModel {
  getPlanForWorkspace(workspaceId: string): Promise<SubscriptionPlan>;
  getByWorkspaceId(workspaceId: string): Promise<Subscription | null>;
  getByStripeSubscriptionId(
    stripeSubscriptionId: string,
  ): Promise<Subscription | null>;
  upsertFromStripeEvent(input: UpsertSubscriptionInput): Promise<void>;
  markCanceled(stripeSubscriptionId: string): Promise<void>;
  markPastDue(stripeSubscriptionId: string): Promise<void>;
  PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits>;
}

export interface FeatureFlagModel {
  isEnabled(key: FeatureFlagKey): Promise<boolean>;
  requireEnabled(key: FeatureFlagKey): Promise<void>;
  setEnabled(key: FeatureFlagKey, enabled: boolean): Promise<FeatureFlag>;
  getAll(): Promise<FeatureFlagsResponse>;
}

export interface ShareLinkModel {
  create(
    documentId: string,
    userId: string,
    input: ShareLinkCreateInput,
  ): Promise<ShareLinkResponse>;
  findAllByDocumentId(
    documentId: string,
    userId: string,
  ): Promise<ShareLinkResponse[]>;
  findAllByWorkspaceId(
    workspaceId: string,
    userId: string,
    pagination: PaginationParams,
  ): Promise<WorkspaceLinksResponse>;
  findOneById(
    id: string,
    documentId: string,
    userId: string,
  ): Promise<ShareLinkResponse>;
  updateById(
    id: string,
    documentId: string,
    userId: string,
    input: ShareLinkUpdateInput,
  ): Promise<ShareLinkResponse>;
  revokeById(
    id: string,
    documentId: string,
    userId: string,
  ): Promise<ShareLinkResponse>;
  getByToken(
    token: string,
    password?: string,
    email?: string,
    name?: string,
  ): Promise<ShareLinkWithDocument>;
  getFileByToken(
    token: string,
    password?: string,
    email?: string,
    name?: string,
  ): Promise<{ storage_key: string; mime_type: string }>;
  validateToken(token: string): Promise<{ id: string }>;
  getNotificationInfo(
    shareLinkId: string,
  ): Promise<ShareLinkNotificationInfo | null>;
  getPublicMetadata(
    token: string,
  ): Promise<{ title: string; description: string | null } | null>;
  getNdaText(token: string): Promise<string | null>;
}

export interface LinkViewModel {
  recordView(
    token: string,
    input: LinkViewCreateInput,
  ): Promise<RecordedLinkView>;
  getAnalyticsByLinkId(
    linkId: string,
    pageCount: number | null,
  ): Promise<LinkAnalyticsResponse>;
  getAnalyticsByDocumentId(
    documentId: string,
  ): Promise<DocumentAnalyticsResponse>;
  getPageBreakdownByDocumentId(documentId: string): Promise<PageBreakdown[]>;
  getViewerByFingerprint(
    linkId: string,
    fingerprint: string,
    pageCount: number | null,
  ): Promise<ViewerEngagement | null>;
}

export interface StorageModel {
  saveFile(
    file: Buffer,
    originalFilename: string,
  ): Promise<{ key: string; size: number }>;
  deleteFile(key: string): Promise<void>;
  getFile(key: string): Promise<{ body: Buffer; contentType: string }>;
}

export interface MailerModel {
  sendViewNotification(input: ViewNotificationInput): Promise<void>;
  sendPasswordResetEmail(input: PasswordResetEmailInput): Promise<void>;
}

export interface MigratorModel {
  listPendingMigrations(): Promise<RunMigration[]>;
  runPendingMigrations(): Promise<RunMigration[]>;
}

export interface ActivityModel {
  findAllByWorkspaceId(
    workspaceId: string,
    pagination: PaginationParams,
  ): Promise<ActivityListResponse>;
}

export interface ContactModel {
  findAllByWorkspaceId(
    workspaceId: string,
    userId: string,
    pagination: PaginationParams,
  ): Promise<WorkspaceContactsResponse>;
}

export interface DataRoomModel {
  create(
    workspaceId: string,
    userId: string,
    input: DataRoomCreateInput,
  ): Promise<DataRoomResponse>;
  findAllByWorkspaceId(
    workspaceId: string,
    userId: string,
    pagination: PaginationParams,
  ): Promise<DataRoomListResponse>;
  findOneById(id: string, userId: string): Promise<DataRoomResponse>;
  updateById(
    id: string,
    userId: string,
    input: DataRoomUpdateInput,
  ): Promise<DataRoomResponse>;
  deleteById(id: string, userId: string): Promise<void>;
}

export interface DataRoomLinkModel {
  create(
    dataRoomId: string,
    userId: string,
    input: DataRoomLinkCreateInput,
  ): Promise<DataRoomLinkResponse>;
  findAllByDataRoomId(
    dataRoomId: string,
    userId: string,
  ): Promise<DataRoomLinkResponse[]>;
  updateById(
    id: string,
    dataRoomId: string,
    userId: string,
    input: DataRoomLinkUpdateInput,
  ): Promise<DataRoomLinkResponse>;
  getByToken(
    token: string,
    password?: string,
    email?: string,
    name?: string,
  ): Promise<DataRoomLinkWithDocuments>;
  getFileByToken(
    token: string,
    documentId: string,
    password?: string,
    email?: string,
    name?: string,
  ): Promise<{ storage_key: string; mime_type: string }>;
  validateToken(token: string): Promise<{ id: string }>;
  getNdaText(token: string): Promise<string | null>;
  getNotificationInfo(
    dataRoomLinkId: string,
    documentId: string,
  ): Promise<DataRoomLinkNotificationInfo | null>;
}

export interface DataRoomLinkViewModel {
  recordView(
    token: string,
    input: DataRoomLinkViewCreateInput,
  ): Promise<RecordedDataRoomLinkView>;
  getStatsByDataRoomId(
    dataRoomId: string,
  ): Promise<Map<string, { view_count: number; last_viewed_at: Date | null }>>;
}

export interface DatabaseModel {
  query<T extends QueryResultRow = any>(
    query: string | DatabaseQuery,
  ): Promise<DatabaseResult<T>>;
  getNewClient(): Promise<any>;
}
