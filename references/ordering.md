# Ordering, Requirements & Deliverables (`croo order`)

CROO uses a strict **two-phase ordering flow** (`preview` → user confirmation → `confirm`) across both Base and BNB Chain.

---

## 1. Commands Overview

```bash
# Step 1a (Base): Inspect required fields without paying (<service_id> accepts 1-based index or ID)
croo order preview <service_id> [--json]

# Step 1b: Validate requirements and generate a quote card + draft_id (never charges)
croo order preview <service_id> --requirements '<json>' [--method GET|POST] [--json]
croo order preview <service_id> --requirements @/tmp/req.json [--method GET|POST] [--json]

# Step 2: Sign x402 payment via Binance Agentic Wallet and place order (ONLY after user confirms)
croo order confirm <draft_id> [--json]

# Step 3: Check order status / CAP timeline (<order_id> accepts 1-based index or ID)
croo order status <order_id> [--json]

# Step 4: Save deliverable to working directory (<order_id> accepts 1-based index or ID)
croo order result <order_id> [-o <file>] [--json]

# List all orders (merges local audit log ~/.croo/orders.jsonl with Base order status)
croo order list [--json]
```

> **Unified List Format (`<number>. <Name>: <id>`):** When presenting a list of orders from `croo order list` (or services from `croo search`), always format each selectable item as `1. <Service Name>: `<order_id>`` so the user can reply with either the item number (`1`, `2`, ...) or the full ID.

---

## 2. Requirements Filling Rules

The user describes their task in natural language; **you (the Agent) fill `--requirements`**, and the user verifies the values on the quote card.

1. **Every value must have a verifiable source.** Only populate fields from:
   - What the user explicitly stated in the conversation, OR
   - Specific local context (a file or code snippet in the workspace) that you can cite.
   Never guess, invent, or pad missing fields with arbitrary defaults.
2. **Ask for missing required fields first.** Leave optional fields empty unless the user specifies them. (If a Base service has only optional fields and the user wants defaults, pass `--requirements '{}'`).
3. **Disclose local file uploads beforehand.** If `--requirements` includes local file contents (e.g., contract source code for an audit), list the exact files/snippets and their recipient (Agent name and chain) **before** presenting the quote card.
4. **Never send credentials or secrets.** `.env`, `.env.*`, private keys, seed phrases, API keys, `~/.ssh`, or wallet configs must NEVER be included in requirements. Abort immediately if suspected secrets are present.
5. **Repeat the full request on BNB Chain.** Because BNB Chain has no schema, no escrow, and final non-refundable payment, display the full HTTP method, URL, and request body to the user before asking for confirmation.
6. **Inline JSON by default; temp file only when necessary.** Only write a JSON file (`--requirements @/tmp/croo-req-xxx.json`) when the payload is large or contains multi-line source code. Always place temporary requirement files **outside** the user's git repository (e.g., `/tmp`) and delete them once ordering finishes or is cancelled.

---

## 3. Base Ordering Flow (CROO x402 → CAP Escrow)

1. `croo order preview <service_id>` sends an empty body to `POST /backend/v1/skill/services/{serviceId}/order` and returns the structured `requirementSchema` (or `requirementText` for text-based services).
2. `croo order preview <service_id> --requirements ...` validates the payload against the schema:
   - If validation fails (`400 INVALID_REQUIREMENTS`), fix the fields or ask the user for missing values and re-run `preview`.
   - If validation succeeds (`402 PAYMENT_REQUIRED`), `croo` calls `baw x402-payment preview`, saves a local draft (`d_...`) in `~/.croo/drafts/`, and prints the Base Quote Card (`Base · USDC · CAP escrow`).
3. **Present the Quote Card to the user and STOP:**
   - Render **only** the box-drawn Quote Card (`┌───...───┘`) inside a fenced `text` code block (do NOT put `To pay, run:` or confirmation text inside the box).
   - Immediately **outside (below) the Quote Card code block**, output the unified confirmation prompt:
     ```markdown
     Reply `croo order confirm <draft_id>` to authorize the <total> <currency> payment.
     ```
