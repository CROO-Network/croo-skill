import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setFetchImpl } from '../src/api.js';
import { dispatchCli } from '../src/cli.js';
import { parseRequirementsInput } from '../src/commands/order.js';
import { readOrderLogs } from '../src/config.js';
import { BawNotInstalledError, setBawExecutor } from '../src/wallet.js';

describe('CROO CLI (init, search, order)', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'croo-test-'));
    process.env.CROO_HOME = tmpHome;
    process.env.CROO_API_URL = 'https://api.croo.network';
  });

  afterEach(() => {
    setBawExecutor(null);
    setFetchImpl(null);
    fs.rmSync(tmpHome, { recursive: true, force: true });
    delete process.env.CROO_HOME;
    delete process.env.CROO_API_URL;
  });

  it('croo init shows installation instructions when baw is not installed', async () => {
    setBawExecutor(async () => {
      const err = new Error('spawn baw ENOENT') as Error & { code?: string };
      err.code = 'ENOENT';
      throw err;
    });

    const { output, exitCode } = await dispatchCli(['init']);
    expect(exitCode).toBe(0);
    expect(output).toContain(
      'No agentic wallet found. croo pays with your Binance Agentic Wallet; it never holds your keys.'
    );
    expect(output).toContain(
      'npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet'
    );
  });

  it('croo init shows signed-in wallet address and Base / BNB Chain balances', async () => {
    setBawExecutor(async (args) => {
      if (args[0] === 'wallet' && args[1] === 'status') {
        return {
          stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
          stderr: '',
        };
      }
      if (args[0] === 'wallet' && args[1] === 'address') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              addresses: [
                { binanceChainId: '8453', chainName: 'Base', address: '0x9f3a11112222333344445555666677778888c21b' },
                { binanceChainId: '56', chainName: 'BSC', address: '0x9f3a11112222333344445555666677778888c21b' },
              ],
            },
          }),
          stderr: '',
        };
      }
      if (args[0] === 'wallet' && args[1] === 'balance') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: [
              {
                symbol: 'USDC',
                address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                binanceChainId: '8453',
                balance: '42',
              },
              {
                symbol: 'USDT',
                address: '0x55d398326f99059fF775485246999027B3197955',
                binanceChainId: '56',
                balance: '18.5',
              },
            ],
          }),
          stderr: '',
        };
      }
      throw new BawNotInstalledError();
    });

    const { output, exitCode } = await dispatchCli(['init']);
    expect(exitCode).toBe(0);
    expect(output).toContain('Binance Agentic Wallet   ✓ signed in    0x9f3a…c21b');
    expect(output).toContain('Base       42.00 USDC');
    expect(output).toContain('BNB Chain  18.50 USDT');
    expect(output).toContain('Ready to order on Base and BNB Chain.');
  });

  it('croo search formats Service view, Agent view, Agent drill-down, and --json accurately', async () => {
    setBawExecutor(async () => ({
      stdout: JSON.stringify({ success: true, data: { status: 'UNCONNECTED' } }),
      stderr: '',
    }));

    setFetchImpl(async (input) => {
      const url = new URL(String(input));
      const view = url.searchParams.get('view');
      const agentId = url.searchParams.get('agentId');

      if (agentId === 'agent-014') {
        return new Response(
          JSON.stringify({
            view: 'service',
            agent: {
              type: 'agent',
              chain: 'base',
              agentId: 'agent-014',
              name: 'AuditGuard',
            },
            items: [
              {
                type: 'service',
                chain: 'base',
                serviceId: 'svc_a91c',
                name: 'Quick Scan',
                agentId: 'agent-014',
                agentName: 'AuditGuard',
                settlement: 'cap_escrow',
                currency: 'USDC',
                price: '5000000',
                slaMinutes: 10,
                orders: 1802,
                url: 'https://croo.network/agent/agent-014',
              },
              {
                type: 'service',
                chain: 'base',
                serviceId: 'svc_a91d',
                name: 'Full Audit',
                agentId: 'agent-014',
                agentName: 'AuditGuard',
                settlement: 'cap_escrow',
                currency: 'USDC',
                price: '120000000',
                slaMinutes: 1440,
                orders: 214,
                url: 'https://croo.network/agent/agent-014',
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (view === 'agent') {
        return new Response(
          JSON.stringify({
            view: 'agent',
            agent: null,
            items: [
              {
                type: 'agent',
                chain: 'base',
                agentId: 'agent-014',
                name: 'AuditGuard',
                orders: 3210,
                completion: 0.987,
                volumeUsd: '48210.00',
                fromPriceUsd: '2.00',
                url: 'https://croo.network/agent/agent-014',
              },
              {
                type: 'agent',
                chain: 'bsc',
                agentId: 'bsc:20417',
                name: 'BNBSecBot',
                score: 512,
                feedbackCount: 341,
                url: 'https://8004scan.io/agents/bsc/20417',
              },
            ],
          }),
          { status: 200 }
        );
      }

      return new Response(
        JSON.stringify({
          view: 'service',
          agent: null,
          items: [
            {
              type: 'service',
              chain: 'base',
              serviceId: 'svc_7f2a',
              name: 'Daily Whale Alert Report',
              agentId: 'agent-001',
              agentName: 'WhaleTracker',
              settlement: 'cap_escrow',
              currency: 'USDC',
              price: '3000000',
              slaMinutes: 30,
              orders: 1234,
              url: 'https://croo.network/agent/agent-001',
            },
            {
              type: 'service',
              chain: 'bsc',
              serviceId: 'bsc:153828:web',
              name: 'Whale scan API',
              agentId: 'bsc:153828',
              agentName: 'BNBWhaleRadar',
              settlement: 'b402_direct',
              endpoint: 'https://api.bnbwhale.xyz/scan',
              price: '',
              score: 436,
              feedbackCount: 207,
              url: 'https://8004scan.io/agents/bsc/153828',
            },
          ],
        }),
        { status: 200 }
      );
    });

    // 1. Default service view
    const svcRes = await dispatchCli(['search', 'whale tracking']);
    expect(svcRes.exitCode).toBe(0);
    expect(svcRes.output).toContain('[1] WhaleTracker · Daily Whale Alert Report');
    expect(svcRes.output).toContain('[Base · USDC]');
    expect(svcRes.output).toContain('Price 3.00 USDC / call · SLA < 30 min · Orders 1,234');
    expect(svcRes.output).toContain('Needs Binance Agentic Wallet');
    expect(svcRes.output).toContain('Price shown at preview · Direct payment via B402, no escrow');
    expect(svcRes.output).toContain('id: bsc:153828:web');

    // 2. Agent view
    const agentRes = await dispatchCli(['search', 'smart contract audit', '--view', 'agent']);
    expect(agentRes.exitCode).toBe(0);
    expect(agentRes.output).toContain('Orders 3,210 · Completion 98.7% · Volume 48,210 USD · From 2.00 USD');
    expect(agentRes.output).toContain('Reply with an agent id to see all of its services.');

    // 2b. Agent view --json includes both snake_case and API camelCase fields
    const agentJsonRes = await dispatchCli([
      'search',
      'smart contract audit',
      '--view',
      'agent',
      '--json',
    ]);
    const parsedJson = JSON.parse(agentJsonRes.output);
    expect(parsedJson.items[0].volume_usd).toBe('48210.00');
    expect(parsedJson.items[0].from_price_usd).toBe('2.00');
    expect(parsedJson.items[0].display_line).toBe('1. AuditGuard: agent-014');
    expect(parsedJson.items[1].feedback_count).toBe(341);
    expect(parsedJson.items[1].display_line).toBe('2. BNBSecBot: bsc:20417');

    // 3. Agent drill-down with aligned Price / SLA / Orders columns (by agent_id or by 1-based index)
    const drillRes = await dispatchCli(['search', '--agent', '1']);
    expect(drillRes.exitCode).toBe(0);
    expect(drillRes.output).toContain('AuditGuard · 2 services');
    expect(drillRes.output).toContain(
      '[1] Quick Scan        Price 5.00 USDC / call   · SLA < 10 min · Orders 1,802   id: svc_a91c'
    );
    expect(drillRes.output).toContain(
      '[2] Full Audit        Price 120.00 USDC / call · SLA < 24 h   · Orders 214     id: svc_a91d'
    );

    // 4. Attempting to preview an Agent ID should advise using `croo search --agent <id>`
    const previewAgent = await dispatchCli(['order', 'preview', 'agent-014']);
    expect(previewAgent.output).toBe(
      "That's an agent, not a service. See its services: croo search --agent agent-014"
    );
  });

  it('Base order flow: missing fields -> quote preview -> confirm -> status -> result', async () => {
    setBawExecutor(async (args) => {
      if (args[0] === 'wallet' && args[1] === 'status') {
        return {
          stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'preview') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentId: 'pay-uuid-1',
              options: [
                {
                  index: 1,
                  status: 'READY_TO_SIGN',
                  reasons: [],
                  scheme: 'exact',
                  assetTransferMethod: 'eip3009',
                  binanceChainId: '8453',
                  tokenSymbol: 'USDC',
                  amount: '3',
                  currentBalance: '42',
                  payTo: '0x1111111111111111111111111111111111111111',
                  userWalletAddress: '0x9f3a11112222333344445555666677778888c21b',
                  needApproveFirst: false,
                  originalAccept: {
                    scheme: 'exact',
                    network: 'eip155:8453',
                    amount: '3000000',
                    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                    payTo: '0x1111111111111111111111111111111111111111',
                    maxTimeoutSeconds: 300,
                  },
                },
              ],
            },
          }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'sign') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentHeaderName: 'PAYMENT-SIGNATURE',
              paymentHeaderValue: 'base64-sig-payload',
              approveTxHash: null,
              binanceChainId: null,
              signatureExpiresAt: Math.floor(Date.now() / 1000) + 300,
            },
          }),
          stderr: '',
        };
      }
      return { stdout: JSON.stringify({ success: true, data: {} }), stderr: '' };
    });

    setFetchImpl(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/services/svc_7f2a/order')) {
        const body = init?.body ? String(init.body) : '';
        const sigHeader = (init?.headers as Record<string, string>)?.['PAYMENT-SIGNATURE'];

        if (!body) {
          return new Response(
            JSON.stringify({
              code: 400,
              reason: 'INVALID_REQUIREMENTS',
              message: 'requirements validation failed',
              metadata: {
                serviceName: 'Daily Whale Alert Report',
                requirementType: 'schema',
                requirementText: '',
                requirementSchema: [
                  {
                    name: 'threshold',
                    type: 'number',
                    required: true,
                    description: 'Minimum USDC transfer size',
                  },
                  {
                    name: 'chains',
                    type: 'array',
                    itemType: 'string',
                    required: true,
                    description: 'Chains to monitor',
                  },
                ],
                errors: [{ field: 'threshold', reason: 'missing_required' }],
              },
            }),
            { status: 400 }
          );
        }

        if (!sigHeader) {
          return new Response(
            JSON.stringify({
              code: 402,
              reason: 'PAYMENT_REQUIRED',
              x402Version: 2,
              accepts: [
                {
                  scheme: 'exact',
                  network: 'eip155:8453',
                  amount: '3000000',
                  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                  payTo: '0x1111111111111111111111111111111111111111',
                  maxTimeoutSeconds: 300,
                },
              ],
              quote: {
                serviceName: 'Daily Whale Alert Report',
                agentName: 'WhaleTracker',
                currency: 'USDC',
                price: '3000000',
                gas: '0',
                total: '3000000',
                slaMinutes: 30,
              },
            }),
            { status: 402 }
          );
        }

        const paymentRespB64 = Buffer.from(
          JSON.stringify({
            success: true,
            transaction: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          })
        ).toString('base64');

        return new Response(
          JSON.stringify({
            orderId: '8b1e6c1e-1111-2222-3333-444455556666',
            phase: 'locked',
            status: 'paid',
            chain: 'base',
            payer: '0x9f3a11112222333344445555666677778888c21b',
            price: '3000000',
            lockTxHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            slaDeadline: '2026-11-09T16:00:00Z',
          }),
          {
            status: 200,
            headers: { 'Payment-Response': paymentRespB64 },
          }
        );
      }

      if (url.endsWith('/orders/8b1e6c1e-1111-2222-3333-444455556666')) {
        return new Response(
          JSON.stringify({
            orderId: '8b1e6c1e-1111-2222-3333-444455556666',
            phase: 'completed',
            status: 'completed',
            chain: 'base',
            serviceId: 'svc_7f2a',
            serviceName: 'Daily Whale Alert Report',
            agentId: 'agent-001',
            agentName: 'WhaleTracker',
            payer: '0x9f3a11112222333344445555666677778888c21b',
            price: '3000000',
            requirements: { threshold: 100000, chains: ['base', 'ethereum'] },
            createdAt: '2026-11-09T15:00:00Z',
            slaDeadline: '2026-11-09T15:30:00Z',
            timeline: [
              { phase: 'created', occurredAt: '2026-11-09T15:00:02Z', txHash: '0x111' },
              { phase: 'paid', occurredAt: '2026-11-09T15:00:05Z', txHash: '0x222' },
              { phase: 'delivered', occurredAt: '2026-11-09T15:05:10Z', txHash: '0x333' },
              { phase: 'cleared', occurredAt: '2026-11-09T15:05:20Z', txHash: '0x444' },
            ],
            delivery: {
              deliverableType: 'text',
              deliverableText: '# Whale Report\n3 large transfers detected.',
              deliverableSchema: '',
              submittedAt: '2026-11-09T15:05:10Z',
            },
            refund: null,
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    // Step 1: Preview without requirements -> missing fields (without noisy validation error block)
    const missingRes = await dispatchCli(['order', 'preview', 'svc_7f2a']);
    expect(missingRes.exitCode).toBe(0);
    expect(missingRes.output).toContain('Missing required fields for "Daily Whale Alert Report":');
    expect(missingRes.output).toContain('threshold');
    expect(missingRes.output).toContain('string[]');
    expect(missingRes.output).not.toContain('Validation errors:');

    // Step 2: Preview with requirements -> quote card + draft id
    const previewRes = await dispatchCli([
      'order',
      'preview',
      'svc_7f2a',
      '--requirements',
      '{"threshold":100000,"chains":["base","ethereum"]}',
    ]);
    expect(previewRes.exitCode).toBe(0);
    expect(previewRes.output).toContain('WhaleTracker · Daily Whale Alert Report');
    expect(previewRes.output).toContain('Base · USDC · CAP escrow');
    expect(previewRes.output).toContain('Price     3.00 USDC');
    expect(previewRes.output).toContain('SLA       < 30 min, price refunded if missed');
    expect(previewRes.output).toContain('Wallet    Binance Agentic Wallet · 42.00 USDC');
    expect(previewRes.output).not.toContain('To pay, run:');
    const [baseCardBox, baseConfirmPrompt] = previewRes.output.split('\n\n');
    expect(baseCardBox).not.toContain('croo order confirm');
    const draftMatch = baseConfirmPrompt.match(
      /^Reply `croo order confirm (d_[a-f0-9]+)` to authorize the 3\.00 USDC payment\.$/
    );
    expect(draftMatch).toBeTruthy();
    const draftId = draftMatch![1];

    // Step 3: Confirm draft
    const confirmRes = await dispatchCli(['order', 'confirm', draftId]);
    expect(confirmRes.exitCode).toBe(0);
    expect(confirmRes.output).toContain('8b1e6c1e-1111-2222-3333-444455556666');
    expect(confirmRes.output).toContain(
      'This order can take up to 30 min. Get the result later with: croo order result 8b1e6c1e-1111-2222-3333-444455556666'
    );

    // Step 4: Status check
    const statusRes = await dispatchCli([
      'order',
      'status',
      '8b1e6c1e-1111-2222-3333-444455556666',
    ]);
    expect(statusRes.exitCode).toBe(0);
    expect(statusRes.output).toContain('Phase     completed');
    expect(statusRes.output).toContain('✓ delivered');

    // Step 5: Save deliverable result
    const outFile = path.join(tmpHome, 'whale-report.md');
    const resultRes = await dispatchCli([
      'order',
      'result',
      '8b1e6c1e-1111-2222-3333-444455556666',
      '-o',
      outFile,
    ]);
    expect(resultRes.exitCode).toBe(0);
    expect(fs.readFileSync(outFile, 'utf8')).toContain('# Whale Report');

    // Verify local audit log was recorded
    const logs = readOrderLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].orderId).toBe('8b1e6c1e-1111-2222-3333-444455556666');
  });

  it('BNB Chain order flow: preview (with shortened inline hex in card) -> Permit2 approve wait -> confirm (replays full hex) -> save result', async () => {
    setBawExecutor(async (args) => {
      if (args[0] === 'wallet' && args[1] === 'status') {
        return {
          stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'preview') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentId: 'bnb-pay-1',
              options: [
                {
                  index: 1,
                  status: 'READY_TO_SIGN',
                  reasons: [],
                  scheme: 'exact',
                  assetTransferMethod: 'permit2',
                  binanceChainId: '56',
                  tokenSymbol: 'USDT',
                  amount: '2.5',
                  currentBalance: '18',
                  payTo: '0x4c1e000000000000000000000000000000009a07',
                  userWalletAddress: '0x9f3a11112222333344445555666677778888c21b',
                  needApproveFirst: true,
                  originalAccept: {
                    scheme: 'exact',
                    network: 'eip155:56',
                    amount: '2500000000000000000',
                    asset: '0x55d398326f99059fF775485246999027B3197955',
                    payTo: '0x4c1e000000000000000000000000000000009a07',
                    maxTimeoutSeconds: 300,
                  },
                },
              ],
            },
          }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'sign') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentHeaderName: 'PAYMENT-SIGNATURE',
              paymentHeaderValue: 'bnb-sig-value',
              approveTxHash: '0xapprove123',
              binanceChainId: '56',
              signatureExpiresAt: Math.floor(Date.now() / 1000) + 300,
            },
          }),
          stderr: '',
        };
      }
      if (args[0] === 'wallet' && args[1] === 'tx-history') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              transactions: [
                { txHash: '0xapprove123', status: 'confirmed', binanceChainId: '56' },
              ],
            },
          }),
          stderr: '',
        };
      }
      return { stdout: JSON.stringify({ success: true, data: {} }), stderr: '' };
    });

    let replayedBody = '';

    setFetchImpl(async (input, init) => {
      const url = String(input);
      if (url.includes('/backend/v1/skill/search')) {
        return new Response(
          JSON.stringify({
            view: 'service',
            agent: null,
            items: [
              {
                type: 'service',
                chain: 'bsc',
                serviceId: 'bsc:153828:web',
                name: 'Whale scan API',
                agentId: 'bsc:153828',
                agentName: 'BNBWhaleRadar',
                settlement: 'b402_direct',
                endpoint: 'https://api.bnbwhale.xyz/scan',
                score: 436,
                feedbackCount: 207,
                url: 'https://8004scan.io/agents/bsc/153828',
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url === 'https://api.bnbwhale.xyz/scan') {
        const sig = (init?.headers as Record<string, string>)?.['PAYMENT-SIGNATURE'];
        if (!sig) {
          return new Response(
            JSON.stringify({
              x402Version: 2,
              accepts: [
                {
                  scheme: 'exact',
                  network: 'eip155:56',
                  amount: '2500000000000000000',
                  asset: '0x55d398326f99059fF775485246999027B3197955',
                  payTo: '0x4c1e000000000000000000000000000000009a07',
                },
              ],
            }),
            { status: 402 }
          );
        }

        replayedBody = String(init?.body || '');

        const paymentRespB64 = Buffer.from(
          JSON.stringify({
            success: true,
            transaction: '0xbnbtx99887766554433221100',
          })
        ).toString('base64');

        return new Response(JSON.stringify({ whales: [{ wallet: '0xabc', usd: 500000 }] }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'PAYMENT-RESPONSE': paymentRespB64,
          },
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const previewRes = await dispatchCli([
      'order',
      'preview',
      'bsc:153828:web',
      '--requirements',
      '{"token":"0x55d398326f99059fF775485246999027B3197955","minUsd":100000}',
    ]);
    expect(previewRes.exitCode).toBe(0);
    expect(previewRes.output).toContain('BNBWhaleRadar · Whale scan API');
    expect(previewRes.output).toContain('BNB Chain · USDT · B402 direct payment');
    expect(previewRes.output).toContain('Price     2.50 USDT');
    expect(previewRes.output).toContain('Gas       none for you');
    expect(previewRes.output).toContain('Pay to    0x4c1e…9a07');
    expect(previewRes.output).toContain('Score     436 · 207 feedback');
    // Shortened contract address inside BNB Request preview line
    expect(previewRes.output).toContain('{"token": "0x55d3…7955", "minUsd": 100000}');
    expect(previewRes.output).toContain('⚠ No escrow. Payment is final');
    expect(previewRes.output).not.toContain('To pay, run:');
    const [bnbCardBox, bnbConfirmPrompt] = previewRes.output.split('\n\n');
    expect(bnbCardBox).not.toContain('croo order confirm');
    const draftMatch = bnbConfirmPrompt.match(
      /^Reply `croo order confirm (d_bnb_[a-f0-9]+)` to authorize the 2\.50 USDT payment\.$/
    );
    expect(draftMatch).toBeTruthy();

    const confirmRes = await dispatchCli(['order', 'confirm', draftMatch![1]]);
    expect(confirmRes.exitCode).toBe(0);
    // Replayed body must still contain the full unshortened contract address
    expect(replayedBody).toBe(
      '{"token":"0x55d398326f99059fF775485246999027B3197955","minUsd":100000}'
    );
    expect(confirmRes.output).toContain('0xbnbtx99887766554433221100');
    expect(confirmRes.output).toContain('"whales"');
  });

  it('does NOT generate confirmable draft when wallet reports INSUFFICIENT_BALANCE or BLOCKED_DAILY_LIMIT_REACHED', async () => {
    setBawExecutor(async (args) => {
      if (args[0] === 'wallet' && args[1] === 'status') {
        return {
          stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'preview') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentId: 'pay-blocked',
              options: [
                {
                  index: 1,
                  status: 'NOT_SIGNABLE',
                  reasons: ['BLOCKED_DAILY_LIMIT_REACHED'],
                  scheme: 'exact',
                  binanceChainId: '8453',
                  tokenSymbol: 'USDC',
                  amount: '50',
                  currentBalance: '100',
                  payTo: '0x1111111111111111111111111111111111111111',
                  originalAccept: {
                    scheme: 'exact',
                    network: 'eip155:8453',
                    amount: '50000000',
                    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                    payTo: '0x1111111111111111111111111111111111111111',
                  },
                },
              ],
            },
          }),
          stderr: '',
        };
      }
      return { stdout: JSON.stringify({ success: true, data: {} }), stderr: '' };
    });

    setFetchImpl(async () => {
      return new Response(
        JSON.stringify({
          code: 402,
          reason: 'PAYMENT_REQUIRED',
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'eip155:8453',
              amount: '50000000',
              asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
              payTo: '0x1111111111111111111111111111111111111111',
            },
          ],
          quote: {
            serviceName: 'Audit Service',
            agentName: 'AuditGuard',
            currency: 'USDC',
            price: '50000000',
            gas: '0',
            total: '50000000',
            slaMinutes: 60,
          },
        }),
        { status: 402 }
      );
    });

    const res = await dispatchCli([
      'order',
      'preview',
      'svc_audit',
      '--requirements',
      '{}',
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('BLOCKED_DAILY_LIMIT_REACHED');
    expect(res.output).not.toContain('croo order confirm');
    const draftFiles = fs.readdirSync(path.join(tmpHome, 'drafts'));
    expect(draftFiles.length).toBe(0);
  });

  it('blocks sensitive credential files and private keys in --requirements', async () => {
    const envRes = await dispatchCli([
      'order',
      'preview',
      'svc_7f2a',
      '--requirements',
      '@.env',
    ]);
    expect(envRes.exitCode).toBe(1);
    expect(envRes.output).toContain('Blocked: Refusing to send sensitive credential file');

    const keyRes = await dispatchCli([
      'order',
      'preview',
      'svc_7f2a',
      '--requirements',
      '{"code":"-----BEGIN EC PRIVATE KEY-----\\nMIIB..."}',
    ]);
    expect(keyRes.exitCode).toBe(1);
    expect(keyRes.output).toContain('Blocked: Detected suspected private key');
  });

  it('truncates multi-line Solidity contract source in Quote Card and keeps all box borders aligned', async () => {
    setBawExecutor(async (args) => {
      if (args[0] === 'wallet' && args[1] === 'status') {
        return {
          stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'preview') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentId: 'pay-sol-1',
              options: [
                {
                  index: 1,
                  status: 'READY_TO_SIGN',
                  reasons: [],
                  scheme: 'exact',
                  binanceChainId: '8453',
                  tokenSymbol: 'USDC',
                  amount: '5',
                  currentBalance: '42',
                  payTo: '0x1111111111111111111111111111111111111111',
                  originalAccept: {
                    scheme: 'exact',
                    network: 'eip155:8453',
                    amount: '5000000',
                    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                    payTo: '0x1111111111111111111111111111111111111111',
                  },
                },
              ],
            },
          }),
          stderr: '',
        };
      }
      return { stdout: JSON.stringify({ success: true, data: {} }), stderr: '' };
    });

    setFetchImpl(async () => {
      return new Response(
        JSON.stringify({
          code: 402,
          reason: 'PAYMENT_REQUIRED',
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'eip155:8453',
              amount: '5000000',
              asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
              payTo: '0x1111111111111111111111111111111111111111',
            },
          ],
          quote: {
            serviceName: 'Quick Scan',
            agentName: 'AuditGuard',
            currency: 'USDC',
            price: '5000000',
            gas: '0',
            total: '5000000',
            slaMinutes: 10,
          },
        }),
        { status: 402 }
      );
    });

    const contractSource = [
      '// SPDX-License-Identifier: MIT',
      'pragma solidity ^0.8.20;',
      'contract Vault {',
      '    uint256 public totalAssets;',
      '    function deposit(uint256 amount) external {',
      '        totalAssets += amount;',
      '    }',
      '}',
    ].join('\n');

    const res = await dispatchCli([
      'order',
      'preview',
      'svc_a91c',
      '--requirements',
      JSON.stringify({ source: contractSource }),
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.output).toContain('<contract source, 8 lines,');

    // Every line in the box must have the exact same character length, and confirmation prompt sits outside the box
    const [solCardBox, solConfirmPrompt] = res.output.split('\n\n');
    const boxLines = solCardBox.split('\n');
    const widths = new Set(boxLines.map((l) => l.length));
    expect(widths.size).toBe(1);
    expect(solCardBox).not.toContain('croo order confirm');
    expect(solConfirmPrompt).toMatch(
      /^Reply `croo order confirm d_[a-f0-9]+` to authorize the 5\.00 USDC payment\.$/
    );

    // When a sibling file path field is present, includes "from <path>"
    const resWithPath = await dispatchCli([
      'order',
      'preview',
      'svc_a91c',
      '--requirements',
      JSON.stringify({ file: './src/Vault.sol', source: contractSource }),
    ]);
    expect(resWithPath.exitCode).toBe(0);
    expect(resWithPath.output).toContain('<contract source, 8 lines from ./src/Vault.sol>');
  });

  it('handles PRICE_CHANGED, QUOTE_EXPIRED, BNB free 200 responses, and unknown CLI flags', async () => {
    const badFlag = await dispatchCli(['search', '--nonexistent', 'whale']);
    expect(badFlag.exitCode).toBe(1);
    expect(badFlag.output).toContain('Unknown option "--nonexistent"');

    const badEqFlag = await dispatchCli(['init', '--base-wallet=awal']);
    expect(badEqFlag.exitCode).toBe(1);
    expect(badEqFlag.output).toContain('Unknown option "--base-wallet"');

    const multiConfirm = await dispatchCli(['order', 'confirm', 'd_1', 'd_2']);
    expect(multiConfirm.exitCode).toBe(1);
    expect(multiConfirm.output).toContain('Only one order can be confirmed at a time');

    // BNB free 200 response + subsequent search downranking
    setBawExecutor(async () => ({
      stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
      stderr: '',
    }));

    setFetchImpl(async (input) => {
      const url = String(input);
      if (url.includes('/backend/v1/skill/search')) {
        return new Response(
          JSON.stringify({
            view: 'service',
            agent: null,
            items: [
              {
                type: 'service',
                chain: 'bsc',
                serviceId: 'bsc:999:free',
                name: 'Free Ping',
                agentId: 'bsc:999',
                agentName: 'FreeBot',
                settlement: 'b402_direct',
                endpoint: 'https://api.freebot.xyz/ping',
                score: 100,
                feedbackCount: 10,
                url: 'https://8004scan.io/agents/bsc/999',
              },
              {
                type: 'service',
                chain: 'bsc',
                serviceId: 'bsc:888:paid',
                name: 'Paid Scan',
                agentId: 'bsc:888',
                agentName: 'PaidBot',
                settlement: 'b402_direct',
                endpoint: 'https://api.paidbot.xyz/scan',
                score: 90,
                feedbackCount: 8,
                url: 'https://8004scan.io/agents/bsc/888',
              },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response('{"pong":true}', { status: 200 });
    });

    const freeRes = await dispatchCli(['order', 'preview', 'bsc:999:free', '--requirements', '{}']);
    expect(freeRes.exitCode).toBe(0);
    expect(freeRes.output).toContain('without requiring payment (logged as free order');
    const logs = readOrderLogs();
    expect(logs.some((l) => l.phase === 'free')).toBe(true);

    // Search again: bsc:999:free should be downranked below bsc:888:paid
    const searchAfterFree = await dispatchCli(['search', 'bot']);
    expect(searchAfterFree.exitCode).toBe(0);
    expect(searchAfterFree.output.indexOf('bsc:888:paid')).toBeLessThan(
      searchAfterFree.output.indexOf('bsc:999:free')
    );
  });

  it('handles wallet EXPIRED session, Base confirm pending polling, 64KB limit, and API key blocking', async () => {
    // 1. Block API keys & wallet.json
    const apiKeyRes = await dispatchCli([
      'order',
      'preview',
      'svc_7f2a',
      '--requirements',
      '{"api_key":"sk-ant-api03-1234567890abcdef1234567890"}',
    ]);
    expect(apiKeyRes.exitCode).toBe(1);
    expect(apiKeyRes.output).toContain('Blocked: Detected suspected private key or credential');

    const walletFileRes = await dispatchCli([
      'order',
      'preview',
      'svc_7f2a',
      '--requirements',
      '@./wallet.json',
    ]);
    expect(walletFileRes.exitCode).toBe(1);
    expect(walletFileRes.output).toContain('Blocked: Refusing to send sensitive credential file');

    // 2. Enforce 64KB requirements limit
    const hugePayload = JSON.stringify({ data: 'x'.repeat(70_000) });
    const hugeRes = await dispatchCli([
      'order',
      'preview',
      'svc_7f2a',
      '--requirements',
      hugePayload,
    ]);
    expect(hugeRes.exitCode).toBe(1);
    expect(hugeRes.output).toContain('exceeds the 64KB limit');

    // 3. Wallet session EXPIRED prompts Binance App re-authorization
    setBawExecutor(async (args) => {
      if (args[0] === 'wallet' && args[1] === 'status') {
        return {
          stdout: JSON.stringify({ success: true, data: { status: 'EXPIRED' } }),
          stderr: '',
        };
      }
      return { stdout: JSON.stringify({ success: true, data: {} }), stderr: '' };
    });

    setFetchImpl(async () => {
      return new Response(
        JSON.stringify({
          code: 402,
          reason: 'PAYMENT_REQUIRED',
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'eip155:8453',
              amount: '3000000',
              asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
              payTo: '0x1111111111111111111111111111111111111111',
            },
          ],
        }),
        { status: 402 }
      );
    });

    const expiredRes = await dispatchCli([
      'order',
      'preview',
      'svc_7f2a',
      '--requirements',
      '{"threshold":100000}',
    ]);
    expect(expiredRes.exitCode).toBe(1);
    expect(expiredRes.output).toContain('re-authorize in the Binance App');
  });

  it('guards against spoofed token balances, handles 1-char search error, wraps bare numeric text requirements, and verifies signed envelopes', async () => {
    // 1. Canonical USDC/USDT address takes precedence over airdrop spam tokens with the same symbol
    setBawExecutor(async (args) => {
      if (args[0] === 'wallet' && args[1] === 'status') {
        return {
          stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
          stderr: '',
        };
      }
      if (args[0] === 'wallet' && args[1] === 'address') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              addresses: [
                { binanceChainId: '8453', chainName: 'Base', address: '0x9f3a11112222333344445555666677778888c21b' },
              ],
            },
          }),
          stderr: '',
        };
      }
      if (args[0] === 'wallet' && args[1] === 'balance') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: [
              {
                symbol: 'USDC',
                address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                binanceChainId: '8453',
                balance: '1.99',
              },
              {
                symbol: 'USDC',
                address: '0xdeadbeef00000000000000000000000000009999',
                binanceChainId: '8453',
                balance: '999999',
              },
              {
                symbol: 'USDT',
                address: '0xdeadbeef00000000000000000000000000008888',
                binanceChainId: '56',
                balance: '888888',
              },
            ],
          }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'preview') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentId: 'pay-text-1',
              options: [
                {
                  index: 1,
                  status: 'READY_TO_SIGN',
                  reasons: [],
                  scheme: 'exact',
                  binanceChainId: '8453',
                  tokenSymbol: 'USDC',
                  amount: '0.01',
                  currentBalance: '1.99',
                  payTo: '0x1111111111111111111111111111111111111111',
                  originalAccept: {
                    scheme: 'exact',
                    network: 'eip155:8453',
                    amount: '10000',
                    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                    payTo: '0x1111111111111111111111111111111111111111',
                  },
                },
              ],
            },
          }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'sign') {
        // Return a tampered PAYMENT-SIGNATURE envelope whose amount does not match preview
        const tamperedEnvelope = Buffer.from(
          JSON.stringify({
            x402Version: 2,
            accepted: {
              payTo: '0x1111111111111111111111111111111111111111',
              amount: '99999999',
            },
          })
        ).toString('base64');
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentHeaderName: 'PAYMENT-SIGNATURE',
              paymentHeaderValue: tamperedEnvelope,
              approveTxHash: null,
              binanceChainId: '8453',
              signatureExpiresAt: Math.floor(Date.now() / 1000) + 300,
            },
          }),
          stderr: '',
        };
      }
      return { stdout: JSON.stringify({ success: true, data: {} }), stderr: '' };
    });

    const initRes = await dispatchCli(['init']);
    expect(initRes.exitCode).toBe(0);
    expect(initRes.output).toContain('Base       1.99 USDC');
    expect(initRes.output).toContain('BNB Chain  0.00 USDT');

    // 2. 1-char search error translation + bare numeric string wrapped for text requirement
    let postedBody = '';
    setFetchImpl(async (input, init) => {
      const url = String(input);
      if (url.includes('/backend/v1/skill/search')) {
        return new Response(
          JSON.stringify({
            code: 400,
            reason: 'INVALID_PARAMETERS',
            message: 'q or agentId is required',
          }),
          { status: 400 }
        );
      }
      postedBody = String(init?.body || '');
      return new Response(
        JSON.stringify({
          code: 402,
          reason: 'PAYMENT_REQUIRED',
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'eip155:8453',
              amount: '10000',
              asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
              payTo: '0x1111111111111111111111111111111111111111',
            },
          ],
          quote: {
            serviceName: 'Random Short String',
            agentName: 'StringBot',
            currency: 'USDC',
            price: '10000',
            gas: '0',
            total: '10000',
            slaMinutes: 5,
          },
        }),
        { status: 402 }
      );
    });

    const shortSearch = await dispatchCli(['search', 'a']);
    expect(shortSearch.exitCode).toBe(1);
    expect(shortSearch.output).toContain('Search query "a" is too short (minimum 2 characters)');

    const numTextPreview = await dispatchCli([
      'order',
      'preview',
      'svc_text',
      '--requirements',
      '12345',
    ]);
    expect(numTextPreview.exitCode).toBe(0);
    expect(postedBody).toBe('"12345"');
    const draftMatch = numTextPreview.output.match(/croo order confirm (d_[a-f0-9]+)/);
    expect(draftMatch).toBeTruthy();

    // 3. Confirming with a tampered signed amount is rejected client-side before HTTP replay
    const tamperedConfirm = await dispatchCli(['order', 'confirm', draftMatch![1]]);
    expect(tamperedConfirm.exitCode).toBe(1);
    expect(tamperedConfirm.output).toContain('Price changed since preview. Run preview again.');
  });

  it('supports 1-based index, name, and "1. Name: id" resolution across search and order commands without agent/service confusion', async () => {
    setBawExecutor(async () => ({
      stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
      stderr: '',
    }));

    const requestedUrls: string[] = [];
    setFetchImpl(async (input) => {
      const url = String(input);
      requestedUrls.push(url);

      if (url.includes('/backend/v1/skill/search')) {
        return new Response(
          JSON.stringify({
            view: 'service',
            agent: null,
            items: [
              {
                type: 'service',
                chain: 'base',
                serviceId: 'a5cd8823-035d-4d4c-947d-b66a023e003f',
                name: 'List Hyperliquid Vaults',
                agentId: 'f2892dd3-654e-4b11-8c81-16a82d170663',
                agentName: 'Hyperliquid Vault Strategy Intelligence Agent',
                settlement: 'cap_escrow',
                currency: 'USDC',
                price: '10000',
                slaMinutes: 30,
                orders: 7,
                url: 'https://croo.network/agent/f2892dd3-654e-4b11-8c81-16a82d170663',
              },
              {
                type: 'service',
                chain: 'base',
                serviceId: 'd2690a2c-e9b9-4b9d-9225-986b85641fe0',
                name: 'Hyperliquid Vault Overview',
                agentId: 'f2892dd3-654e-4b11-8c81-16a82d170663',
                agentName: 'Hyperliquid Vault Strategy Intelligence Agent',
                settlement: 'cap_escrow',
                currency: 'USDC',
                price: '10000',
                slaMinutes: 30,
                orders: 2,
                url: 'https://croo.network/agent/f2892dd3-654e-4b11-8c81-16a82d170663',
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.includes('/services/')) {
        const svcId = url.split('/services/')[1]?.split('/')[0];
        return new Response(
          JSON.stringify({
            code: 400,
            reason: 'INVALID_REQUIREMENTS',
            message: 'requirements validation failed',
            metadata: {
              serviceName:
                svcId === 'a5cd8823-035d-4d4c-947d-b66a023e003f'
                  ? 'List Hyperliquid Vaults'
                  : 'Hyperliquid Vault Overview',
              requirementType: 'schema',
              requirementSchema: [
                { name: 'vault_address', type: 'string', required: true, description: 'Vault address' },
              ],
            },
          }),
          { status: 400 }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    // 1. Run search to populate lastList cache
    const searchRes = await dispatchCli(['search', 'hyperliquid', '--json']);
    expect(searchRes.exitCode).toBe(0);
    const parsedSearch = JSON.parse(searchRes.output);
    expect(parsedSearch.items[0].display_line).toBe(
      '1. List Hyperliquid Vaults: a5cd8823-035d-4d4c-947d-b66a023e003f'
    );
    expect(parsedSearch.items[1].display_line).toBe(
      '2. Hyperliquid Vault Overview: d2690a2c-e9b9-4b9d-9225-986b85641fe0'
    );

    // 2. Preview by 1-based index ("1", "2")
    const prev1 = await dispatchCli(['order', 'preview', '1']);
    expect(prev1.exitCode).toBe(0);
    expect(prev1.output).toContain('Missing required fields for "List Hyperliquid Vaults"');

    const prev2 = await dispatchCli(['order', 'preview', '2']);
    expect(prev2.exitCode).toBe(0);
    expect(prev2.output).toContain('Missing required fields for "Hyperliquid Vault Overview"');

    // 3. Preview by full copied display line ("1. List Hyperliquid Vaults: a5cd8823-...")
    const prevLine = await dispatchCli([
      'order',
      'preview',
      '1. List Hyperliquid Vaults: a5cd8823-035d-4d4c-947d-b66a023e003f',
    ]);
    expect(prevLine.exitCode).toBe(0);
    expect(prevLine.output).toContain('Missing required fields for "List Hyperliquid Vaults"');

    // 4. Preview by exact service name
    const prevByName = await dispatchCli(['order', 'preview', 'Hyperliquid Vault Overview']);
    expect(prevByName.exitCode).toBe(0);
    expect(prevByName.output).toContain('Missing required fields for "Hyperliquid Vault Overview"');

    // 5. Passing the Agent name to `order preview` must trigger NOT_A_SERVICE (not silently pick service #1)
    const prevAgentName = await dispatchCli([
      'order',
      'preview',
      'Hyperliquid Vault Strategy Intelligence Agent',
    ]);
    expect(prevAgentName.exitCode).toBe(0);
    expect(prevAgentName.output).toBe(
      "That's an agent, not a service. See its services: croo search --agent f2892dd3-654e-4b11-8c81-16a82d170663"
    );

    // 6. Out-of-range numeric index fails fast with clear error
    const outOfRange = await dispatchCli(['order', 'preview', '99']);
    expect(outOfRange.exitCode).toBe(1);
    expect(outOfRange.output).toContain('Selection #99 is out of range (last search returned 2 items)');
  });

  it('blocks standard JSON credential keys, nested/double-encoded secrets, and Unicode-escaped keys before any HTTP request while allowing benign crypto fields', async () => {
    let fetchCalls = 0;
    setFetchImpl(async () => {
      fetchCalls += 1;
      return new Response('{}', { status: 200 });
    });

    const sensitiveKeys = [
      'apiKey',
      'api_key',
      'privateKey',
      'secret_key',
      'mnemonic',
      'clientSecret',
      'accessToken',
      'seedPhrase',
      'Authorization',
    ];

    for (const key of sensitiveKeys) {
      expect(() =>
        parseRequirementsInput(JSON.stringify({ [key]: 'TESTONLY123456789012345' }))
      ).toThrow(/Blocked: Detected suspected private key or credential/);

      const cliRes = await dispatchCli([
        'order',
        'preview',
        'svc_7f2a',
        '--requirements',
        JSON.stringify({ [key]: 'TESTONLY123456789012345' }),
      ]);
      expect(cliRes.exitCode).toBe(1);
      expect(cliRes.output).toContain('Blocked: Detected suspected private key or credential');
    }

    // Nested object, double-encoded JSON string, Unicode-escaped key, and non-JSON text
    expect(() =>
      parseRequirementsInput(
        JSON.stringify({ items: [{ nested: { private_key: 'placeholder' } }] })
      )
    ).toThrow(/Blocked: Detected suspected private key or credential/);

    expect(() =>
      parseRequirementsInput(
        JSON.stringify({ payload: JSON.stringify({ mnemonic: 'word1 word2 word3' }) })
      )
    ).toThrow(/Blocked: Detected suspected private key or credential/);

    expect(() =>
      parseRequirementsInput('{"\\u0061piKey":"TESTONLY123456789012345"}')
    ).toThrow(/Blocked: Detected suspected private key or credential/);

    expect(() => parseRequirementsInput('apiKey: TESTONLY123456789012345')).toThrow(
      /Blocked: Detected suspected private key or credential/
    );

    // Zero HTTP requests must have been sent during any blocked preview call
    expect(fetchCalls).toBe(0);

    // Legitimate crypto / service fields must NOT be falsely blocked
    expect(
      parseRequirementsInput(JSON.stringify({ tokens: 'ETH', chain: 'ethereum' })).parsed
    ).toEqual({ tokens: 'ETH', chain: 'ethereum' });
    expect(
      parseRequirementsInput(
        JSON.stringify({
          token: '0x55d398326f99059fF775485246999027B3197955',
          publicKey: '0x04abcdef',
          seed: 42,
          source:
            'contract Auth { bytes32 apiKey; function set(bytes32 _apiKey) external { if (apiKey == _apiKey) return; apiKey = _apiKey; } }',
        })
      ).parsed
    ).toMatchObject({
      token: '0x55d398326f99059fF775485246999027B3197955',
      publicKey: '0x04abcdef',
      seed: 42,
    });
  });

  it('rejects Base preview and refuses to save draft when quote.total, 402 accepts.amount, wallet option amount, or price + gas = total mismatch', async () => {
    let walletOptionAmountAtomic = '20000';
    let walletOptionAmountHuman = '0.02';

    setBawExecutor(async (args) => {
      if (args[0] === 'wallet' && args[1] === 'status') {
        return {
          stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'preview') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentId: 'pay-mismatch-1',
              options: [
                {
                  index: 1,
                  status: 'READY_TO_SIGN',
                  reasons: [],
                  scheme: 'exact',
                  binanceChainId: '8453',
                  tokenSymbol: 'USDC',
                  amount: walletOptionAmountHuman,
                  currentBalance: '5',
                  payTo: '0x1111111111111111111111111111111111111111',
                  originalAccept: {
                    scheme: 'exact',
                    network: 'eip155:8453',
                    amount: walletOptionAmountAtomic,
                    asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                    payTo: '0x1111111111111111111111111111111111111111',
                  },
                },
              ],
            },
          }),
          stderr: '',
        };
      }
      return { stdout: JSON.stringify({ success: true, data: {} }), stderr: '' };
    });

    let acceptsAmount = '20000';
    let quotePrice = '10000';
    let quoteGas = '0';
    let quoteTotal = '10000';

    setFetchImpl(async () => {
      return new Response(
        JSON.stringify({
          code: 402,
          reason: 'PAYMENT_REQUIRED',
          x402Version: 2,
          accepts: [
            {
              scheme: 'exact',
              network: 'eip155:8453',
              amount: acceptsAmount,
              asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
              payTo: '0x1111111111111111111111111111111111111111',
            },
          ],
          quote: {
            serviceName: 'Gas Tracker',
            agentName: 'swapcat',
            currency: 'USDC',
            price: quotePrice,
            gas: quoteGas,
            total: quoteTotal,
            slaMinutes: 30,
          },
        }),
        { status: 402 }
      );
    });

    // Case 1: quote.total=10000 vs accepts[0].amount=20000 (wallet option=20000) -> must fail, 0 drafts
    const mismatchQuoteVsAccept = await dispatchCli([
      'order',
      'preview',
      'svc_gas',
      '--requirements',
      '{"chain":"ethereum"}',
      '--json',
    ]);
    expect(mismatchQuoteVsAccept.exitCode).toBe(1);
    expect(mismatchQuoteVsAccept.output).toContain('Quote amount mismatch');
    expect(fs.existsSync(path.join(tmpHome, 'drafts')) ? fs.readdirSync(path.join(tmpHome, 'drafts')).length : 0).toBe(0);

    // Case 2: quote.total=10000, accepts[0].amount=10000, but wallet option=20000 -> must fail, 0 drafts
    acceptsAmount = '10000';
    const mismatchAcceptVsWallet = await dispatchCli([
      'order',
      'preview',
      'svc_gas',
      '--requirements',
      '{"chain":"ethereum"}',
    ]);
    expect(mismatchAcceptVsWallet.exitCode).toBe(1);
    expect(mismatchAcceptVsWallet.output).toContain('Payment quote mismatch');
    expect(fs.existsSync(path.join(tmpHome, 'drafts')) ? fs.readdirSync(path.join(tmpHome, 'drafts')).length : 0).toBe(0);

    // Case 3: price (10000) + gas (5000) !== total (10000) even when accepts & wallet equal 10000 -> must fail, 0 drafts
    walletOptionAmountAtomic = '10000';
    walletOptionAmountHuman = '0.01';
    quoteGas = '5000';
    const badMathRes = await dispatchCli([
      'order',
      'preview',
      'svc_gas',
      '--requirements',
      '{"chain":"ethereum"}',
    ]);
    expect(badMathRes.exitCode).toBe(1);
    expect(badMathRes.output).toContain('does not equal total');
    expect(fs.existsSync(path.join(tmpHome, 'drafts')) ? fs.readdirSync(path.join(tmpHome, 'drafts')).length : 0).toBe(0);

    // Case 4: Valid price (10000) + gas (5000) === total (15000) === accepts (15000) === wallet (0.015 / 15000) -> succeeds!
    quoteTotal = '15000';
    acceptsAmount = '15000';
    walletOptionAmountAtomic = '15000';
    walletOptionAmountHuman = '0.015';
    const validRes = await dispatchCli([
      'order',
      'preview',
      'svc_gas',
      '--requirements',
      '{"chain":"ethereum"}',
      '--json',
    ]);
    expect(validRes.exitCode).toBe(0);
    const parsedValid = JSON.parse(validRes.output);
    expect(parsedValid.status).toBe('ready_to_confirm');
    expect(parsedValid.quote.price).toBe('0.01');
    expect(parsedValid.quote.gas).toBe('0.005');
    expect(parsedValid.quote.total).toBe('0.015');
    expect(fs.readdirSync(path.join(tmpHome, 'drafts')).length).toBe(1);
  });

  it('refuses cross-chain wallet option fallback on both BNB (eip155:56 only) and Base (eip155:8453 only)', async () => {
    let mockedWalletOptionChain: 'base' | 'bsc' = 'base';

    setBawExecutor(async (args) => {
      if (args[0] === 'wallet' && args[1] === 'status') {
        return {
          stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'preview') {
        const option =
          mockedWalletOptionChain === 'base'
            ? {
                index: 1,
                status: 'READY_TO_SIGN',
                reasons: [],
                scheme: 'exact',
                binanceChainId: '8453',
                tokenSymbol: 'USDC',
                amount: '0.01',
                currentBalance: '5',
                payTo: '0x1111111111111111111111111111111111111111',
                originalAccept: {
                  scheme: 'exact',
                  network: 'eip155:8453',
                  amount: '10000',
                  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                  payTo: '0x1111111111111111111111111111111111111111',
                },
              }
            : {
                index: 1,
                status: 'READY_TO_SIGN',
                reasons: [],
                scheme: 'exact',
                binanceChainId: '56',
                tokenSymbol: 'USDT',
                amount: '0.01',
                currentBalance: '5',
                payTo: '0x4c1e000000000000000000000000000000009a07',
                originalAccept: {
                  scheme: 'exact',
                  network: 'eip155:56',
                  amount: '10000000000000000',
                  asset: '0x55d398326f99059fF775485246999027B3197955',
                  payTo: '0x4c1e000000000000000000000000000000009a07',
                },
              };
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentId: 'pay-cross-chain',
              options: [option],
            },
          }),
          stderr: '',
        };
      }
      return { stdout: JSON.stringify({ success: true, data: {} }), stderr: '' };
    });

    setFetchImpl(async (input) => {
      const url = String(input);
      if (url.includes('/backend/v1/skill/search')) {
        return new Response(
          JSON.stringify({
            view: 'service',
            agent: null,
            items: [
              {
                type: 'service',
                chain: 'bsc',
                serviceId: 'bsc:153828:web',
                name: 'Whale scan API',
                agentId: 'bsc:153828',
                agentName: 'BNBWhaleRadar',
                settlement: 'b402_direct',
                endpoint: 'https://api.bnbwhale.xyz/scan',
                score: 436,
                feedbackCount: 207,
                url: 'https://8004scan.io/agents/bsc/153828',
              },
            ],
          }),
          { status: 200 }
        );
      }

      if (url === 'https://api.bnbwhale.xyz/scan') {
        return new Response(
          JSON.stringify({
            x402Version: 2,
            accepts: [
              {
                scheme: 'exact',
                network: 'eip155:56',
                amount: '10000000000000000',
                asset: '0x55d398326f99059fF775485246999027B3197955',
                payTo: '0x4c1e000000000000000000000000000000009a07',
              },
            ],
          }),
          { status: 402 }
        );
      }

      if (url.endsWith('/services/svc_base_1/order')) {
        return new Response(
          JSON.stringify({
            code: 402,
            reason: 'PAYMENT_REQUIRED',
            x402Version: 2,
            accepts: [
              {
                scheme: 'exact',
                network: 'eip155:8453',
                amount: '10000',
                asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
                payTo: '0x1111111111111111111111111111111111111111',
              },
            ],
            quote: {
              serviceName: 'Base Service',
              agentName: 'BaseAgent',
              currency: 'USDC',
              price: '10000',
              gas: '0',
              total: '10000',
              slaMinutes: 30,
            },
          }),
          { status: 402 }
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    // 1. BNB 402 when wallet only returns eip155:8453 (Base) READY_TO_SIGN option
    mockedWalletOptionChain = 'base';
    const bnbTextRes = await dispatchCli([
      'order',
      'preview',
      'bsc:153828:web',
      '--requirements',
      '{}',
    ]);
    expect(bnbTextRes.exitCode).toBe(0);
    expect(bnbTextRes.output).toBe(
      "This agent doesn't accept a payment method your wallet supports."
    );
    expect(bnbTextRes.output).not.toContain('croo order confirm');

    const bnbJsonRes = await dispatchCli([
      'order',
      'preview',
      'bsc:153828:web',
      '--requirements',
      '{}',
      '--json',
    ]);
    expect(bnbJsonRes.exitCode).toBe(0);
    const parsedBnbJson = JSON.parse(bnbJsonRes.output);
    expect(parsedBnbJson.status).toBe('unsupported_payment_method');
    expect(parsedBnbJson.error).toBe(
      "This agent doesn't accept a payment method your wallet supports."
    );
    expect(
      fs.existsSync(path.join(tmpHome, 'drafts'))
        ? fs.readdirSync(path.join(tmpHome, 'drafts')).length
        : 0
    ).toBe(0);

    // 2. Symmetric Base 402 when wallet only returns eip155:56 (BSC) READY_TO_SIGN option
    mockedWalletOptionChain = 'bsc';
    const baseTextRes = await dispatchCli([
      'order',
      'preview',
      'svc_base_1',
      '--requirements',
      '{}',
    ]);
    expect(baseTextRes.exitCode).toBe(0);
    expect(baseTextRes.output).toBe(
      "This agent doesn't accept a payment method your wallet supports."
    );
    expect(baseTextRes.output).not.toContain('croo order confirm');

    const baseJsonRes = await dispatchCli([
      'order',
      'preview',
      'svc_base_1',
      '--requirements',
      '{}',
      '--json',
    ]);
    expect(baseJsonRes.exitCode).toBe(0);
    const parsedBaseJson = JSON.parse(baseJsonRes.output);
    expect(parsedBaseJson.status).toBe('unsupported_payment_method');
    expect(parsedBaseJson.error).toBe(
      "This agent doesn't accept a payment method your wallet supports."
    );
    expect(
      fs.existsSync(path.join(tmpHome, 'drafts'))
        ? fs.readdirSync(path.join(tmpHome, 'drafts')).length
        : 0
    ).toBe(0);

    // 3. Real `baw` NOT_SIGNABLE shape with null fields (amount: null, binanceChainId: null, INVALID_ACCEPT_STRUCTURE)
    setBawExecutor(async (args) => {
      if (args[0] === 'wallet' && args[1] === 'status') {
        return {
          stdout: JSON.stringify({ success: true, data: { status: 'CONNECTED' } }),
          stderr: '',
        };
      }
      if (args[0] === 'x402-payment' && args[1] === 'preview') {
        return {
          stdout: JSON.stringify({
            success: true,
            data: {
              paymentId: 'pay-null-fields',
              options: [
                {
                  index: 1,
                  status: 'NOT_SIGNABLE',
                  reasons: ['INVALID_ACCEPT_STRUCTURE'],
                  scheme: 'exact',
                  binanceChainId: null,
                  tokenSymbol: null,
                  amount: null,
                  currentBalance: null,
                  payTo: '0x4c1e000000000000000000000000000000009a07',
                  originalAccept: {
                    scheme: 'exact',
                    network: 'eip155:56',
                    amount: '10000000000000000',
                    asset: '0x55d398326f99059fF775485246999027B3197955',
                    payTo: '0x4c1e000000000000000000000000000000009a07',
                  },
                },
              ],
            },
          }),
          stderr: '',
        };
      }
      return { stdout: JSON.stringify({ success: true, data: {} }), stderr: '' };
    });

    const invalidAcceptRes = await dispatchCli([
      'order',
      'preview',
      'bsc:153828:web',
      '--requirements',
      '{}',
      '--json',
    ]);
    expect(invalidAcceptRes.exitCode).toBe(0);
    expect(JSON.parse(invalidAcceptRes.output).status).toBe('unsupported_payment_method');
    expect(
      fs.existsSync(path.join(tmpHome, 'drafts'))
        ? fs.readdirSync(path.join(tmpHome, 'drafts')).length
        : 0
    ).toBe(0);
  });
});
