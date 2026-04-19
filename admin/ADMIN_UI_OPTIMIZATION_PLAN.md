# Admin Panel UI Optimization Plan
### Lavish Fashion — Support-Team-First Refactor

**Document owner:** Admin Experience Working Group
**Audience:** Engineering, Design, and Support Operations
**Goal:** Make the `admin/` panel demonstrably easier to operate for the day-to-day support team — faster lookups, clearer state, fewer clicks per resolution, and consistent affordances — **without breaking any current API contract, route, or existing functionality**.

> **Non-goal:** This plan does *not* propose backend changes, schema migrations, or removal of any feature. Every refactor described here is a UI/UX or admin-side state-management improvement that consumes the same endpoints already shipped in `server/`.

---

## 0. Executive Summary

### 0.1 Why this refactor
The current admin panel ([admin/src/App.jsx](admin/src/App.jsx)) is a feature-complete operations workspace, but support agents and merchandisers report friction in three recurring categories:

1. **"Where do I find X?"** — Information density on `Orders`, `Customers`, `Reviews`, and `Marketing` pages buries the very fields support agents need first (order ID, customer phone, last status, refund eligibility).
2. **"Did my action save?"** — Inconsistent loading/empty/error patterns across pages (some use `ui-loading-state`, some use spinners, some use skeletons, some show nothing). Toasts disappear before agents read them on slow networks.
3. **"I can't do this in bulk."** — Almost every action is per-row (status change, status moderation, inventory update, campaign dispatch). A 200-order day means 200 clicks.

This document defines a **page-by-page refactor**, a **shared component layer**, and a **rollout sequence** that addresses all three categories.

### 0.2 Guiding principles (apply to every page)

| # | Principle | Concrete rule |
|---|-----------|---------------|
| P1 | **Support-first information hierarchy** | The single most important field for a support ticket must be visible without scrolling and without expanding any panel. |
| P2 | **One pattern per concept** | One loading skeleton, one empty state, one error state, one confirmation dialog, one toast variant per outcome. |
| P3 | **Action discoverability** | Every destructive action shows confirmation; every long-running action shows progress; every irreversible action shows an undo window when possible. |
| P4 | **Keyboard-first lookup** | Every list page supports `/` to focus search, `↑/↓` to move selection, `Enter` to open detail, `Esc` to close drawers/modals. |
| P5 | **Stable layout** | No content reflow on data refresh; use skeleton placeholders that match final dimensions. |
| P6 | **Server-truth, optimistic-UI** | Mutations apply optimistically with rollback on failure, so the panel feels instant on flaky connections. |
| P7 | **Backwards-compatible** | All existing routes (`/list`, `/add`, `/edit/:id`) must continue to redirect; all existing API payload shapes must continue to be consumed. |

---

## 1. Cross-Cutting Foundations (build these first)

These shared primitives unblock every page-level refactor. They must ship in **Phase 1** before any page is rewritten.

### 1.1 Shared component library — `admin/src/components/ui/`

Create the following co-located, fully Tailwind primitives. They replace scattered inline class strings now used in [admin/src/pages/Dashboard.jsx](admin/src/pages/Dashboard.jsx), [admin/src/pages/List.jsx](admin/src/pages/List.jsx), [admin/src/pages/Inventory.jsx](admin/src/pages/Inventory.jsx), [admin/src/pages/Orders.jsx](admin/src/pages/Orders.jsx), [admin/src/pages/Customers.jsx](admin/src/pages/Customers.jsx), [admin/src/pages/Coupons.jsx](admin/src/pages/Coupons.jsx), [admin/src/pages/Loyalty.jsx](admin/src/pages/Loyalty.jsx), [admin/src/pages/Reviews.jsx](admin/src/pages/Reviews.jsx), [admin/src/pages/Marketing.jsx](admin/src/pages/Marketing.jsx), and [admin/src/pages/FitAnalytics.jsx](admin/src/pages/FitAnalytics.jsx).

| Component | Responsibility | Replaces |
|-----------|----------------|----------|
| `PageHeader` | Title + description + slot for actions + slot for sync badge | The bespoke `<section className='rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm'>` blocks at the top of every page |
| `MetricCard` | Label, big number, helper text, tone variant | The repeated `<article className='rounded-3xl border ...'>` blocks |
| `MetricGrid` | 1/2/4-column responsive grid | The duplicated `grid gap-4 md:grid-cols-2 xl:grid-cols-4` |
| `Toolbar` | Search input + filter selects + secondary actions, with a single keyboard `/` shortcut handler | The custom flex rows in `List`, `Inventory`, `Customers`, `Reviews`, `Marketing` |
| `DataTable` | Virtualized table with sticky header, row selection, column-driven config, empty/loading/error slots | The hand-rolled tables across `List`, `Inventory`, `Orders` |
| `EmptyState` | Icon + title + body + primary action | The ad-hoc `<div className='rounded-2xl bg-slate-50 ...'>No X matched the filters</div>` |
| `LoadingState` | Skeleton list / skeleton table / spinner card | The mixed `ui-loading-state`, inline spinner, and `Loading X...` strings |
| `ErrorState` | Title + body + retry button | The bespoke retry blocks in `Loyalty.jsx` and `FitAnalytics.jsx` |
| `ConfirmDialog` | Modal with destructive variant, replaces `window.confirm` in `List.jsx` (`removeProduct`) | `window.confirm('Delete this product...')` |
| `Drawer` | Right-side slide-in panel for detail views | The currently-inline detail panes in `Customers`, `Reviews`, `Marketing` |
| `StatusBadge` | Single source of truth for color tokens (active/draft/archived/healthy/low_stock/out_of_stock/pending/published/rejected/live/scheduled/expired/paused) | Six different `getXxxClasses` helpers scattered across pages |
| `Tabs` | Accessible, URL-synced tab control | Replaces ad-hoc filter strips |
| `KeyValueList` | Two-column label→value renderer for detail panes | Repeated grid blocks in `Customers`, `Reviews`, `Orders` |
| `Money`, `DateTime`, `RelativeTime` | Render-only primitives so we never inline `Intl.NumberFormat` again | The duplicated `formatCurrency`/`formatDate`/`formatSyncTime` helpers in every page |