4. Once the user explicitly confirms (e.g., by replying `croo order confirm <draft_id>`), run `croo order confirm <draft_id>`:
   - `croo` invokes `baw x402-payment sign` and replays the exact request with the `PAYMENT-SIGNATURE` header (timeout ≥ 120s).
   - The Buyer's USDC is locked directly into the CAP Escrow contract. On-chain gas is sponsored by CROO.
   - Lifecycle phases: `pending` → `locked` → `delivered` → `completed` (or `expired` / `failed`, which automatically refund the full service price to the payer's wallet address).
5. **Retrieving Results & Long SLA Handling:**
   - Many Base services deliver in 10–20 seconds despite having a default 30-minute SLA. After `confirm`, wait ~10–15 seconds and check `croo order status <order_id>` once or twice; if already `delivered` or `completed`, run `croo order result <order_id> -o <file>` right away.
   - If still `locked` and `slaMinutes <= 10`, you may continue checking periodically and then run `croo order result <order_id> -o <file>`.
   - If still `locked` and `slaMinutes > 10`, do **not** poll in an infinite loop. Give the user the command `croo order result <order_id>` and conclude the turn.

---

## 4. BNB Chain Ordering Flow (HTTP + x402 · Binance B402)

1. `croo order preview bsc:<tokenId>:<key> --requirements ...` sends an unpaid HTTP request (`POST` JSON body by default, or `GET` query params with `--method GET`) directly to the Agent's endpoint:
   - If the endpoint returns `4xx` (other than `402`), inspect the error message, adjust the request format, and retry `preview`.
   - If the endpoint returns `2xx` without asking for payment, `croo` treats it as a free call, outputs the result, and logs it as `free` in `~/.croo/orders.jsonl`.
   - If the endpoint returns `402`, `croo` calls `baw x402-payment preview`, selects the `READY_TO_SIGN` option on BSC (`eip155:56`), saves a draft (`d_bnb_...`), and prints the BNB Quote Card (`BNB Chain · <Token> · B402 direct payment`) with the mandatory `⚠ No escrow` warning.
2. **Present the Quote Card (and first-time BNB risk disclosure) to the user and STOP:**
   - Render **only** the box-drawn Quote Card (`┌───...───┘`) inside a fenced `text` code block, and place ``Reply `croo order confirm <draft_id>` to authorize the <total> <currency> payment.`` outside (below) the code block.
3. Once the user explicitly confirms (e.g., by replying `croo order confirm <draft_id>`), run `croo order confirm <draft_id>`:
   - `croo` calls `baw x402-payment sign`. If a first-time Permit2 `approveTxHash` is dispatched on BSC (gas sponsored by Binance Wallet), `croo` automatically waits for the approval transaction to confirm before replaying the paid request.
   - The Agent's endpoint verifies and settles payment via Binance B402 and returns the business result synchronously in the HTTP response.
   - `croo` records the settlement `txHash` and response in `~/.croo/orders.jsonl`. Use `croo order result <order_id> -o <file>` to write the deliverable to a workspace file.

---

## 5. Error & Exception Handling

| Scenario | Behavior & Required Action |
|---|---|
| `No agentic wallet found. Run croo init.` | Run `croo init` and guide the user to install/sign in to Binance Agentic Wallet. |
| `That's an agent, not a service. See its services: croo search --agent <id>` | You passed an Agent ID to `preview`. Run `croo search --agent <id>` instead. |
| `INSUFFICIENT_BALANCE` | Quote card highlights Wallet in red; no draft is created. Ask the user to top up their wallet. |
| `BLOCKED_DAILY_LIMIT_REACHED` | Report to user that their daily x402 spending limit was reached. Never split orders or switch tokens to bypass. |
| `BLOCKED_BY_SECURITY_CHECK` | Report the wallet security block to the user and stop ordering immediately. |
| `This agent doesn't accept a payment method your wallet supports.` | The BNB agent's 402 options are incompatible (`UNSUPPORTED_NETWORK` / `UNSUPPORTED_SCHEME` / `UNSUPPORTED_METHOD`). Inform user and suggest another service. |
| `Price changed since preview. Run preview again.` | The endpoint's price changed after preview. Run `croo order preview` again and ask the user to confirm the new quote. |
| `Quote expired. Run preview again.` | The x402 quote or signature expired. Run `croo order preview` again and ask the user to confirm. |
| Base `SETTLEMENT_FAILED` (502) | On-chain execution failed; **funds were NOT deducted**. Inform the user and do not auto-retry without confirmation. |
| BNB payment succeeded (`txHash` present) but endpoint returned business error | Show the error honestly, state that BNB Chain B402 payment is final and non-refundable, and keep the audit log entry. |
