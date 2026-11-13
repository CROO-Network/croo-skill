import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadConfig } from './config.js';
import type {
  BawBalanceEntry,
  BawPaymentPreviewData,
  BawPaymentSignData,
  BawResponse,
  BawTxHistoryData,
  BawWalletAddressData,
  BawWalletStatusData,
} from './types.js';

const execFileAsync = promisify(execFile);

export const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const BSC_USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';

export interface WalletSummary {
  installed: boolean;
  connected: boolean;
  status: 'NOT_INSTALLED' | 'UNCONNECTED' | 'CREATING' | 'CONNECTED' | 'EXPIRED';
  address: string;
  baseAddress: string;
  bscAddress: string;
  baseUsdcBalance: string;
  bscUsdtBalance: string;
  rawError?: string;
}

export type BawCommandExecutor = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

let customExecutor: BawCommandExecutor | null = null;

export function setBawExecutor(executor: BawCommandExecutor | null): void {
  customExecutor = executor;
}

async function runBawRaw(args: string[]): Promise<{ stdout: string; stderr: string }> {
  if (customExecutor) {
    return customExecutor(args);
  }
  const { bawBin } = loadConfig();
  return execFileAsync(bawBin || 'baw', args, {
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function runBawJson<T>(args: string[]): Promise<BawResponse<T>> {
  const fullArgs = args.includes('--json') ? args : [...args, '--json'];
  try {
    const { stdout } = await runBawRaw(fullArgs);
    const parsed = JSON.parse(stdout.trim()) as BawResponse<T>;
    return parsed;
  } catch (err: unknown) {
    const e = err as { code?: string; stdout?: string; stderr?: string; message?: string };
    if (e.code === 'ENOENT') {
      throw new BawNotInstalledError();
    }
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout.trim()) as BawResponse<T>;
      } catch {
        // fall through
      }
    }
    const msg = (e.stderr || e.message || 'Unknown baw CLI error').trim();
    throw new BawCliError(msg);
  }
}

export class BawNotInstalledError extends Error {
  constructor() {
    super(
      'No agentic wallet found. croo pays with your Binance Agentic Wallet; it never holds your keys.'
    );
    this.name = 'BawNotInstalledError';
  }
}

export class BawCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BawCliError';
  }
}

export function extractBawErrorMessage(resp: BawResponse<unknown>): string {
  if (typeof resp.error === 'string' && resp.error) {
    return resp.error;
  }
  if (resp.error && typeof resp.error === 'object' && resp.error.message) {
    return resp.error.message;
  }
  if (resp.message) {
    return resp.message;
  }
  return 'Unknown wallet error';
}