**Rationale:** Each of these helpers is currently re-implemented in 4–8 files with subtle variations (e.g. `formatDate` returns `'Recently'` in `Dashboard`, `'Not yet'` in `Customers`, `'Open ended'` in `Coupons`, `'Not scheduled'` in `Marketing`). Support agents notice this inconsistency.

### 1.2 Shared hooks — `admin/src/hooks/`

| Hook | Purpose |
|------|---------|
| `useAdminQuery(key, fetcher, opts)` | Wrap `axios` calls with: token injection, in-flight dedupe, stale-while-revalidate cache, and consistent error toast suppression flag. Replaces the hand-rolled `setIsLoading(true) / try / finally` pattern in **every** page. |
| `useAdminMutation(fn, opts)` | Optimistic update + rollback + toast on success/failure. |
| `useDebouncedValue(value, ms)` | Use to debounce search inputs (currently filter every keystroke against the full in-memory list). |
| `useKeyboardShortcut(map)` | Register `/`, `Esc`, `g d` (go dashboard), `g o` (orders), `g c` (customers), etc. |
| `useTableSelection(rows, idKey)` | Multi-row select state for bulk actions. |
| `usePersistedState(key, default)` | Persist filter/segment choices to `localStorage` so an agent's filters survive a refresh. |

### 1.3 Design tokens — `admin/src/index.css`

Add a single CSS variable layer so the panel has one palette. Today, headings are `text-slate-900`, `text-slate-950`, and `text-stone-900` interchangeably. Define:

```
--color-surface, --color-surface-muted, --color-border,
--color-text-primary, --color-text-secondary, --color-text-muted,
--color-success, --color-warning, --color-danger, --color-info,
--radius-card, --radius-control, --shadow-card.
```

Update Tailwind config to expose these as `bg-surface`, `text-primary`, etc. **Existing class strings keep working**; we only *prefer* the new tokens in refactored components.

### 1.4 Global behavior

