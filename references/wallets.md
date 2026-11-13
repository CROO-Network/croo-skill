# Wallet Setup & Protection (`croo init`)

CROO Skill uses **Binance Agentic Wallet** (`baw` CLI) as its sole wallet provider, covering both **Base** (USDC) and **BNB Chain** (USDT / U / USD1 / USDC).

- **Zero private key exposure:** `croo` never generates, imports, or stores private keys or session tokens.
- **Address as identity:** No CROO web account or login is required. Your wallet address is your Buyer identity, and Base SLA refunds automatically return to the paying address.
- **No gas token needed:**
  - On **Base**, on-chain gas is sponsored by CROO and USDC is locked via EIP-3009 `transferWithAuthorization`.
  - On **BNB Chain**, settlement gas is handled by the B402 Facilitator, and first-time Permit2 approval gas is sponsored by Binance Agentic Wallet.

---

## 1. Checking Wallet Status (`croo init`)

```bash
croo init [--json]
```

When signed in, `croo init` displays:
```text
Wallet
  Binance Agentic Wallet   ✓ signed in    0x9f3a…c21b

Balances
  Base       42.00 USDC
  BNB Chain  18.00 USDT

Ready to order on Base and BNB Chain.
```

---

## 2. Installing & Signing In to Binance Agentic Wallet

Distinguish whether `baw` is not installed yet (`NOT_INSTALLED`) or already installed on disk (`UNCONNECTED` / `EXPIRED`):

### Case A: `baw` is not installed (`NOT_INSTALLED`)
1. Show the official install command:
   ```bash
   npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
   ```
   *(Or install the CLI package globally via `npm install -g --allow-scripts=@github/keytar @binance/agentic-wallet`)*
2. Remind the user that they need a Web3 MPC Wallet created in the Binance App first.

### Case B: `baw` is already installed but not signed in (`UNCONNECTED` / `EXPIRED`)
Do not ask the user to reinstall `baw`. Guide them through the two-step sign-in flow:
1. Run `baw auth signin --json` and show the returned **6-digit pairing code** and **authorization link / QR URL** to the user so they can approve in the Binance App.
2. Run `baw auth verify --json` and keep it running until the user confirms authorization in the Binance App.
3. Once verified, run `croo init` to display the public wallet address and Base / BNB Chain balances.

### Wallet Setup Boundaries
- **Setup confirmation ≠ payment confirmation:** Authorizing wallet installation or sign-in only sets up the wallet. After wallet setup or funding completes, always run `croo order preview` to display a fresh Quote Card and obtain a separate explicit payment confirmation before running `croo order confirm`.
- **Decline private keys in chat:** If the user ever offers a private key, seed phrase, or session token in chat, decline to receive it immediately. Explain that `croo` never touches private keys and that payments proceed safely through their connected Binance Agentic Wallet after explicit confirmation.
- **Keep signing payloads internal:** Never expose raw signing payloads (`PAYMENT-SIGNATURE`, `paymentId`, `nonce`, `validAfter`, `validBefore`) in user-facing replies.

---

## 3. Wallet-Side Safety & Quota Errors

Binance Agentic Wallet enforces daily x402 spending limits and real-time security checks:

| Error Code | Meaning | Required Agent Behavior |
|---|---|---|
| `INSUFFICIENT_BALANCE` | Wallet balance on the target chain is below the quote price | Inform the user which token and chain need to be topped up. Do not attempt to confirm. |
| `BLOCKED_DAILY_LIMIT_REACHED` | User's daily x402 spending quota in Binance Agentic Wallet is exhausted | Relay the message as-is. **Never** split orders into smaller amounts to bypass limits. |
| `BLOCKED_BY_SECURITY_CHECK` | Binance security check flagged the recipient or payment as risky | Relay the warning as-is and abort the order immediately. |
| Session Expired (`UNCONNECTED` / `EXPIRED`) | Wallet authorization session expired | Ask the user to re-authorize in the Binance App and run `croo init` again. |