export async function getWalletSummary(): Promise<WalletSummary> {
  const empty: WalletSummary = {
    installed: false,
    connected: false,
    status: 'NOT_INSTALLED',
    address: '',
    baseAddress: '',
    bscAddress: '',
    baseUsdcBalance: '0.00',
    bscUsdtBalance: '0.00',
  };

  let statusResp: BawResponse<BawWalletStatusData>;
  try {
    statusResp = await runBawJson<BawWalletStatusData>(['wallet', 'status']);
  } catch (err) {
    if (err instanceof BawNotInstalledError) {
      return empty;
    }
    return {
      ...empty,
      installed: true,
      status: 'UNCONNECTED',
      rawError: err instanceof Error ? err.message : String(err),
    };
  }

  if (!statusResp.success || !statusResp.data) {
    const errMsg = extractBawErrorMessage(statusResp);
    const isExpired = /expired|unauthorized|session|sign in/i.test(errMsg);
    return {
      ...empty,
      installed: true,
      status: isExpired ? 'EXPIRED' : 'UNCONNECTED',
      rawError: errMsg,
    };
  }

  const walletStatus = statusResp.data.status;
  if (walletStatus !== 'CONNECTED') {
    return {
      ...empty,
      installed: true,
      connected: false,
      status: walletStatus,
    };
  }

  // Fetch addresses and balances in parallel
  const [addrResp, balResp] = await Promise.all([
    runBawJson<BawWalletAddressData>(['wallet', 'address']).catch(() => null),
    runBawJson<BawBalanceEntry[]>(['wallet', 'balance', '--hideLowValue', 'false']).catch(
      () => null
    ),
  ]);

  let baseAddress = '';
  let bscAddress = '';
  let fallbackEvmAddress = '';

  if (addrResp?.success && addrResp.data?.addresses) {
    for (const entry of addrResp.data.addresses) {
      if (entry.binanceChainId === '8453') {
        baseAddress = entry.address;
      } else if (entry.binanceChainId === '56') {
        bscAddress = entry.address;
      }
      if (entry.address.startsWith('0x') && !fallbackEvmAddress) {
        fallbackEvmAddress = entry.address;
      }
    }
  }

  baseAddress = baseAddress || fallbackEvmAddress;
  bscAddress = bscAddress || fallbackEvmAddress;
  const primaryAddress = baseAddress || bscAddress;

  let baseUsdcBalance = '0.00';
  let bscUsdtBalance = '0.00';
  let matchedCanonicalBaseUsdc = false;
  let matchedCanonicalBscUsdt = false;

  if (balResp?.success && Array.isArray(balResp.data)) {
    for (const item of balResp.data) {
      const addrLower = (item.address || '').toLowerCase();
      const symUpper = (item.symbol || '').toUpperCase();
      if (item.binanceChainId === '8453') {
        if (addrLower === BASE_USDC_ADDRESS.toLowerCase()) {
          baseUsdcBalance = formatTwoDecimals(item.balance);
          matchedCanonicalBaseUsdc = true;
        } else if (!matchedCanonicalBaseUsdc && !addrLower && symUpper === 'USDC') {
          baseUsdcBalance = formatTwoDecimals(item.balance);
        }
      } else if (item.binanceChainId === '56') {
        if (addrLower === BSC_USDT_ADDRESS.toLowerCase()) {
          bscUsdtBalance = formatTwoDecimals(item.balance);
          matchedCanonicalBscUsdt = true;
        } else if (!matchedCanonicalBscUsdt && !addrLower && symUpper === 'USDT') {
          bscUsdtBalance = formatTwoDecimals(item.balance);
        }
      }
    }
  }

  return {
    installed: true,
    connected: true,
    status: 'CONNECTED',
    address: primaryAddress,
    baseAddress,
    bscAddress,
    baseUsdcBalance,
    bscUsdtBalance,
  };
}

export async function isWalletReady(): Promise<boolean> {
  try {
    const statusResp = await runBawJson<BawWalletStatusData>(['wallet', 'status']);
    return Boolean(statusResp.success && statusResp.data?.status === 'CONNECTED');
  } catch {
    return false;
  }
}

export async function ensureWalletReady(): Promise<void> {
  let statusResp: BawResponse<BawWalletStatusData>;
  try {
    statusResp = await runBawJson<BawWalletStatusData>(['wallet', 'status']);
  } catch {
    throw new Error('No agentic wallet found. Run croo init.');
  }

  if (!statusResp.success || !statusResp.data) {
    const errMsg = extractBawErrorMessage(statusResp);
    if (/expired|unauthorized|session|sign in/i.test(errMsg)) {
      throw new Error(
        'Binance Agentic Wallet session expired. Please re-authorize in the Binance App, then run `croo init` again.'
      );
    }
    throw new Error('No agentic wallet found. Run croo init.');
  }

  if (statusResp.data.status === 'EXPIRED') {
    throw new Error(
      'Binance Agentic Wallet session expired. Please re-authorize in the Binance App, then run `croo init` again.'
    );
  }

  if (statusResp.data.status !== 'CONNECTED') {
    throw new Error('No agentic wallet found. Run croo init.');
  }
}

export async function previewX402Payment(
  paymentRequirementsPayload: string
): Promise<BawPaymentPreviewData> {
  const resp = await runBawJson<BawPaymentPreviewData>([
    'x402-payment',
    'preview',
    '--paymentRequirements',
    paymentRequirementsPayload,
  ]);
  if (!resp.success || !resp.data) {
    throw new BawCliError(extractBawErrorMessage(resp));
  }
  return resp.data;
}

export async function signX402Payment(
  paymentId: string,
  selectedIndex: number
): Promise<BawPaymentSignData> {
  const resp = await runBawJson<BawPaymentSignData>([
    'x402-payment',
    'sign',
    '--paymentId',
    paymentId,
    '--selectedIndex',
    String(selectedIndex),
  ]);
  if (!resp.success || !resp.data) {
    throw new BawCliError(extractBawErrorMessage(resp));
  }
  return resp.data;
}

