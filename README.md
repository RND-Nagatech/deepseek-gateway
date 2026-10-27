# DeepSeek Monitor

Local dashboard and proxy gateway for tracking DeepSeek token usage and estimating costs by client.

The project has two separate apps:

- `backend/` — NestJS on Fastify, MongoDB storage, admin API, and the DeepSeek proxy.
- `frontend/` — React and Vite dashboard.

For instructions on moving existing DeepSeek clients behind the gateway, see [MIGRASI_KE_GATEWAY.md](MIGRASI_KE_GATEWAY.md).
For balance and usage endpoints for other applications, see [openapi.yaml](openapi.yaml).

## Requirements

- Node.js 22 or newer
- MongoDB running on `127.0.0.1:27017`

The backend connects to `mongodb://127.0.0.1:27017/deepseek_monitor` without MongoDB credentials by default.

## Start locally

From the repository root (the directory containing this file):

```sh
npm install --include=optional
npm run dev
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174). The local dashboard token is `local-dev-token`.

The backend health endpoint is [http://127.0.0.1:3002/api/health](http://127.0.0.1:3002/api/health). It reports whether MongoDB is connected.

## Try the full flow without a DeepSeek account

Run the local mock provider, backend, and dashboard together:

```sh
npm run dev:demo
```

Open the dashboard, sign in with `local-dev-token`, register a client using the exact demo key `sk-local-demo`, then add at least Rp10 to that key's balance. This key is accepted only by the local mock provider; do not use it as a real DeepSeek credential. Set that client's API base URL to `http://127.0.0.1:3002/api/proxy` and send a request:

```sh
curl http://127.0.0.1:3002/api/proxy/chat/completions \
  -H 'Authorization: Bearer sk-local-demo' \
  -H 'Content-Type: application/json' \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"Halo"}]}'
```

The mock returns 120 input tokens (40 cache hit and 80 cache miss) plus 80 output tokens. At Rp50,000 per 1M tokens the dashboard should show 200 billable tokens, a Rp10 charge, and the same deduction from that key's balance. Add `"stream":true` to the JSON body and use `curl -N` to try streamed responses. `npm run dev` connects to the real DeepSeek API; `npm run dev:demo` sends requests only to the local mock.

Optional backend settings are listed in `backend/.env.example`. Copy it to `backend/.env` to change the host/port, MongoDB URI, DeepSeek base URL, dashboard token, key fingerprint secret, starting rate, or SingaPay credentials. To let clients on another machine reach the gateway, set `HOST=0.0.0.0`, then use this machine's LAN address in their DeepSeek base URL. Keep `KEY_HASH_SECRET` stable after registering keys; changing it makes existing fingerprints unmatchable.

## Register a client key

In **Client & key**, enter a readable client name and the DeepSeek key the client already uses. Each key starts at Rp0 and needs a balance of at least Rp10 before it can pass the gateway. Top-ups are whole rupiah amounts, from Rp1 to Rp1,000,000,000 per deposit. If the balance is below Rp10, the gateway records the rejected attempt and returns HTTP 402 with `INSUFFICIENT_PREPAID_BALANCE` without contacting DeepSeek. Confirmed usage is deducted from that key's balance. The backend stores an HMAC fingerprint and a masked hint, not the raw key. The raw value is used only to recognize an incoming request and forward it to DeepSeek. Authorization headers are not written to request history.

Token usage is reported by DeepSeek after a request finishes. A request may start whenever the key has at least Rp10, even if its final charge is higher than the current balance. For example, a Rp120 charge against Rp100 leaves a balance of -Rp20. Top-ups add to the current balance, and requests remain blocked until it reaches Rp10. Requests whose token usage is missing remain marked as unpriced and are not deducted because their cost cannot be determined.

Then set that client's DeepSeek SDK/base URL to the gateway, for example:

```text
http://127.0.0.1:3002/api/proxy
```

The SDK appends its normal endpoint path, such as `/chat/completions` or `/responses`. The gateway records the request and streams the provider response back to the caller. Token usage is taken from DeepSeek's response when present; cache hit and cache miss are shown as input details and are not counted a second time.

Requests must pass through the gateway to appear in this dashboard. This development server binds to loopback by default. Before making it reachable by other machines, set a strong `ADMIN_TOKEN` and `KEY_HASH_SECRET`, use TLS, and restrict access to the dashboard/admin API.

## Top up a key with SingaPay

Copy the `SINGAPAY_*` settings from `backend/.env.example` into `backend/.env`, then set the client ID, client secret, partner ID, and receiving account ID issued for your merchant. The configured base URL defaults to the SingaPay sandbox; change it to `https://payment-b2b.singapay.id` only after the merchant is ready for production. A custom HTTPS reverse-proxy URL with a path prefix is also supported, for example `https://singapay.nagatech.id/sandbox`; API routes are appended below that prefix. Never put these credentials in the frontend or commit them.

Register `https://deepseek.nagatech.id/api/webhooks/singapay` as the merchant's transaction callback URL. The reverse proxy must preserve the `/api/webhooks/singapay` path. The dashboard can create QRIS or a temporary, one-use, fixed-amount Virtual Account for a key. VA top-ups start at Rp10,000; bank availability follows the merchant's SingaPay activation. Neither method changes balance until a signed callback confirms the payment. **Penyesuaian manual** remains an immediate admin-only credit and records its reason.