- **Toast persistence:** Increase `autoClose` from `3000` ms ([admin/src/App.jsx](admin/src/App.jsx#L130)) to `6000` ms for success and `0` (manual dismiss) for errors. Add a "Copy details" button on error toasts.
- **Session expiry:** The 401/403 interceptor in [admin/src/App.jsx](admin/src/App.jsx#L102-L121) currently silently logs out. Add a soft-warning banner at 5-min remaining if backend exposes expiry; otherwise show a "Reconnecting…" overlay during the redirect to login so the agent doesn't lose context.
- **Audit trail surfacing:** When an agent edits a customer note, order status, review status, or coupon, surface "Last edited by X · Yesterday at 4:21pm" on the affected entity. Backend already stores `updatedAt`; we just need to render it consistently.

---

## 2. Navigation & Shell Refactor

### 2.1 Sidebar ([admin/src/components/Sidebar.jsx](admin/src/components/Sidebar.jsx))

**Current pain points**
- Sections (`Overview`, `Catalog`, `Commerce`, `Growth`) are merchant-strategist language, not support language.
- The "New Product" item sits inside `Catalog`, but support agents almost never create products — it crowds the menu.
- Active item descriptions are only visible when active, hiding context.
- No visual grouping for "tasks I do every shift" vs "things I check weekly".
- Server-status integration summary at the top is helpful but unscannable (one long line).

**Refactor**

1. **Reorder sections by support frequency:**
   - **Daily Operations** → Orders, Customers, Reviews
   - **Catalog** → Products, Inventory, *(New Product moved to a "+" button inside Products toolbar)*
   - **Promotions** → Coupons, Marketing
   - **Insights** → Dashboard, Loyalty, Fit Analytics
2. **Pin "Orders" as the default landing page** for users in a `support` role (read role from a future bootstrap field; for now keep Dashboard as default and document the toggle).
3. **Always-visible item description** in muted text (1 line, truncate). Saves a click of "what does this do again?".
4. **Connection panel** → split into 3 traffic-light dots (`API`, `Payments`, `Email`) with hover tooltip; replaces the current run-on sentence.
5. **Add a global "Search anything" command palette** (`Ctrl/Cmd+K`) at the top of the sidebar — searches orders by ID, customers by email/phone, products by SKU. Routes to the existing detail pages. Endpoints already exist; this is a thin client-side aggregator.
6. **Collapse on `lg`** behavior: keep current; verify focus trap and `Esc` dismissal in the mobile overlay (currently the overlay button is a `<button>` overlay — good for a11y, but no focus return).

### 2.2 Navbar ([admin/src/components/Navbar.jsx](admin/src/components/Navbar.jsx))

**Current pain points**
- Page title + description take ~35% of the bar, pushing controls to the right edge — on 1366×768 monitors common in support, Refresh and Logout are clipped.
- "Refresh API" and "Logout" share identical styling weight, encouraging accidental logouts.
- Sync time is buried inside the Live API badge.
- No breadcrumbs for nested routes (e.g. when editing a product the user has no quick path back to the list).

**Refactor**

1. **Two-row navbar on `<xl`:** row 1 = title + breadcrumb + connection chip, row 2 = page-specific action toolbar (slot rendered by each page). On `xl+` collapse to a single row.
2. **Breadcrumbs:** `Products › Floral Dress (#SKU-1234) › Edit` — driven by the same `resolveAdminPageMeta` lookup, extended to include the parent route.
3. **Distinct treatment of Logout:** ghost button with subdued color, separated by a vertical divider, with a 1-step confirm ("Sign out of admin?"). Refresh stays prominent.
4. **Promote sync time to a dedicated chip:** `Synced 4:21pm · Refresh ↻` so the agent doesn't have to read fine print.
5. **Add a "Today's queue" pill** linking to `Orders?filter=needsAction` (count of unfulfilled paid orders, fetched from existing dashboard metrics endpoint).

### 2.3 Login ([admin/src/components/Login.jsx](admin/src/components/Login.jsx))

**Current pain points**
- No password show/hide.
- Login submit doesn't show a busy state — clicking twice can fire two requests.
- Connection retry button uppercase tracking looks like a label, not a button.
- No "forgot password" or contact path; new support hires are stuck.

**Refactor**
1. Add eye toggle on password field.
2. Disable + spinner on submit during the await.
3. Restyle retry as a real button (`border + bg-white + hover`).
4. Add a static "Need access? Contact ops@…" footer (text only; no backend change).
5. Capslock detection hint (a small `Caps Lock is on` line).
6. Remember last-used email in `localStorage` (already half implemented via the token; extend for email).

---

## 3. Page-by-Page Optimization

> **Format used below:** `Goal · Current state · Pain points · Refactor (numbered, atomic) · Success metric · Backwards-compat note`.

---

### 3.1 Dashboard — [admin/src/pages/Dashboard.jsx](admin/src/pages/Dashboard.jsx)

**Goal:** A 30-second "is the business healthy and what needs attention right now?" view.

**Current state:** 4 summary cards (revenue, orders, customers, inventory), catalog highlights, realtime client integration with 60s fallback poll and 1.2s debounce on Ably events, a hero gradient section.

**Pain points**
1. Cards are passive — they tell numbers but not "what to do now".
2. Realtime status (`liveUpdatesStatus`) is captured in state but not rendered in the UI of the file we read.
3. No drill-down: clicking "5 low-stock products" should jump to `Inventory?filter=low_stock`.
4. No "things requiring action" feed (pending refunds, failed payments, pending review moderations, low-stock SKUs).
5. Background refresh is silent — agents don't know data is fresh.

**Refactor**
1. **Add "Action Center" panel** (top-right of the hero) with 4 counters that link directly to filtered list pages:
   - Orders awaiting fulfillment → `/orders?status=Order Placed,Packing`
   - Reviews pending moderation → `/reviews?status=pending`
   - Low-stock SKUs → `/inventory?filter=low_stock`
   - Failed marketing dispatches → `/marketing?status=failed`
   All counts come from `metrics` already in the response.
2. **Make every metric card a `Link`** to its drill-down page.
3. **Render `liveUpdatesStatus`** as a small live dot ("Live · last event 12s ago" / "Polling · refresh in 47s") next to the page title.
4. **Replace the grand hero gradient** with a calmer header + the Action Center, freeing vertical space.
5. **Add a "Today vs yesterday" delta** to revenue and orders cards (compute from existing trend data; if absent, show a 7-day spark only).
6. **Skeleton on first load** instead of empty fallback.

**Success metric:** From login to opening a pending order: ≤ 2 clicks.
**BC note:** No endpoint changes; only consumes `metrics` already returned by `/api/admin/dashboard`.

---

### 3.2 Products / List — [admin/src/pages/List.jsx](admin/src/pages/List.jsx)

**Goal:** Find and act on any product in seconds.

**Current state:** 4 summary cards, search by name/SKU/category, status + inventory filters, table with edit/delete actions. Delete uses `window.confirm`.

**Pain points**
1. No pagination/virtualization — full catalog loads in memory.
2. No column sort.
3. Deletion via `window.confirm` is OS-styled, easily mis-tapped, no undo.
4. No bulk actions (archive 30 SKUs at once).
5. Search is unthrottled; large catalogs janky.
6. No indication of last-updated timestamp per row, hard to know which entry is stale.
7. Image previews missing in row — agents identify items by photo.

**Refactor**
1. **Replace `<table>` with `DataTable`** (column config, virtualization via `react-window` or simple windowing, sticky header).
2. **Columns (in support priority order):** thumbnail · name + SKU + category · status badge · inventory badge · stock count · price · updatedAt · actions.
3. **Column sort** on stock, price, updatedAt.
4. **Bulk select + bulk action menu:** Archive, Set Draft, Set Active, Export CSV, Bulk Delete (with `ConfirmDialog`, lists affected SKUs, requires typing "DELETE").
5. **Optimistic delete with 8-second toast undo** instead of immediate `fetchList()`.
6. **Debounce search 200ms; persist last filter set** via `usePersistedState`.
7. **Inline quick-edit:** click stock or status cell to edit without leaving the page (reuses the existing `/api/product/inventory` PATCH).
8. **Empty / no-results / error states** via shared components.

**Success metric:** Bulk-archive 50 SKUs in under 30 s.
**BC note:** Same `/api/product/admin-list` and `/api/product/remove`. New bulk endpoint is *not* required — bulk action loops the existing endpoint with progress UI.

---

### 3.3 Inventory — [admin/src/pages/Inventory.jsx](admin/src/pages/Inventory.jsx)

**Goal:** A live spreadsheet feel for stock adjustments.

**Current state:** Per-row drafts of stock + threshold + status, save button per row, four summary cards.

**Pain points**
1. The draft state model is invisible — no visual cue when a row has unsaved changes.
2. Saving one row at a time is tedious during restocks.
3. No "Save all changed" action.
4. No history of recent stock adjustments — agents repeat work.
5. No filter for "has unsaved changes".
6. Threshold is a number input with no helpful unit/explanation.

**Refactor**
1. **Dirty-row indicator:** colored left border + "Unsaved" pill on rows where `hasDraftChanges` is true (helper already exists).
2. **Floating "Save all changes (n)" sticky bar** at the bottom when any row is dirty; uses `Promise.allSettled` against existing PATCH endpoint, shows per-row outcome on failure.
3. **Discard changes** action per row + globally.
4. **Recent adjustments timeline panel** (right side) that lists last 50 successful saves from local session memory; tooltip explains it's session-only.
5. **Keyboard nav inside the cell grid** (arrow keys move between editable cells, Enter saves row).
6. **Threshold helper text** under the input: "Email triggered when stock ≤ this value".
7. **Filter tab "Unsaved changes"** in addition to All/Healthy/Low/Out.
8. **Restock bulk action:** "Add N units to selected rows" multi-edit dialog.

**BC note:** Reuses `/api/product/inventory` PATCH unchanged.

---

### 3.4 Add / Edit Product — [admin/src/components/ProductForm.jsx](admin/src/components/ProductForm.jsx) (used by [admin/src/pages/Add.jsx](admin/src/pages/Add.jsx) and [admin/src/pages/Edit.jsx](admin/src/pages/Edit.jsx))

**Goal:** Reduce abandoned product creations and avoid silent validation drops.

**Pain points (typical for monolithic product forms)**
1. One long form with no progress indicator.
2. No autosave; a network blip loses the entry.
3. Image upload area is undiscoverable beyond the cloud icon.
4. No validation summary at submit; errors land on individual fields the user has scrolled past.
5. Edit mode doesn't show a diff against current saved state.

**Refactor**
1. **Section-based layout with a sticky left "Step rail":** Basics · Media · Pricing · Inventory · Variants/Sizes · Fit · SEO · Publishing.
2. **Autosave drafts to `localStorage`** keyed by product id (or `new`). Surface "Draft saved 4s ago".
3. **Image dropzone overhaul:** larger drop area, drag-to-reorder thumbnails, primary-image toggle, file type/size hints, per-image progress, server-error inline (currently silent on Cloudinary failures).
4. **Inline field validation + a top "Issues to fix (n)" banner** that scrolls to the first invalid field on submit.
5. **Edit mode:** show "Last published by X · 2 days ago" and a "Revert unsaved changes" action.
6. **Sticky publish bar** with `Save as draft`, `Publish`, `Schedule` (if backend supports `scheduledAt`; fall back to `Publish later`).
7. **Confirm-on-leave guard** using `useBlocker` when there are unsaved changes.

**BC note:** Form submits to the same product create/update endpoints; no schema changes needed.

---

### 3.5 Orders — [admin/src/pages/Orders.jsx](admin/src/pages/Orders.jsx)

**Goal:** This is the support team's primary screen. It must be ruthless about clarity.

**Current state:** Heavy file (~1000+ lines visible) with Shiprocket pricing reconciliation logic, status options, dual-base API fallback, realtime client, order merge utils. UI mixes operational data with reconciliation diagnostics.

**Pain points (highest priority across the panel)**
1. Reconciliation/audit logic dominates the page — support agents only need: who, what, payment, status, address, last action.
2. Status changes happen via free-form `<select>` per row; no confirmation, no reason/notes captured.
3. No timeline view per order showing the lifecycle (placed → packed → shipped → out for delivery → delivered) with timestamps.
4. Refunds, cancellations, and Shiprocket re-sync triggers are spread across the row in inconsistent affordances.
5. No filtering by date range, payment status, or customer.
6. Address copy-to-clipboard absent — agents currently triple-click and copy.
7. No printable invoice/packing slip view.
8. Realtime upserts can scroll the agent's row out from under them.

**Refactor**

A. **Split the page into two regions:**
   - **Left:** filter rail (date range · status multi-select · payment status · channel · search by order ID, email, phone, SKU · "Has Shiprocket issue" toggle) + order list (compact, virtualized, one row = orderId · customer · total · status · age).
   - **Right (Drawer or split-pane):** selected order detail.

B. **Order detail panel — sections (in this order, support-first):**
   1. **At-a-glance header** — Order #, placed time, status pill, total, payment method, customer name with click-to-copy email/phone.
   2. **Action toolbar** — Update status (with required reason), Cancel, Refund, Resend confirmation, Print packing slip, Re-sync Shiprocket, Copy summary to clipboard.
   3. **Lifecycle timeline** — vertical list of status events with timestamps and actor.
   4. **Items** — table of line items with thumbnail, size, qty, price, fit metadata badge if any.
   5. **Shipping address** — formatted, with Copy button and "Open in Maps".
   6. **Pricing breakdown** — items, discount (with coupon code), shipping, tax, total. Reconciliation diagnostics moved to a collapsed "Audit & Shiprocket details" accordion at the bottom — visible to admins, defaulted closed for support.
   7. **Notes** — internal notes textarea (uses existing customer notes pattern).

C. **Status changes**:
   - Confirmation dialog for `Cancelled`.
   - Required reason dropdown for `Cancelled` and `Out for delivery → Delivered` reversals.
   - Optimistic update with rollback.

D. **Realtime hygiene**:
   - When the currently-selected order receives a remote update, show a non-intrusive "Updated · Refresh detail" pill instead of replacing data while the agent is typing.
   - Pause realtime list re-sorts when the user is actively filtering or has the drawer open; queue updates with a "n new orders ↻" pill.

E. **Bulk actions on the list:**
   - Mark as packed
   - Print packing slips (n)
   - Export CSV

F. **Saved views:** "Today's pending COD", "Refund requests", "Shiprocket failed" as one-click chips (uses `usePersistedState`).

**Success metric:** Median time-to-status-update per order ≤ 8 s.
**BC note:** Reuses both `/api/order` and `/api/orders` (the page already detects either base, see [admin/src/pages/Orders.jsx](admin/src/pages/Orders.jsx)). No backend change.

---

### 3.6 Customers — [admin/src/pages/Customers.jsx](admin/src/pages/Customers.jsx)

**Goal:** Resolve a support ticket against a customer in one screen.

**Current state:** List + selected detail with notes textarea, segments (all/buyers/wishlist/vip), 4 summary cards.

**Pain points**
1. Search only by name/email/phone — no order ID lookup (the most common support entry point).
2. Detail panel sits alongside the list; on smaller screens the list collapses awkwardly.
3. Notes save is a separate button — easy to forget.
4. No "send password reset" / "resend verification" affordances even though backend supports them.
5. Wishlist and order history mixed without clear tabs.
6. "VIP" segment is hardcoded to ₹5000 — opaque to support; should show the threshold.
7. No timeline of customer events (signup, last login, last order).

**Refactor**
1. **Unified search bar** that accepts: email, phone (E.164 or local), order ID (auto-routes to that order's customer), customer name. Debounced server search if `customers.length > 200` (use existing list endpoint with a query param if available; else client-filter).
2. **Tabs in detail:** Overview · Orders · Wishlist · Addresses · Notes · Activity.
3. **Notes autosave** with 1.5s debounce, "Saved · just now" indicator; keep Save button as explicit fallback.
4. **Action toolbar:** Copy email · Copy phone · Send password reset · Resend verification · Open last order · Loyalty adjustment (links to Loyalty page pre-filtered).
5. **Show segment thresholds** explicitly ("VIP = ≥ ₹5,000 lifetime spend").
6. **Drawer behavior on mobile** — list full-width, detail slides over.
7. **Empty notes state:** "No notes yet — add context that future agents will see when they look up this customer."

**BC note:** All endpoints unchanged.

---

### 3.7 Coupons — [admin/src/pages/Coupons.jsx](admin/src/pages/Coupons.jsx)

**Goal:** Confidently launch and pause promos without breaking pricing.

**Pain points**
1. Form and list share the same screen vertically — for a long coupon list the form is far down.
2. Lifecycle state (live/scheduled/expired/paused) is computed client-side; race conditions with server clock not surfaced.
3. No coupon performance preview (redemptions, revenue, AOV impact) — though `usageCount` exists.
4. No clone-coupon action (agents recreate similar coupons frequently).
5. No "test on cart" preview.
6. Date/time inputs use `datetime-local` with no timezone hint; ambiguous at month-end.

**Refactor**
1. **Two-pane layout:** list left, form right (same as Orders/Customers refactor).
2. **Lifecycle pill** uses server-provided `isActive` + dates; show tooltip "Server time: …" derived from bootstrap.
3. **Performance mini-card** in detail: redemptions, last used at, total discount value (computed from list of orders that used the code if API exposes; else show `usageCount` only).
4. **Clone action** prefills the form with `${code}-COPY` and `isActive=false`.
5. **Test in cart** — opens a new tab to `client/cart?promo=CODE` (no backend change; client already supports this).
6. **Timezone label** "(IST)" next to date inputs and a helper "Customers in other regions see their local times".
7. **Bulk pause** for selected coupons (loops existing endpoint).
8. **Status-change confirmation** when activating a coupon whose end date is in the past (catch the obvious mistake).

**BC note:** Same `/api/coupon/admin/*` endpoints.

---

### 3.8 Loyalty — [admin/src/pages/Loyalty.jsx](admin/src/pages/Loyalty.jsx)

**Goal:** Help agents answer "why does this customer have X points?" and resolve manual adjustments.

**Current state:** Read-only insights — summary cards, tier distribution, top members, top referrers, transactions list.

**Pain points**
1. No filter or search on transactions — useless when investigating a single customer.
2. No way to issue a manual adjustment from this page (despite backend `manual_adjustment` type existing).
3. Top members and top referrers are static lists with no link to the customer detail page.
4. Tier breakdown bars don't show percentages.
5. Empty/error pattern uses bespoke "Loyalty insights are unavailable" markup.

**Refactor**
1. **Search + filter on transactions** by customer email, type, date range.
2. **"Adjust points" dialog** opening from a top action: customer picker + delta (+/-) + reason + audit log entry. POSTs to existing manual_adjustment endpoint.
3. **Link top members & referrers** to `/customers?id=…`.
4. **Add percentage labels** to tier distribution bars and a total members count.
5. **Replace bespoke error UI** with shared `ErrorState`.
6. **Per-customer rewards drawer** opens from any name in the lists, showing point ledger.

**BC note:** Adjustment uses an existing endpoint; if not present, this item moves to a follow-up.

---

### 3.9 Reviews — [admin/src/pages/Reviews.jsx](admin/src/pages/Reviews.jsx)

**Goal:** Clear the moderation queue fast without reading the same review twice.

**Pain points**
1. No keyboard navigation for queue triage.
2. Status change + admin reply are saved together — agents can't quickly approve without composing a reply.
3. No bulk approve/reject.
4. No image preview if the review has photos.
5. No "view on storefront" link for already-published reviews.
6. No filter by rating, by product, by verified-purchase flag.
7. The status `select` defaults to `pending` even after switching reviews if the saving state lingered.

**Refactor**
1. **Keyboard map:** `j/k` next/prev review, `a` approve, `r` reject, `e` focus reply textarea, `s` save.
2. **Two save buttons:** "Approve" / "Reject" act immediately (no reply required); "Save reply" is separate.
3. **Bulk approve / reject** with confirm.
4. **Filter chips:** rating (1–5), verified purchase, has photos, has reply, product (autocomplete).
5. **Image lightbox** for review photos.
6. **"View on storefront"** link for `published`.
7. **Diff guard:** if agent has unsaved reply text and switches review, show a confirm.
8. **Optimistic status change with toast undo** (5 seconds).

**BC note:** Same `/api/review/admin/*`.

---

### 3.10 Marketing — [admin/src/pages/Marketing.jsx](admin/src/pages/Marketing.jsx)

**Goal:** Schedule and dispatch campaigns confidently; diagnose failures fast.

**Pain points**
1. Form and list compete for vertical space again.
2. Body field is plain textarea — no preview of what subscribers receive.
3. Audience options are opaque (`subscribed_users` etc.) — show counts.
4. Activity feed buried below the fold; failures hard to spot.
5. Dispatch button has no "are you sure? this sends to N people" confirmation.
6. No copy-from-existing-campaign action.
7. No A/B awareness or send-time presets.

**Refactor**
1. **Two-pane layout** as elsewhere; add a third slide-out panel "Email preview" with desktop/mobile toggle and a sample customer's data interpolated.
2. **Audience dropdown shows live count** ("Subscribed users · 4,217") fetched from `deliveryConfig` or a new lightweight endpoint if available; fall back to last metrics.
3. **Activity feed** moves to a sticky right rail with status icons (sent/queued/failed) and a filter by campaign.
4. **Dispatch confirmation modal:** "You're about to send 'Spring SS26' to 4,217 subscribers via SES. Send now?" with `Send` and `Schedule for later` choices.
5. **Clone campaign** quick action on each row.
6. **Send-time presets:** Now · In 1 hour · Tomorrow 10am · Custom.
7. **Failure drilldown:** clicking a failed activity row opens a modal with provider error message + retry button.
8. **Plain-text + HTML body toggle** with a character/word count.

**BC note:** Same `/api/marketing/admin/*`.

---

### 3.11 Fit Analytics — [admin/src/pages/FitAnalytics.jsx](admin/src/pages/FitAnalytics.jsx)

**Goal:** Insight page for ML/merch — already in good shape; light polish.

**Pain points**
1. The dark hero gradient is striking but heavy and inconsistent with other pages.
2. No CSV export of breakdowns for offline analysis.
3. No date-range selector; the page implicitly shows "all-time".
4. Trend chart is hand-rolled bars; tooltips minimal.

**Refactor**
1. Tone the hero down to match the rest of the panel (use `PageHeader` with a small accent strip).
2. Add a date-range picker (presets: 7d / 30d / 90d / All) — pass to existing endpoint as a query param if it accepts one; else compute client-side.
3. Add CSV export per breakdown card.
4. Add hover tooltips with absolute counts and percentages on trend bars.
5. Replace bespoke loading + error markup with `LoadingState` / `ErrorState`.

**BC note:** Same `/api/fit/admin/analytics`.

---

## 4. Accessibility, Internationalization, Performance

### 4.1 Accessibility (WCAG 2.1 AA)
- Every interactive element must have an accessible name (audit `<button>` with only icons in `Sidebar.jsx`).
- Focus-visible rings on all controls (currently inconsistent).
- Form fields must have associated `<label>` elements (current `<p>` labels in `Login.jsx`, `Coupons.jsx` form, `Marketing.jsx` form are not associated).
- Color-contrast pass on `text-slate-400` on white (≥ 4.5:1).
- Modals/drawers trap focus and restore on close.
- Tables get `<caption>` / `aria-label`.

### 4.2 Internationalization
- Wrap user-visible strings with a tiny `t()` helper backed by a single JSON dictionary even if only `en-IN` is shipped today. Removes the need for a second pass when the support team in another region onboards.
- Keep `Intl` formatters centralized in `Money` / `DateTime` so locale switches in one place.

### 4.3 Performance
- Routes already lazy-loaded — keep.
- Add `react-window` to long tables (Orders, Inventory, Products).
- Memoize derived selectors (`visibleProducts`, `visibleCustomers`, etc.) — already use `useMemo`; ensure dependency arrays are correct on refactor.
- Co-locate axios calls behind `useAdminQuery` to dedupe parallel requests across components.
- Move date/number formatters out of render where lists exceed 100 items.

---

## 5. Testing Strategy (no functionality regressions)

1. **Snapshot the existing endpoint contracts** by recording the current network calls per page (devtools HAR). Refactored pages must produce the same request shapes.
2. **Component-level tests** with Vitest + React Testing Library for the new shared library (`DataTable`, `ConfirmDialog`, `Drawer`, `EmptyState`, `LoadingState`, `ErrorState`, `StatusBadge`).
3. **Page-level smoke tests** per refactored page: list loads, search filters, primary mutation succeeds with toast, error path shows ErrorState.
4. **Visual regression** on the shared components using Storybook + Chromatic-style snapshots (optional; even local screenshot diffs help).
5. **Manual UAT script** per page given to one support agent — measure clicks-to-resolve before/after for 5 representative tasks.

---

## 6. Phased Rollout (no big-bang deploys)

| Phase | Scope | Why first |
|------|-------|-----------|
| **P1 — Foundations** | §1 shared components, hooks, tokens, toast policy, focus-trap, navbar/sidebar refactor, Login polish | Unblocks every page; visible quality lift on day one |
| **P2 — Daily-ops pages** | §3.5 Orders, §3.6 Customers, §3.9 Reviews | These dominate support time; biggest ROI |
| **P3 — Catalog pages** | §3.2 Products, §3.3 Inventory, §3.4 Add/Edit | Merchandising team benefits; safer to land after P2 stabilizes |
| **P4 — Promotions & insights** | §3.7 Coupons, §3.10 Marketing, §3.1 Dashboard | Lower-frequency usage; refine using lessons from P2/P3 |
| **P5 — Polish** | §3.8 Loyalty, §3.11 Fit Analytics, §4 a11y/i18n/perf, §5 tests | Final cleanup; analytics & accessibility audits |

Each phase ships behind a `?ui=v2` query toggle stored in `localStorage` so the old layout is recoverable for any agent during cutover.

---

## 7. Backwards-Compatibility Checklist (apply per PR)

- [ ] No route removed; legacy redirects (`/list`, `/add`, `/edit/:id`) still resolve.
- [ ] All current API endpoints still called with the same method, path, headers (`token`), and body shape.
- [ ] All toast messages preserved in spirit (success/error wording unchanged unless explicitly improved).
- [ ] Local storage keys preserved (`adminToken` must keep that exact name).
- [ ] No removal of any user-facing field (only re-grouping/relabeling).
- [ ] Server-status / bootstrap polling preserved.
- [ ] Realtime client subscription/unsubscription contract unchanged ([admin/src/services/realtimeClient.js](admin/src/services/realtimeClient.js)).
- [ ] Lazy loading + Suspense fallback intact.
- [ ] Sidebar mobile overlay behavior preserved.
- [ ] Admin auth-expiry interceptor preserved ([admin/src/App.jsx](admin/src/App.jsx#L102-L121)).
- [ ] No new mandatory environment variables.

---

## 8. Open Questions (decide before P2)

1. **Roles?** Do we have a `support` vs `admin` role distinction in the token? If yes, surface role-aware nav (hide Marketing/Coupons for read-only support roles).
2. **Audit log endpoint** — does the server expose actor/timestamp for status changes we can render as "Last edited by"?
3. **Bulk endpoints** — willing to add `/bulk` variants for orders/products/coupons in a future release? Until then, client loops the single-item endpoint with progress UI.
4. **Image CDN** — Cloudinary supports on-the-fly thumbnails; agree on a `w_64,h_64,c_fill` transformation for table thumbnails to keep payload light.
5. **Realtime fan-out for non-Order entities** — should reviews and inventory also push? Until then, document the 60s fallback poll explicitly in the UI.

---

## 9. Definition of Done (per page)

A page-level refactor is **done** when:

1. ✅ Uses only shared `ui/*` primitives for headers, cards, tables, badges, dialogs, toolbars, empty/loading/error.
2. ✅ Has a documented support workflow: "How to do task X on this page" — added to a `SUPPORT_RUNBOOK.md` (out of scope here but planned).
3. ✅ Keyboard shortcuts work and are documented in an in-app `?` cheat-sheet overlay.
4. ✅ Mobile (≥ 360px), tablet, and 1366×768 layouts verified.
5. ✅ Accessibility audit passes (axe-core no critical issues).
6. ✅ All existing endpoints called with same shapes (network HAR diff is empty for non-cosmetic fields).
7. ✅ Toast outcomes consistent (success: 6s auto, error: manual dismiss with copy).
8. ✅ Optimistic-with-rollback pattern applied to every mutation.
9. ✅ Lighthouse perf ≥ 85 on the page.
10. ✅ One support agent has signed off after a 30-minute UAT session.

---

## 10. Quick Reference — File Map of Changes

| File | Type of change |
|------|----------------|
| [admin/src/components/ui/](admin/src/components/ui) | **NEW** shared component library |
| [admin/src/hooks/](admin/src/hooks) | **NEW** shared hooks |
| [admin/src/index.css](admin/src/index.css) | Add design tokens |
| [admin/src/App.jsx](admin/src/App.jsx) | Toast config, command palette mount, role-aware default route |
| [admin/src/components/Sidebar.jsx](admin/src/components/Sidebar.jsx) | Section reorder, always-visible descriptions, traffic-light status, command palette |
| [admin/src/components/Navbar.jsx](admin/src/components/Navbar.jsx) | Two-row layout, breadcrumbs, separate Logout treatment, sync chip, queue pill |
| [admin/src/components/Login.jsx](admin/src/components/Login.jsx) | Show/hide password, busy state, capslock, contact line |
| [admin/src/config/navigation.js](admin/src/config/navigation.js) | Section reorder + new descriptions; preserve existing keys |
| [admin/src/pages/Dashboard.jsx](admin/src/pages/Dashboard.jsx) | Action Center, drill-down links, live status pill, skeletons |
| [admin/src/pages/List.jsx](admin/src/pages/List.jsx) | DataTable, bulk actions, ConfirmDialog, optimistic delete with undo |
| [admin/src/pages/Inventory.jsx](admin/src/pages/Inventory.jsx) | Dirty indicators, save-all bar, keyboard grid nav, bulk restock |
| [admin/src/components/ProductForm.jsx](admin/src/components/ProductForm.jsx) | Stepped layout, autosave, dropzone overhaul, validation summary, sticky publish |
| [admin/src/pages/Orders.jsx](admin/src/pages/Orders.jsx) | Two-pane, drawer detail, lifecycle timeline, audit accordion, status confirm + reason, saved views |
| [admin/src/pages/Customers.jsx](admin/src/pages/Customers.jsx) | Unified search incl. order ID, tabbed detail, autosave notes, action toolbar |
| [admin/src/pages/Coupons.jsx](admin/src/pages/Coupons.jsx) | Two-pane, performance mini-card, clone, timezone hint, sanity confirm |
| [admin/src/pages/Loyalty.jsx](admin/src/pages/Loyalty.jsx) | Transaction filters, manual adjustment dialog, customer drilldown |
| [admin/src/pages/Reviews.jsx](admin/src/pages/Reviews.jsx) | Keyboard triage, split approve/reply, bulk actions, image lightbox |
| [admin/src/pages/Marketing.jsx](admin/src/pages/Marketing.jsx) | Two-pane, email preview, dispatch confirm, audience counts, failure drilldown |
| [admin/src/pages/FitAnalytics.jsx](admin/src/pages/FitAnalytics.jsx) | Tone-down hero, date range, CSV export, shared empty/error |

---

**End of plan.** Treat each numbered item under §3 as a candidate ticket; pair with §6 for sequencing and §7 as the merge gate.
