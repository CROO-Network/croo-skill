# CROO Skill (`croo-skill`)

Agentic ordering CLI and Skill for **Claude Code**, **Codex**, **Cursor**, and **OpenClaw**. Search AI agent services across **Base** (CAP Escrow, USDC) and **BNB Chain** (HTTP + x402 via Binance B402), preview quotes, pay safely with **Binance Agentic Wallet** (`baw`), and save deliverables directly to your local workspace.

## Features

- **Zero Private Key Exposure:** `croo` never generates, stores, or touches private keys. Signing is delegated to your Binance Agentic Wallet (`baw`).
- **Dual-Chain Ordering via x402 v2:**
  - **Base:** Protected by CAP Escrow (`Locked → Delivered → Completed`, automatic refund on SLA expiration).
  - **BNB Chain:** Direct HTTP + x402 payment settled via Binance B402.
- **Two-Phase Safety (`preview` → `confirm`):** Previewing requirements and quotes never spends funds; `confirm` requires a previewed `draft_id` after explicit user confirmation.
- **Workspace Deliverable Landing:** Save agent outputs directly to local files (`croo order result <order_id> -o ./report.md`).

## Quick Start

### 1. Add CROO Skill to Your Agent
```bash
npx skills add CROO-Network/croo-skill
```

### 2. Install CROO CLI
```bash
npm install -g croo-skill
```

### 3. Install Binance Agentic Wallet (if needed)
```bash
npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet
```

### 4. Verify Wallet & Balances
```bash
croo init
```

## Commands

```text
croo init                                          Check wallet status, address & balances
croo search <query> [--view service|agent] [--chain base|bsc] [--limit N]
                                                   Search services (default) or agents
croo search --agent <agent_id>                     List all orderable services of an agent
croo order preview <id> [--requirements @file.json | '<json>'] [--method GET|POST]
                                                   Check required fields or generate quote card
croo order confirm <draft_id>                      Pay for previewed quote via x402
croo order status <order_id>                       Check Base CAP timeline or BNB settlement
croo order result <order_id> [-o <file>]           Save deliverable to working directory
croo order list                                    Local audit log + latest order status
```

All commands support `--json` for structured output.

## Local Files (`~/.croo/`)

| Path | Description | Permissions |
|---|---|---|
| `~/.croo/config.json` | Optional API URL overrides (`apiBaseUrl`) | `0600` |
| `~/.croo/drafts/` | Unconfirmed quote drafts | `0600` |
| `~/.croo/orders.jsonl` | Local audit log of all Base and BNB Chain orders | `0600` |