The backend uses the HMAC-SHA512 headers shown by SingaPay's Access Token v1.1 documentation. SingaPay's webhook page gives conflicting instructions for hashing the callback body, so the verifier accepts either its documented recursively sorted JSON form or the raw-body form while still requiring a valid HMAC signature. Verify both authentication and callback behavior with the merchant's sandbox account before switching to production.

SingaPay's connectivity probe body (`status: 200`, `success: true`, `data: "VA Payment Notification testing"`) is acknowledged with `200` and `{ "status": "success" }` because it contains no transaction. Actual transaction callbacks still require valid SingaPay signature headers before they can be processed.

If payment creation fails upstream, the dashboard error includes a log reference. Match it against the backend's NestJS application logs; the log records the upstream HTTP status and a sanitized response summary, not credentials or signatures.

## Read balance and usage from another application

The self-service API requires a separate **integration API key**. In **Client & key**, create one for the specific DeepSeek key that the client will top up. The dashboard shows the secret once; copy it directly to the consuming application's server-side secret manager. Only its HMAC hash and a masked hint are stored. Creating it again rotates the credential and immediately invalidates the previous one; revoking it leaves the DeepSeek proxy key and its balance intact. Revoking the DeepSeek key also revokes its integration credential.

**Migration:** `/api/v1/me/*` now rejects the original DeepSeek API key. Existing consumers must create an integration API key in the dashboard and replace the credential configured in their backend. Requests to `/api/proxy/*` continue to use the original DeepSeek API key.

This credential is restricted to the paired key's balance, usage, and top-up endpoints. It cannot be used as a DeepSeek key with `/api/proxy`. Keep it on a trusted server; browser JavaScript must call the client's own backend instead of receiving this secret.

Authenticate with `Authorization: Bearer <INTEGRATION_API_KEY>` or the `X-Integration-Key` header. The OpenAPI security schemes document both options.

- GET /api/v1/me/balance returns the current rupiah balance, latest top-up, and whether the key can make a request. A balance below Rp10 is blocked by the proxy; a later usage charge can make the balance negative.
- POST /api/v1/me/topups creates a QRIS payment attempt. POST /api/v1/me/topups/va creates a temporary VA; send `amountIdr` (minimum 10,000) and a documented `bankCode`. Both require a unique `Idempotency-Key`, and neither credits balance before a verified callback.
- GET /api/v1/me/topups lists payment attempts; GET /api/v1/me/topups/active returns the latest payment that still needs attention; GET /api/v1/me/topups/{merchantRef} returns status and method-specific details such as QR data or VA number.
- POST /api/v1/me/topups/{merchantRef}/reconcile asks SingaPay for the existing payment status. It never creates another payment and can credit a confirmed payment once, including a late payment after expiry.
- POST /api/v1/me/topups/{merchantRef}/retry checks SingaPay again and returns existing payment details if found. It creates a replacement only after a complete search confirms the old payment is absent or expired; ambiguous or incomplete searches are blocked. Use a new Idempotency-Key for each recovery attempt.
- GET /api/v1/me/usage/summary returns request/status totals, token totals, cost, and a daily series. It defaults to the last 30 days.
- GET /api/v1/me/usage returns individual request records. Use limit (up to 100), optional ISO 8601 from/to filters (to is exclusive), and the returned nextCursor to fetch more records.

For example, set `GATEWAY_URL` to `https://deepseek.nagatech.id` and `INTEGRATION_API_KEY` to the secret generated in **Client & key**, then call:

    curl "$GATEWAY_URL/api/v1/me/balance" \
      -H "Authorization: Bearer $INTEGRATION_API_KEY"
    curl "$GATEWAY_URL/api/v1/me/usage/summary" \
      -H "Authorization: Bearer $INTEGRATION_API_KEY"
    curl "$GATEWAY_URL/api/v1/me/topups" \
      -H "Authorization: Bearer $INTEGRATION_API_KEY" \
      -H 'Idempotency-Key: qris-attempt-20261027-001' \
      -H 'Content-Type: application/json' \
      -d '{"amountIdr":50000}'
    curl "$GATEWAY_URL/api/v1/me/topups/va" \
      -H "Authorization: Bearer $INTEGRATION_API_KEY" \
      -H 'Idempotency-Key: va-attempt-20261027-001' \
      -H 'Content-Type: application/json' \
      -d '{"amountIdr":50000,"bankCode":"BCA"}'

The create response includes `merchantRef`, `status`, `expiresAt`, and method-specific details: render the `qrData` string as a QR image, or show `bankName`, `bankCode`, `vaNumber`, and the exact amount. A created payment is not a credited balance. Poll `GET /api/v1/me/topups/{merchantRef}` or call `POST /api/v1/me/topups/{merchantRef}/reconcile` if the callback is delayed, then refresh `/api/v1/me/balance` after status becomes `paid`.

Use the same `Idempotency-Key` when repeating a create request after a timeout. Before creating a new attempt, inspect `/api/v1/me/topups/active`; do not issue a replacement while the previous payment may still be payable. The `/retry` operation performs SingaPay checks and blocks ambiguous or incomplete lookups. Full limits, bank codes, response schemas, and error codes are in [openapi.yaml](openapi.yaml).

## Pricing

The default rate is Rp50,000 per 1,000,000 tokens. The tariff uses `input + output`; cache hit and cache miss break down input. The price applied to each completed request is stored with its usage event so later tariff changes affect new requests only.

## Verify the project

```sh
npm test
npm run build
```

Tests cover usage normalization, cache hit/miss totals, pricing arithmetic, and parsing usage from both DeepSeek streaming formats.