export async function waitForApproveConfirmation(
  txHash: string,
  binanceChainId: string = '56',
  maxWaitMs: number = 45_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const resp = await runBawJson<BawTxHistoryData>([
      'wallet',
      'tx-history',
      '--tx',
      txHash,
      '--binanceChainId',
      binanceChainId,
    ]).catch(() => null);

    const txs = resp?.data?.transactions;
    if (Array.isArray(txs)) {
      const matched = txs.find(
        (t) => t.txHash && t.txHash.toLowerCase() === txHash.toLowerCase()
      ) || txs[0];
      if (matched?.status?.toLowerCase() === 'confirmed') {
        return;
      }
      if (matched?.status?.toLowerCase() === 'failed') {
        throw new BawCliError(`Permit2 approve transaction ${txHash} failed on-chain.`);
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new BawCliError(
    `Permit2 approval transaction ${txHash} is still pending confirmation on-chain. Wait for it to confirm, then run \`croo order preview\` again.`
  );
}

export async function verifyAndPrepareSignedPayment(
  paymentHeaderValue: string,
  expectedPayTo?: string,
  expectedAtomicAmount?: string,
  expectedNetwork?: string
): Promise<void> {
  if (!paymentHeaderValue) {
    throw new BawCliError('Wallet returned an empty PAYMENT-SIGNATURE header.');
  }

  let decoded: Record<string, unknown> | null = null;
  try {
    const rawJson = Buffer.from(paymentHeaderValue.trim(), 'base64').toString('utf8');
    if (rawJson.trim().startsWith('{')) {
      decoded = JSON.parse(rawJson) as Record<string, unknown>;
    }
  } catch {
    decoded = null;
  }

  if (!decoded) {
    return;
  }

  // Verify `accepted` block if present in x402 v2 envelope
  const accepted = decoded.accepted as Record<string, unknown> | undefined;
  if (accepted && typeof accepted === 'object') {
    if (
      expectedNetwork &&
      typeof accepted.network === 'string' &&
      accepted.network !== expectedNetwork
    ) {
      throw new BawCliError("This agent doesn't accept a payment method your wallet supports.");
    }
    if (
      expectedPayTo &&
      typeof accepted.payTo === 'string' &&
      accepted.payTo.toLowerCase() !== expectedPayTo.toLowerCase()
    ) {
      throw new BawCliError('Price changed since preview. Run preview again.');
    }
    if (
      expectedAtomicAmount &&
      accepted.amount !== undefined &&
      String(accepted.amount) !== String(expectedAtomicAmount)
    ) {
      throw new BawCliError('Price changed since preview. Run preview again.');
    }
  }

  // Verify EIP-3009 authorization fields and timing window if present
  const payload = decoded.payload as Record<string, unknown> | undefined;
  const auth = payload?.authorization as Record<string, unknown> | undefined;
  if (auth && typeof auth === 'object') {
    if (
      expectedPayTo &&
      typeof auth.to === 'string' &&
      auth.to.toLowerCase() !== expectedPayTo.toLowerCase()
    ) {
      throw new BawCliError('Price changed since preview. Run preview again.');
    }
    if (
      expectedAtomicAmount &&
      auth.value !== undefined &&
      String(auth.value) !== String(expectedAtomicAmount)
    ) {
      throw new BawCliError('Price changed since preview. Run preview again.');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const validBefore = Number(auth.validBefore);
    if (Number.isFinite(validBefore) && validBefore > 0 && nowSec >= validBefore) {
      throw new BawCliError('Quote expired. Run preview again.');
    }

    const validAfter = Number(auth.validAfter);
    if (Number.isFinite(validAfter) && validAfter > nowSec) {
      const waitMs = Math.min(5000, (validAfter - nowSec + 1) * 1000);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

export function formatTwoDecimals(val: string | number | undefined): string {
  if (val === undefined || val === null || val === '') return '0.00';
  const num = Number(val);
  if (Number.isNaN(num)) return String(val);
  if (num > 0 && num < 0.01) {
    return num.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  }
  return num.toFixed(2);
}
