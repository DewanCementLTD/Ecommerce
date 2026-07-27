# Phase 2 — Cart, Orders & Customers

**Goal:** a visitor can place an order; the client can manage it. Manual/COD only — **no payment gateway code of any kind.**
**Estimated:** 3–4 weeks. Branch: `phase-2-orders`.

---

## Task 1 — Schema (`006_commerce.sql`)

| Table | Columns |
|---|---|
| `customers` | id, company_id, email, phone, name, pass_hash (nullable — guests have none), is_active, accepts_marketing, created_at |
| `addrs` | id, company_id, customer_id, label, name, phone, line1, line2, city, area, notes, is_default |
| `carts` | id, company_id, token (uuid, cookie), customer_id (nullable), currency, created_at, updated_at, expires_at |
| `cart_items` | id, company_id, cart_id, variant_id, qty, price_snap, created_at |
| `orders` | id, company_id, number, customer_id, status, name, email, phone, address (JSON snapshot), note, subtotal, discount, total, currency, lang, placed_at, updated_at |
| `order_items` | id, company_id, order_id, variant_id, sku, name_snap, opts_snap, price_snap, qty, line_total |
| `order_log` | id, company_id, order_id, from_status, to_status, admin_id, note, created_at |

Design rules:

- **Snapshot everything on the order.** Product name, options, price, and address are copied in at order time. If the client later renames or reprices a product, historical orders must not change. This is the single most common e-commerce data bug — get it right.
- `orders.number` is a human-friendly per-company sequence (`#1001`, `#1002`), generated inside the order transaction. Unique per company, not globally.
- `status` is a strict enum: `new | confirmed | delivered | cancelled`. Enforce allowed transitions in the service layer (`new→confirmed→delivered`, anything → `cancelled`). No free-text statuses.
- **No payments table. No gateway fields. No transaction ids.** Do not add "just in case" columns.

---

## Task 2 — Cart API

- Cart identified by an httpOnly cookie token; merges into the customer's cart on login.
- `GET /shop/cart`, `POST /shop/cart/items`, `PATCH /shop/cart/items/:id`, `DELETE /shop/cart/items/:id`, `DELETE /shop/cart`.
- Every read revalidates: variant still exists, is active, is in stock, and the current price. If price changed, update the line and flag it in the response so the UI can tell the shopper honestly.
- Stock check on add and at checkout. Never allow ordering more than `stock`.
- Expire abandoned carts after 30 days (a scheduled cleanup job).

---

## Task 3 — Checkout & orders

`POST /shop/checkout`:

1. Validate cart is non-empty and every line is still valid and in stock.
2. Validate customer details (name, phone, address) with zod. Phone validation must be locale-tolerant, not US-only.
3. In **one transaction**: create/find the customer, create the order + items with snapshots, decrement `variants.stock`, write `order_log`, clear the cart.
4. Send confirmation email to the customer and a notification to the store's configured address, both in the order's language.
5. Return the order number and a confirmation payload.

Guard against double submission with an idempotency key. Rate-limit checkout per IP.

Client-side order management:
- `GET /orders` — list with status filter, search by number/phone/name, date range, pagination
- `GET /orders/:id`
- `PATCH /orders/:id/status` — validated transition, optional note, writes `order_log`, sends a status email
- `PATCH /orders/:id` — edit note and contact details only, never historical prices
- `GET /orders/export` — CSV

Customer accounts: register, login, `GET /shop/account/orders`, address book CRUD. Guest checkout stays fully supported — never force registration.

---

## Task 4 — Storefront checkout UI

Mobile-first, single page, no multi-step wizard — this is a COD checkout, keep it to one screen:

- cart review with editable quantities,
- contact + address form (saved addresses prefilled for logged-in customers),
- order note,
- clear total,
- one primary action: "Place order",
- confirmation screen with the order number and what happens next ("We'll call you to confirm").

Copy rules: the button says what happens. No "Submit". Errors explain how to fix. The confirmation must not imply payment was taken.

Also build: cart drawer, add-to-cart with feedback, sticky mobile add-to-cart on product pages, out-of-stock states.

---

## Task 5 — Client dashboard

Not a wall of charts. Answer the four questions a shop owner actually asks:

1. What came in today? — orders count + revenue, today / 7 days / 30 days, with the prior-period delta.
2. What needs my attention? — new orders awaiting confirmation, low-stock variants (threshold in settings), out-of-stock products.
3. What's selling? — top 10 products by quantity for the period.
4. A simple revenue line chart for the selected period.

All queries indexed and tested at 50k orders. Compute in SQL, not in JS.

---

## Task 6 — Transactional email

Templates: order confirmation, status changed, order cancelled, welcome, password reset, plus a plain admin "new order" notification. Per-company sender name, logo and colors pulled from settings. All templates localized with fallback. Use a provider adapter so the provider is swappable via env. Emails must render on mobile clients and degrade to plain text.

---

## Phase exit criteria

- [ ] Full journey works on a phone: browse → add to cart → checkout → order appears in the client admin.
- [ ] Stock decrements correctly; concurrent checkouts on the last item can't oversell (test it with parallel requests).
- [ ] Renaming or repricing a product does not alter any existing order.
- [ ] Status transitions are enforced and logged; invalid transitions are rejected.
- [ ] Emails arrive in the right language with the right branding.
- [ ] Zero payment-gateway code exists in the repo.
- [ ] Isolation suite green, including orders and customers.

Write `docs/PHASE-2-REPORT.md`.
