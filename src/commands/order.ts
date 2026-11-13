import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  callBnbEndpoint,
  CrooApiError,
  decodeBase64Json,
  extractTxHashFromPaymentResponse,
  extractX402RequirementPayload,
  getBaseOrder,
  listBaseOrders,
  postBaseOrder,
  searchSkill,
} from '../api.js';
import {
  appendOrUpdateOrderLog,
  cacheSearchItems,
  deleteDraft,
  extractTrailingIdFromDisplayLine,
  findLocalOrder,
  getCachedAgent,
  getCachedService,
  loadConfig,
  readOrderLogs,
  resolveOrderIndexInput,
  resolveSearchIndexInput,
  saveDraft,
  takeDraft,
} from '../config.js';
import {
  COPY,
  formatAtomicUsdc,
  formatBaseOrderStatus,
  formatBnbOrderStatus,
  formatMissingRequirementsOutput,
  formatOrderList,
  formatQuoteCard,
  formatSlaDurationWords,
  formatSlaRemaining,
} from '../format.js';
import type {
  ApiErrorBody,
  BaseConfirmResponse,
  BawPaymentOption,
  InvalidRequirementsMetadata,
  OrderDraft,
  OrderLogEntry,
  SearchItem,
  X402PaymentRequiredBody,
} from '../types.js';
import {
  ensureWalletReady,
  formatTwoDecimals,
  getWalletSummary,
  previewX402Payment,
  signX402Payment,
  verifyAndPrepareSignedPayment,
  waitForApproveConfirmation,
} from '../wallet.js';

export interface PreviewCommandOptions {
  id: string;
  requirements?: string;
  method?: 'GET' | 'POST';
  json?: boolean;
}

export interface ConfirmCommandOptions {
  draftId: string;
  json?: boolean;
}

export interface StatusCommandOptions {
  orderId: string;
  json?: boolean;
}

export interface ResultCommandOptions {
  orderId: string;
  output?: string;
  json?: boolean;
}

export interface ListCommandOptions {
  json?: boolean;
}

const SENSITIVE_FILE_PATTERNS = [
  /(^|[\\/])\.env(\..+)?$/i,
  /(^|[\\/])\.ssh([\\/]|$)/i,
  /(^|[\\/])\.aws([\\/]|$)/i,
  /(^|[\\/])id_(rsa|ed25519|ecdsa|dsa)(\.pem)?$/i,
  /\.(pem|key|p12|pfx|keystore)$/i,
  /credentials?\.json$/i,
  /secrets?\.json$/i,
  /wallet\.json$/i,
  /keystore/i,
  /(^|[\\/])(seed|mnemonic)(\.txt|\.json)?$/i,
  /(^|[\\/])\.(npmrc|netrc|git-credentials)$/i,
];

const SENSITIVE_CONTENT_PATTERNS = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  /(?:^|["'\s,{;&])(?:[a-zA-Z0-9_.-]*?(?:private[_-]?key|priv[_-]?key|secret[_-]?key|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|session[_-]?token|bearer[_-]?token|seed[_-]?phrase|recovery[_-]?phrase|mnemonic|passphrase|password|passwd))["']?\s*(?::(?!:)|(?<![!<>=])=(?![=>]))\s*(?:["'][^"'\r\n]{8,}["']|\[\s*["'][^"'\r\n]{3,}|[^\s"',}\];()]{12,})/i,
  /\b(sk-ant-[a-zA-Z0-9_-]{12,}|sk-proj-[a-zA-Z0-9_-]{12,}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|gho_[a-zA-Z0-9]{20,}|ghs_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{20,}|glpat-[a-zA-Z0-9_-]{20,}|npm_[a-zA-Z0-9]{30,}|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|xox[baprs]-[a-zA-Z0-9-]{10,}|sk_live_[a-zA-Z0-9]{16,}|sk_test_[a-zA-Z0-9]{16,}|rk_live_[a-zA-Z0-9]{16,}|AIza[0-9A-Za-z_-]{35}|xprv[1-9A-HJ-NP-Za-km-z]{100,})\b/,
  /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
  /\bBearer\s+[a-zA-Z0-9._~+/=-]{16,}\b/i,
];

const CREDENTIAL_BLOCK_ERROR =
  'Blocked: Detected suspected private key or credential in requirements content. Never send secrets or credentials to an external agent.';

const SENSITIVE_SINGLE_WORDS = new Set([
  'mnemonic',
  'mnemonics',
  'passphrase',
  'password',
  'passwd',
  'keystore',
  'secret',
  'secrets',
  'credential',
  'credentials',
  'apikey',
  'xapikey',
  'privatekey',
  'privkey',
  'secretkey',
  'seedphrase',
  'recoveryphrase',
  'clientsecret',
  'appsecret',
  'apisecret',
  'jwtsecret',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'sessiontoken',
  'bearertoken',
  'idtoken',
  'apitoken',
]);

const SENSITIVE_EXACT_KEYS = new Set([
  'authorization',
  'cookie',
  'set_cookie',
]);

const SENSITIVE_COMPOUND_KEY_PATTERN =
  /(?:^|_)(api_key|private_key|priv_key|secret_key|secret_access_key|signing_key|master_key|access_token|refresh_token|auth_token|session_token|bearer_token|id_token|api_token|bot_token|oauth_token|seed_phrase|recovery_phrase|wallet_seed|mnemonic_seed|secret_seed)(?:_|$)/;

function isSensitiveCredentialKey(rawKey: string): boolean {
  const words = rawKey
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  if (words.some((w) => SENSITIVE_SINGLE_WORDS.has(w))) return true;
  const joined = words.join('_');
  if (SENSITIVE_EXACT_KEYS.has(joined)) return true;
  return SENSITIVE_COMPOUND_KEY_PATTERN.test(joined);
}

function hasNonEmptyCredentialValue(val: unknown): boolean {
  if (val === null || val === undefined || val === false) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (typeof val === 'number') return true;
  if (Array.isArray(val)) return val.some((item) => hasNonEmptyCredentialValue(item));
  if (typeof val === 'object') return Object.keys(val as Record<string, unknown>).length > 0;
  return false;
}

function inspectValueForCredentials(val: unknown, depth: number = 0): void {
  if (depth > 32 || val === null || val === undefined) return;

  if (typeof val === 'string') {
    for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
      if (pattern.test(val)) {
        throw new Error(CREDENTIAL_BLOCK_ERROR);
      }
    }
    const trimmed = val.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const inner = JSON.parse(trimmed);
        inspectValueForCredentials(inner, depth + 1);
      } catch {
        // Not valid nested JSON
      }
    }
    return;
  }

  if (Array.isArray(val)) {
    for (const item of val) {
      inspectValueForCredentials(item, depth + 1);
    }
    return;
  }

  if (typeof val === 'object') {
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (isSensitiveCredentialKey(k) && hasNonEmptyCredentialValue(v)) {
        throw new Error(CREDENTIAL_BLOCK_ERROR);
      }
      inspectValueForCredentials(v, depth + 1);
    }
  }
}

const MAX_REQUIREMENTS_BYTES = 64 * 1024; // 64KB payload limit

export function parseRequirementsInput(rawFlag?: string): {
  rawBody: string;
  parsed: unknown;
  sourceFilePath?: string;
} {
  if (rawFlag === undefined) {
    return { rawBody: '', parsed: undefined };
  }

  let content = rawFlag;
  let sourceFilePath: string | undefined;
  if (rawFlag.startsWith('@')) {
    const filePath = rawFlag.slice(1).trim();
    for (const pattern of SENSITIVE_FILE_PATTERNS) {
      if (pattern.test(filePath)) {
        throw new Error(
          `Blocked: Refusing to send sensitive credential file "${filePath}" in order requirements.`
        );
      }
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`Requirements file not found: ${filePath}`);
    }
    content = fs.readFileSync(filePath, 'utf8');
    if (!/\.json$/i.test(filePath)) {
      sourceFilePath = filePath;
    }
  }

  for (const pattern of SENSITIVE_CONTENT_PATTERNS) {
    if (pattern.test(content)) {
      throw new Error(CREDENTIAL_BLOCK_ERROR);
    }
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return { rawBody: '', parsed: undefined, sourceFilePath };
  }

  let rawBody: string;
  let parsed: unknown;
  try {
    const candidate = JSON.parse(trimmed);
    inspectValueForCredentials(candidate);
    if (
      (typeof candidate === 'object' && candidate !== null) ||
      typeof candidate === 'string'
    ) {
      parsed = candidate;
      rawBody = trimmed;
    } else {
      // Bare primitive (number/boolean/null) passed via CLI — wrap as JSON string for text requirements
      rawBody = JSON.stringify(trimmed);
      parsed = trimmed;
    }
  } catch (err) {
    if (err instanceof Error && err.message === CREDENTIAL_BLOCK_ERROR) {
      throw err;
    }
    // Plain text requirement: wrap as JSON string for Base API compatibility
    rawBody = JSON.stringify(trimmed);
    parsed = trimmed;
  }

  const byteLen = Buffer.byteLength(rawBody, 'utf8');
  if (byteLen > MAX_REQUIREMENTS_BYTES) {
    throw new Error(
      `Requirements payload exceeds the 64KB limit (${byteLen} bytes). Please trim the input before running preview.`
    );
  }

  return { rawBody, parsed, sourceFilePath };
}

function isLikelyAgentId(id: string): boolean {
  if (getCachedAgent(id) && !getCachedService(id)) {
    return true;
  }
  // BNB agent IDs have 2 segments: bsc:<tokenId>, while service IDs have 3: bsc:<tokenId>:<serviceKey>
  if (/^bsc:[^:]+$/i.test(id)) {
    return true;
  }
  // Conventional Base Agent IDs starting with agent- or agent_
  if (/^agent[-_]/i.test(id)) {
    return true;
  }
  return false;
}

function deepParseJsonStrings(val: unknown): unknown {
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return deepParseJsonStrings(JSON.parse(trimmed));
      } catch {
        return val;
      }
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map((item) => deepParseJsonStrings(item));
  }
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = deepParseJsonStrings(v);
    }
    return out;
  }
  return val;
}

const KNOWN_TOKEN_SYMBOLS: Record<string, string> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  '0x55d398326f99059ff775485246999027b3197955': 'USDT',
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 'USDC',
  '0xce24439f2d9c6a2289f741120fe202248b666666': 'U',
  '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d': 'USD1',
};

const KNOWN_TOKEN_DECIMALS: Record<string, number> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6,
  '0x55d398326f99059ff775485246999027b3197955': 18,
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d': 18,
  '0xce24439f2d9c6a2289f741120fe202248b666666': 18,
  '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d': 18,
};

const UNSUPPORTED_OPTION_REASONS = [
  'UNSUPPORTED_NETWORK',
  'UNSUPPORTED_SCHEME',
  'UNSUPPORTED_METHOD',
  'UNSUPPORTED_ASSET',
  'INVALID_ACCEPT_STRUCTURE',
];

function isOptionForChain(option: BawPaymentOption | undefined, chain: 'base' | 'bsc'): boolean {
  if (!option) return false;
  const expectedBinChain = chain === 'base' ? '8453' : '56';
  const expectedNetwork = chain === 'base' ? 'eip155:8453' : 'eip155:56';
  const binChain = (option.binanceChainId || '').trim();
  const net = (option.originalAccept?.network || '').trim();
  if (!binChain && !net) return false;
  if (binChain && binChain !== expectedBinChain) return false;
  if (net && net !== expectedNetwork) return false;
  return true;
}

function formatUnsupportedPaymentOutput(
  asJson: boolean,
  reasons: string[] = ['UNSUPPORTED_NETWORK']
): string {
  const effectiveReasons = reasons.length > 0 ? reasons : ['UNSUPPORTED_NETWORK'];
  if (asJson) {
    return JSON.stringify(
      {
        status: 'unsupported_payment_method',
        error: COPY.UNSUPPORTED_PAYMENT_METHOD,
        reasons: effectiveReasons,
      },
      null,
      2
    );
  }
  return COPY.UNSUPPORTED_PAYMENT_METHOD;
}

function parseAtomicUint(val: unknown): bigint | null {
  if (typeof val === 'number') {
    if (!Number.isSafeInteger(val) || val < 0) return null;
    return BigInt(val);
  }
  if (typeof val !== 'string') return null;
  const trimmed = val.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

function parseDecimalToAtomic(decimalStr: string, decimals: number): bigint | null {
  const trimmed = decimalStr.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const [whole, rawFrac = ''] = trimmed.split('.');
  const fracTrimmed = rawFrac.replace(/0+$/, '');
  if (fracTrimmed.length > decimals) return null;
  const paddedFrac = fracTrimmed.padEnd(decimals, '0');
  return BigInt(`${whole}${paddedFrac}`);
}

function resolveOptionCurrency(option?: BawPaymentOption, fallback: string = 'USDT'): string {
  if (option?.tokenSymbol) return option.tokenSymbol;
  const assetAddr = (option?.tokenAddress || option?.originalAccept?.asset || '').toLowerCase();
  return KNOWN_TOKEN_SYMBOLS[assetAddr] || fallback;
}

function describeWalletBlockReason(option?: BawPaymentOption): string | undefined {
  if (!option) {
    return COPY.UNSUPPORTED_PAYMENT_METHOD;
  }
  if (option.status === 'READY_TO_SIGN') {
    return undefined;
  }
  const reasons = option.reasons || [];
  if (reasons.includes('INSUFFICIENT_BALANCE')) {
    return 'INSUFFICIENT_BALANCE — top up your wallet';
  }
  if (reasons.includes('BLOCKED_DAILY_LIMIT_REACHED')) {
    return 'BLOCKED_DAILY_LIMIT_REACHED — daily limit reached';
  }
  if (reasons.includes('BLOCKED_BY_SECURITY_CHECK')) {
    return 'BLOCKED_BY_SECURITY_CHECK — blocked by security check';
  }
  if (reasons.some((r) => UNSUPPORTED_OPTION_REASONS.includes(r))) {
    return COPY.UNSUPPORTED_PAYMENT_METHOD;
  }
  return reasons.join(', ') || `Wallet status: ${option.status}`;
}

export async function runOrderPreviewCommand(opts: PreviewCommandOptions): Promise<string> {
  let id = (opts.id || '').trim();
  if (!id) {
    throw new Error(
      "Usage: croo order preview <id> [--requirements @file.json | '<json>'] [--method GET|POST]"
    );
  }

  const byIdx = resolveSearchIndexInput(id, 'service');
  if (byIdx) {
    id = byIdx.type === 'service' && byIdx.serviceId ? byIdx.serviceId : byIdx.agentId || id;
  } else {
    id = extractTrailingIdFromDisplayLine(id);
  }

  if (isLikelyAgentId(id)) {
    if (opts.json) {
      return JSON.stringify(
        {
          error: 'NOT_A_SERVICE',
          message: COPY.NOT_A_SERVICE(id),
        },
        null,
        2
      );
    }
    return COPY.NOT_A_SERVICE(id);
  }

  const { rawBody, parsed, sourceFilePath } = parseRequirementsInput(opts.requirements);

  if (id.startsWith('bsc:')) {
    return runBnbPreview(
      id,
      rawBody,
      parsed,
      opts.method || 'POST',
      Boolean(opts.json),
      sourceFilePath
    );
  }
  return runBasePreview(id, rawBody, parsed, Boolean(opts.json), sourceFilePath);
}

async function runBasePreview(
  serviceId: string,
  rawBody: string,
  parsedRequirements: unknown,
  asJson: boolean,
  sourceFilePath?: string
): Promise<string> {
  const res = await postBaseOrder(serviceId, rawBody);
  const bodyObj = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<
    string,
    unknown
  >;

  if (res.httpStatus === 400) {
    const reason = String(bodyObj.reason || '');
    if (reason === 'NOT_A_SERVICE') {
      return asJson
        ? JSON.stringify({ error: 'NOT_A_SERVICE', message: COPY.NOT_A_SERVICE(serviceId) }, null, 2)
        : COPY.NOT_A_SERVICE(serviceId);
    }
    if (reason === 'BSC_DIRECT_PAYMENT') {
      return runBnbPreview(serviceId, rawBody, parsedRequirements, 'POST', asJson, sourceFilePath);
    }
    if (reason === 'INVALID_REQUIREMENTS') {
      const meta = (bodyObj.metadata || {}) as unknown as InvalidRequirementsMetadata;
      if (asJson) {
        return JSON.stringify(
          {
            status: 'missing_requirements',
            serviceId,
            ...meta,
          },
          null,
          2
        );
      }
      return formatMissingRequirementsOutput(serviceId, meta, rawBody.length > 0);
    }
    const errMsg = String(bodyObj.message || `Preview failed (${reason || 400})`);
    throw new Error(`${errMsg}. Try running \`croo search\` again.`);
  }

  if (res.httpStatus === 404 || res.httpStatus === 409) {
    const errMsg = String(
      bodyObj.message || 'Service is offline or no longer accepting orders'
    );
    throw new Error(`${errMsg}. Run \`croo search\` to find another service.`);
  }

  if (res.httpStatus === 429) {
    throw new Error('Rate limit exceeded. Please wait a moment and try again.');
  }

  if (res.httpStatus === 503) {
    const reason = String(bodyObj.reason || 'SKILL_DISABLED');
    throw new Error(
      `CROO Skill API is currently unavailable (${reason}): ${
        bodyObj.message || 'Service under maintenance'
      }`
    );
  }

  if (res.httpStatus !== 402) {
    const errMsg = String(
      bodyObj.message || `Unexpected response status ${res.httpStatus}`
    );
    throw new Error(errMsg);
  }

  // 402 Payment Required -> Check wallet & call `baw x402-payment preview`
  await ensureWalletReady();

  const { rawForBaw, parsed: x402Body } = extractX402RequirementPayload(
    res.paymentRequiredHeader,
    res.body
  );
  if (!rawForBaw || !x402Body) {
    throw new Error('Invalid 402 response from server: missing x402 payment requirements.');
  }

  const baseAccepts = (x402Body.accepts || []).filter((a) => a.network === 'eip155:8453');
  if (baseAccepts.length === 0) {
    return formatUnsupportedPaymentOutput(asJson, ['UNSUPPORTED_NETWORK']);
  }

  const bawPreview = await previewX402Payment(rawForBaw);
  const baseOptions = bawPreview.options.filter((o) => isOptionForChain(o, 'base'));
  const baseOption =
    baseOptions.find((o) => o.status === 'READY_TO_SIGN') || baseOptions[0];

  if (!baseOption) {
    return formatUnsupportedPaymentOutput(asJson, ['UNSUPPORTED_NETWORK']);
  }

  if (
    baseOption.status === 'NOT_SIGNABLE' &&
    baseOption.reasons?.some((r) => UNSUPPORTED_OPTION_REASONS.includes(r))
  ) {
    return formatUnsupportedPaymentOutput(asJson, baseOption.reasons);
  }

  const baseAccept =
    baseAccepts.find(
      (a) =>
        (!baseOption.originalAccept?.asset ||
          !a.asset ||
          a.asset.toLowerCase() === baseOption.originalAccept.asset.toLowerCase()) &&
        (!baseOption.originalAccept?.scheme ||
          !a.scheme ||
          a.scheme === baseOption.originalAccept.scheme)
    ) || baseAccepts[0];

  const acceptAmount = parseAtomicUint(baseAccept.amount);
  if (acceptAmount === null) {
    throw new Error('Invalid 402 response from server: invalid Base payment amount in accepts.');
  }

  if (res.paymentRequiredHeader) {
    const headerPayload = decodeBase64Json<X402PaymentRequiredBody>(res.paymentRequiredHeader);
    if (headerPayload && Array.isArray(headerPayload.accepts)) {
      const headerBaseAccept = headerPayload.accepts.find((a) => a.network === 'eip155:8453');
      if (headerBaseAccept) {
        const headerAmt = parseAtomicUint(headerBaseAccept.amount);
        if (headerAmt === null || headerAmt !== acceptAmount) {
          throw new Error(
            'Payment quote mismatch: PAYMENT-REQUIRED header amount does not match 402 body accepts amount. Refusing to create draft.'
          );
        }
        if (
          headerBaseAccept.payTo &&
          baseAccept.payTo &&
          headerBaseAccept.payTo.trim().toLowerCase() !== baseAccept.payTo.trim().toLowerCase()
        ) {
          throw new Error(
            'Payment quote mismatch: PAYMENT-REQUIRED header payTo does not match 402 body accepts payTo. Refusing to create draft.'
          );
        }
      }
    }
  }

  const optionOriginalAmount = parseAtomicUint(baseOption.originalAccept?.amount);
  if (optionOriginalAmount === null || optionOriginalAmount !== acceptAmount) {
    throw new Error(
      `Payment quote mismatch: wallet option amount (${
        baseOption.originalAccept?.amount ?? 'missing'
      }) does not match 402 accepts amount (${acceptAmount.toString()}). Refusing to create draft.`
    );
  }

  const baseAssetAddr = (
    baseOption.tokenAddress ||
    baseOption.originalAccept?.asset ||
    baseAccept.asset ||
    ''
  ).toLowerCase();
  const baseDecimals = KNOWN_TOKEN_DECIMALS[baseAssetAddr] ?? 6;
  if (baseOption.amount != null && String(baseOption.amount).trim() !== '') {
    const optionHumanAtomic = parseDecimalToAtomic(String(baseOption.amount), baseDecimals);
    if (optionHumanAtomic === null || optionHumanAtomic !== acceptAmount) {
      throw new Error(
        `Payment quote mismatch: wallet display amount (${baseOption.amount}) does not match atomic payment amount (${acceptAmount.toString()}). Refusing to create draft.`
      );
    }
  }

  const acceptPayTo = (baseAccept.payTo || '').trim().toLowerCase();
  const optOrigPayTo = (baseOption.originalAccept?.payTo || '').trim().toLowerCase();
  const optPayTo = (baseOption.payTo || '').trim().toLowerCase();
  if (
    (acceptPayTo && optOrigPayTo && acceptPayTo !== optOrigPayTo) ||
    (acceptPayTo && optPayTo && acceptPayTo !== optPayTo) ||
    (optOrigPayTo && optPayTo && optOrigPayTo !== optPayTo)
  ) {
    throw new Error(
      'Payment quote mismatch: recipient (payTo) differs between 402 response and wallet preview option. Refusing to create draft.'
    );
  }

  const acceptAsset = (baseAccept.asset || '').trim().toLowerCase();
  const optOrigAsset = (baseOption.originalAccept?.asset || '').trim().toLowerCase();
  const optTokenAddr = (baseOption.tokenAddress || '').trim().toLowerCase();
  if (
    (acceptAsset && optOrigAsset && acceptAsset !== optOrigAsset) ||
    (acceptAsset && optTokenAddr && acceptAsset !== optTokenAddr)
  ) {
    throw new Error(
      'Payment quote mismatch: token asset differs between 402 response and wallet preview option. Refusing to create draft.'
    );
  }

  const cachedSvc = getCachedService(serviceId);
  const quote = x402Body.quote;
  let priceAtomic = acceptAmount.toString();
  let gasAtomic = '0';
  let totalAtomic = acceptAmount.toString();

  if (quote !== undefined && quote !== null) {
    const quoteTotal = parseAtomicUint(quote.total);
    if (quoteTotal === null) {
      throw new Error('Invalid Base 402 quote: total must be a non-negative integer atomic amount.');
    }
    if (quoteTotal !== acceptAmount) {
      throw new Error(
        `Quote amount mismatch: quote.total (${quote.total}) does not match signable payment amount (${acceptAmount.toString()}). Refusing to create draft.`
      );
    }
    const quotePrice = parseAtomicUint(quote.price);
    const quoteGas = parseAtomicUint(quote.gas ?? '0');
    if (quotePrice === null || quoteGas === null) {
      throw new Error(
        'Invalid Base 402 quote: price and gas must be non-negative integer atomic amounts.'
      );
    }
    if (quotePrice + quoteGas !== quoteTotal) {
      throw new Error(
        `Invalid Base 402 quote: price (${quote.price}) + gas (${quote.gas ?? '0'}) does not equal total (${quote.total}). Refusing to create draft.`
      );
    }
    if (
      quote.currency &&
      baseOption.tokenSymbol &&
      quote.currency.trim().toUpperCase() !== baseOption.tokenSymbol.trim().toUpperCase()
    ) {
      throw new Error(
        `Quote currency mismatch: quote.currency (${quote.currency}) does not match wallet option token (${baseOption.tokenSymbol}). Refusing to create draft.`
      );
    }
    priceAtomic = quotePrice.toString();
    gasAtomic = quoteGas.toString();
    totalAtomic = quoteTotal.toString();
  }

  const currency = quote?.currency || resolveOptionCurrency(baseOption, 'USDC');
  const slaMinutes = quote?.slaMinutes || cachedSvc?.slaMinutes || 30;
  const maxTimeout =
    baseOption.originalAccept?.maxTimeoutSeconds ||
    baseAccept.maxTimeoutSeconds ||
    300;

  const draftId = `d_${crypto.randomBytes(4).toString('hex')}`;
  const { apiBaseUrl } = loadConfig();

  const draft: OrderDraft = {
    draftId,
    createdAt: new Date().toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + maxTimeout,
    chain: 'base',
    serviceId,
    serviceName: quote?.serviceName || cachedSvc?.name || serviceId,
    agentId: cachedSvc?.agentId || '',
    agentName: quote?.agentName || cachedSvc?.agentName || 'Agent',
    endpoint: `${apiBaseUrl}/backend/v1/skill/services/${encodeURIComponent(serviceId)}/order`,
    method: 'POST',
    requirementsRaw: rawBody,
    requirementsParsed: parsedRequirements ?? {},
    ...(sourceFilePath ? { requirementsFile: sourceFilePath } : {}),
    paymentId: bawPreview.paymentId,
    selectedIndex: baseOption?.index ?? 1,
    selectedOption: baseOption,
    currency,
    priceHuman: formatAtomicUsdc(priceAtomic),
    gasHuman: formatAtomicUsdc(gasAtomic),
    totalHuman: formatAtomicUsdc(totalAtomic),
    priceAtomic: totalAtomic,
    slaMinutes,
  };

  const walletErrorReason = describeWalletBlockReason(baseOption);
  const walletBalanceHuman = formatTwoDecimals(baseOption?.currentBalance ?? '0');

  if (!walletErrorReason) {
    saveDraft(draft);
  }

  if (asJson) {
    return JSON.stringify(
      {
        status: walletErrorReason ? 'blocked' : 'ready_to_confirm',
        draftId: walletErrorReason ? null : draft.draftId,
        confirmCommand: walletErrorReason ? null : `croo order confirm ${draft.draftId}`,
        confirmPrompt: walletErrorReason
          ? null
          : `Reply \`croo order confirm ${draft.draftId}\` to authorize the ${draft.totalHuman} ${draft.currency} payment.`,
        walletErrorReason: walletErrorReason || null,
        quote: {
          chain: 'base',
          settlement: 'cap_escrow',
          serviceId: draft.serviceId,
          serviceName: draft.serviceName,
          agentName: draft.agentName,
          currency: draft.currency,
          price: draft.priceHuman,
          gas: draft.gasHuman,
          total: draft.totalHuman,
          slaMinutes: draft.slaMinutes,
          walletBalance: walletBalanceHuman,
          requirements: draft.requirementsParsed,
        },
      },
      null,
      2
    );
  }

  return formatQuoteCard({
    draft,
    walletBalanceHuman,
    walletErrorReason,
  });
}

async function resolveBnbServiceMetadata(serviceId: string): Promise<SearchItem> {
  const cached = getCachedService(serviceId);
  if (cached && cached.endpoint) {
    return cached;
  }
  // Extract agentId prefix `bsc:<tokenId>` from `bsc:<tokenId>:<key>`
  const parts = serviceId.split(':');
  if (parts.length >= 3) {
    const agentId = `${parts[0]}:${parts[1]}`;
    const searchResp = await searchSkill({ agentId }).catch(() => null);
    if (searchResp?.items) {
      cacheSearchItems(searchResp.items, searchResp.agent, false);
      const found = searchResp.items.find((i) => i.serviceId === serviceId);
      if (found && found.endpoint) {
        return found;
      }
    }
  }
  throw new Error(
    `BNB service "${serviceId}" not found or has no active HTTP x402 endpoint. Run \`croo search\` again.`
  );
}

async function runBnbPreview(
  serviceId: string,
  rawBody: string,
  parsedRequirements: unknown,
  method: 'GET' | 'POST',
  asJson: boolean,
  sourceFilePath?: string
): Promise<string> {
  const svc = await resolveBnbServiceMetadata(serviceId);
  const effectiveBody = rawBody || (method === 'POST' ? '{}' : '');

  let callRes;
  try {
    callRes = await callBnbEndpoint({
      endpoint: svc.endpoint,
      method,
      requirementsRaw: effectiveBody,
    });
  } catch (err) {
    throw new Error(
      `BNB agent endpoint unreachable (${svc.endpoint}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  // If BNB endpoint returns 2xx directly without 402, treat as free call
  if (callRes.httpStatus >= 200 && callRes.httpStatus < 300) {
    const freeOrderId = `bnb_free_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    appendOrUpdateOrderLog({
      orderId: freeOrderId,
      chain: 'bsc',
      serviceId: svc.serviceId,
      serviceName: svc.name,
      agentId: svc.agentId,
      agentName: svc.agentName,
      amount: '0.00',
      currency: 'FREE',
      wallet: 'none',
      payer: '',
      payTo: '',
      txHash: '',
      phase: 'free',
      status: 'free',
      createdAt: now,
      updatedAt: now,
      requirements: parsedRequirements ?? effectiveBody,
      bnbResponseBody: callRes.rawText,
      bnbResponseContentType: callRes.contentType,
      bnbHttpStatus: callRes.httpStatus,
    });

    if (asJson) {
      return JSON.stringify(
        {
          status: 'free_completed',
          orderId: freeOrderId,
          chain: 'bsc',
          result: callRes.jsonBody ?? callRes.rawText,
        },
        null,
        2
      );
    }
    return [
      `Endpoint returned ${callRes.httpStatus} without requiring payment (logged as free order ${freeOrderId}):`,
      '',
      callRes.rawText,
    ].join('\n');
  }

  // 4xx (other than 402) or 5xx -> return error details so Agent can fix request
  if (callRes.httpStatus !== 402) {
    throw new Error(
      `Agent endpoint returned HTTP ${callRes.httpStatus}: ${
        callRes.rawText || 'Bad Request'
      }`
    );
  }

  // 402 Payment Required
  await ensureWalletReady();

  const { rawForBaw, parsed: x402Body } = extractX402RequirementPayload(
    callRes.paymentRequiredHeader,
    callRes.jsonBody
  );
  if (!rawForBaw) {
    throw new Error('BNB agent endpoint returned 402 without valid x402 payment requirements.');
  }

  if (x402Body?.accepts) {
    const bscAccepts = x402Body.accepts.filter((a) => a.network === 'eip155:56');
    if (bscAccepts.length === 0) {
      return formatUnsupportedPaymentOutput(asJson, ['UNSUPPORTED_NETWORK']);
    }
  }

  const bawPreview = await previewX402Payment(rawForBaw);
  // Pick recommended READY_TO_SIGN option strictly on BSC (network = eip155:56 / binanceChainId = 56)
  const bscOptions = bawPreview.options.filter((o) => isOptionForChain(o, 'bsc'));
  const selectedOption =
    bscOptions.find((o) => o.status === 'READY_TO_SIGN') || bscOptions[0];

  if (!selectedOption) {
    return formatUnsupportedPaymentOutput(asJson, ['UNSUPPORTED_NETWORK']);
  }

  if (
    selectedOption.status === 'NOT_SIGNABLE' &&
    selectedOption.reasons?.some((r) => UNSUPPORTED_OPTION_REASONS.includes(r))
  ) {
    return formatUnsupportedPaymentOutput(asJson, selectedOption.reasons);
  }

  const bscAtomicAmount = parseAtomicUint(selectedOption.originalAccept?.amount);
  if (bscAtomicAmount === null) {
    throw new Error(
      'Invalid BNB 402 preview: wallet option is missing a valid atomic payment amount.'
    );
  }

  const bscAssetAddr = (
    selectedOption.tokenAddress ||
    selectedOption.originalAccept?.asset ||
    ''
  ).toLowerCase();
  const knownBscDecimals = KNOWN_TOKEN_DECIMALS[bscAssetAddr];
  if (
    knownBscDecimals !== undefined &&
    selectedOption.amount != null &&
    String(selectedOption.amount).trim() !== ''
  ) {
    const bscHumanAtomic = parseDecimalToAtomic(String(selectedOption.amount), knownBscDecimals);
    if (bscHumanAtomic === null || bscHumanAtomic !== bscAtomicAmount) {
      throw new Error(
        `Payment quote mismatch: wallet display amount (${selectedOption.amount}) does not match atomic payment amount (${bscAtomicAmount.toString()}). Refusing to create draft.`
      );
    }
  }

  let matchedBscAcceptTimeout: number | undefined;
  if (x402Body?.accepts) {
    const optPayTo = (selectedOption.payTo || selectedOption.originalAccept?.payTo || '')
      .trim()
      .toLowerCase();
    const optOrigPayTo = (selectedOption.originalAccept?.payTo || '').trim().toLowerCase();
    if (
      selectedOption.payTo &&
      optOrigPayTo &&
      selectedOption.payTo.trim().toLowerCase() !== optOrigPayTo
    ) {
      throw new Error(
        'Payment quote mismatch: recipient (payTo) differs within wallet preview option. Refusing to create draft.'
      );
    }
    const matchedBscAccept = x402Body.accepts.find((a) => {
      if (a.network !== 'eip155:56') return false;
      const aAmt = parseAtomicUint(a.amount);
      if (aAmt === null || aAmt !== bscAtomicAmount) return false;
      if (a.payTo && optPayTo && a.payTo.trim().toLowerCase() !== optPayTo) return false;
      if (a.asset && bscAssetAddr && a.asset.trim().toLowerCase() !== bscAssetAddr) return false;
      return true;
    });
    if (!matchedBscAccept) {
      throw new Error(
        'Payment quote mismatch: wallet preview option does not match any BSC accept entry in the 402 response. Refusing to create draft.'
      );
    }
    matchedBscAcceptTimeout = matchedBscAccept.maxTimeoutSeconds;
  }

  const currency = resolveOptionCurrency(selectedOption, 'USDT');
  const priceHuman = formatTwoDecimals(selectedOption.amount || '0');
  const maxTimeout =
    selectedOption.originalAccept?.maxTimeoutSeconds ||
    matchedBscAcceptTimeout ||
    300;

  const draftId = `d_bnb_${crypto.randomBytes(4).toString('hex')}`;
  const draft: OrderDraft = {
    draftId,
    createdAt: new Date().toISOString(),
    expiresAt: Math.floor(Date.now() / 1000) + maxTimeout,
    chain: 'bsc',
    serviceId: svc.serviceId,
    serviceName: svc.name,
    agentId: svc.agentId,
    agentName: svc.agentName,
    endpoint: callRes.finalUrl,
    method,
    requirementsRaw: effectiveBody,
    requirementsParsed: parsedRequirements ?? effectiveBody,
    ...(sourceFilePath ? { requirementsFile: sourceFilePath } : {}),
    paymentId: bawPreview.paymentId,
    selectedIndex: selectedOption.index,
    selectedOption,
    currency,
    priceHuman,
    gasHuman: '0.00',
    totalHuman: priceHuman,
    priceAtomic: bscAtomicAmount.toString(),
    score: svc.score,
    feedbackCount: svc.feedbackCount,
  };

  const walletErrorReason = describeWalletBlockReason(selectedOption);
  const walletBalanceHuman = formatTwoDecimals(selectedOption.currentBalance ?? '0');

  if (!walletErrorReason) {
    saveDraft(draft);
  }

  if (asJson) {
    return JSON.stringify(
      {
        status: walletErrorReason ? 'blocked' : 'ready_to_confirm',
        draftId: walletErrorReason ? null : draft.draftId,
        confirmCommand: walletErrorReason ? null : `croo order confirm ${draft.draftId}`,
        confirmPrompt: walletErrorReason
          ? null
          : `Reply \`croo order confirm ${draft.draftId}\` to authorize the ${draft.totalHuman} ${draft.currency} payment.`,
        walletErrorReason: walletErrorReason || null,
        quote: {
          chain: 'bsc',
          settlement: 'b402_direct',
          serviceId: draft.serviceId,
          serviceName: draft.serviceName,
          agentName: draft.agentName,
          currency: draft.currency,
          price: draft.priceHuman,
          gas: COPY.BNB_GAS,
          payTo: selectedOption.payTo,
          walletBalance: walletBalanceHuman,
          score: draft.score,
          feedbackCount: draft.feedbackCount,
          request: {
            method: draft.method,
            url: draft.endpoint,
            body: draft.requirementsRaw,
          },
        },
      },
      null,
      2
    );
  }

  return formatQuoteCard({
    draft,
    walletBalanceHuman,
    walletErrorReason,
  });
}

export async function runOrderConfirmCommand(opts: ConfirmCommandOptions): Promise<string> {
  let draftId = (opts.draftId || '').trim().replace(/^`+|`+$/g, '').trim();
  const cmdPrefixMatch = draftId.match(/^(?:croo\s+order\s+confirm|confirm)\s+(d_(?:bnb_)?[a-f0-9]+)$/i);
  if (cmdPrefixMatch) {
    draftId = cmdPrefixMatch[1];
  }
  if (!draftId) {
    throw new Error('Usage: croo order confirm <draft_id>');
  }

  const lease = takeDraft(draftId);
  if (!lease) {
    throw new Error(`Draft "${draftId}" not found or already used. Run \`croo order preview\` again.`);
  }
  const { draft } = lease;

  const nowSec = Math.floor(Date.now() / 1000);
  if (draft.expiresAt && nowSec >= draft.expiresAt) {
    lease.consume();
    throw new Error(COPY.QUOTE_EXPIRED);
  }

  if (!isOptionForChain(draft.selectedOption, draft.chain)) {
    lease.consume();
    throw new Error(COPY.UNSUPPORTED_PAYMENT_METHOD);
  }

  const draftAtomic = parseAtomicUint(draft.priceAtomic);
  const optionAtomic = parseAtomicUint(draft.selectedOption?.originalAccept?.amount);
  if (draftAtomic === null || (optionAtomic !== null && optionAtomic !== draftAtomic)) {
    lease.consume();
    throw new Error(COPY.PRICE_CHANGED);
  }

  try {
    await ensureWalletReady();
  } catch (err) {
    // Wallet not signed in yet — restore draft so user can sign in and confirm if still unexpired
    lease.restore();
    throw err;
  }

  let signData;
  try {
    signData = await signX402Payment(draft.paymentId, draft.selectedIndex);
  } catch (err) {
    lease.consume();
    const msg = err instanceof Error ? err.message : String(err);
    if (/expired/i.test(msg)) {
      throw new Error(COPY.QUOTE_EXPIRED);
    }
    throw err;
  }

  if (signData.signatureExpiresAt && Math.floor(Date.now() / 1000) >= signData.signatureExpiresAt) {
    lease.consume();
    throw new Error(COPY.QUOTE_EXPIRED);
  }

  const expectedBinChain = draft.chain === 'bsc' ? '56' : '8453';
  const expectedNetwork = draft.chain === 'bsc' ? 'eip155:56' : 'eip155:8453';

  try {
    if (signData.binanceChainId && String(signData.binanceChainId).trim() !== expectedBinChain) {
      throw new Error(COPY.UNSUPPORTED_PAYMENT_METHOD);
    }

    // If Permit2 approval tx was dispatched alongside signature, wait for it to confirm first
    if (signData.approveTxHash) {
      await waitForApproveConfirmation(
        signData.approveTxHash,
        signData.binanceChainId || expectedBinChain
      );
    }

    // Verify signed payment envelope matches previewed network/recipient/amount and wait for validAfter window
    await verifyAndPrepareSignedPayment(
      signData.paymentHeaderValue,
      draft.selectedOption?.payTo || draft.selectedOption?.originalAccept?.payTo,
      draft.priceAtomic,
      expectedNetwork
    );
  } catch (err) {
    lease.consume();
    throw err;
  }

  const paymentHeader = {
    name: signData.paymentHeaderName || 'PAYMENT-SIGNATURE',
    value: signData.paymentHeaderValue,
  };

  try {
    if (draft.chain === 'base') {
      return await confirmBaseDraft(draft, paymentHeader, Boolean(opts.json));
    }
    return await confirmBnbDraft(draft, paymentHeader, Boolean(opts.json));
  } finally {
    lease.consume();
  }
}

async function confirmBaseDraft(
  draft: OrderDraft,
  paymentHeader: { name: string; value: string },
  asJson: boolean
): Promise<string> {
  // Replay request with at most 1 automatic retry on network error
  let res;
  try {
    res = await postBaseOrder(draft.serviceId, draft.requirementsRaw, paymentHeader, 130_000);
  } catch {
    try {
      res = await postBaseOrder(draft.serviceId, draft.requirementsRaw, paymentHeader, 130_000);
    } catch (retryErr) {
      deleteDraft(draft.draftId);
      throw new Error(
        `Network error while submitting payment (retried once with the same signature): ${
          retryErr instanceof Error ? retryErr.message : String(retryErr)
        }. Run \`croo order list\` to check whether the order was created before running \`preview\` again.`
      );
    }
  }

  deleteDraft(draft.draftId);

  const bodyObj = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<
    string,
    unknown
  >;

  if (res.httpStatus === 200) {
    const confirmed = bodyObj as unknown as BaseConfirmResponse;
    let settlementTx =
      extractTxHashFromPaymentResponse(res.paymentResponseHeader) ||
      confirmed.lockTxHash ||
      '';
    const now = new Date().toISOString();

    const logEntry: OrderLogEntry = {
      orderId: confirmed.orderId,
      draftId: draft.draftId,
      chain: 'base',
      serviceId: draft.serviceId,
      serviceName: draft.serviceName,
      agentId: draft.agentId,
      agentName: draft.agentName,
      amount: draft.totalHuman,
      currency: draft.currency,
      wallet: 'Binance Agentic Wallet',
      payer: confirmed.payer || draft.selectedOption?.userWalletAddress || '',
      payTo: draft.selectedOption?.payTo || draft.selectedOption?.originalAccept?.payTo || '',
      txHash: settlementTx,
      lockTxHash: confirmed.lockTxHash,
      phase: confirmed.phase || 'locked',
      status: confirmed.status || 'paid',
      createdAt: now,
      updatedAt: now,
      slaMinutes: draft.slaMinutes,
      slaDeadline: confirmed.slaDeadline,
      requirements: draft.requirementsParsed,
    };
    appendOrUpdateOrderLog(logEntry);

    // If on-chain confirmation didn't finish within backend wait window,
    // backend returns 200 with phase="pending" and CLI polls GET /orders/{orderId}
    if (confirmed.phase === 'pending') {
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const polled = await getBaseOrder(confirmed.orderId).catch(() => null);
        if (polled && polled.phase !== 'pending') {
          confirmed.phase = polled.phase;
          confirmed.status = polled.status;
          if (polled.slaDeadline) {
            confirmed.slaDeadline = polled.slaDeadline;
          }
          const paidTx =
            polled.timeline?.find((t) => t.phase === 'paid')?.txHash ||
            polled.timeline?.[0]?.txHash;
          if (paidTx) {
            confirmed.lockTxHash = paidTx;
            settlementTx = paidTx;
          }
          appendOrUpdateOrderLog({
            ...logEntry,
            phase: confirmed.phase,
            status: confirmed.status,
            slaDeadline: confirmed.slaDeadline,
            txHash: settlementTx,
            lockTxHash: confirmed.lockTxHash,
          });
          break;
        }
      }
    }

    if (asJson) {
      return JSON.stringify(confirmed, null, 2);
    }

    const lines: string[] = [
      `Order confirmed!`,
      `  Order ID   ${confirmed.orderId}`,
      `  Service    ${draft.agentName} · ${draft.serviceName}`,
      `  Chain      Base · ${draft.currency} · CAP escrow`,
      `  Paid       ${draft.totalHuman} ${draft.currency}`,
      `  Phase      ${confirmed.phase}`,
    ];
    if (confirmed.lockTxHash) {
      lines.push(`  Lock Tx    ${confirmed.lockTxHash}`);
    }
    if (confirmed.slaDeadline) {
      lines.push(`  Deadline   ${confirmed.slaDeadline}`);
    }
    lines.push('');
    const slaMins = draft.slaMinutes || 30;
    if (slaMins > 10) {
      lines.push(COPY.LONG_SLA(formatSlaDurationWords(slaMins), confirmed.orderId));
    } else {
      lines.push(`Check status with: croo order status ${confirmed.orderId}`);
      lines.push(`Get result with:   croo order result ${confirmed.orderId}`);
    }
    return lines.join('\n');
  }

  const reason = String(bodyObj.reason || '');
  if (res.httpStatus === 402 && reason === 'PRICE_CHANGED') {
    throw new Error(COPY.PRICE_CHANGED);
  }
  if (res.httpStatus === 402 && reason === 'QUOTE_EXPIRED') {
    throw new Error(COPY.QUOTE_EXPIRED);
  }
  if (res.httpStatus === 402 && reason === 'INSUFFICIENT_FUNDS') {
    throw new Error('Insufficient USDC balance on Base. Please top up your Binance Agentic Wallet.');
  }
  if (res.httpStatus === 400 && reason === 'INVALID_PAYMENT') {
    throw new Error(
      `Payment signature rejected (${bodyObj.message || 'INVALID_PAYMENT'}). Your funds were NOT deducted. Run \`croo order preview\` again.`
    );
  }
  if (res.httpStatus === 404 || res.httpStatus === 409) {
    throw new Error(
      `${bodyObj.message || 'Service is no longer available'}. Your funds were NOT deducted. Run \`croo search\` to find another service.`
    );
  }
  if (res.httpStatus === 429) {
    throw new Error(
      'Rate limit exceeded while submitting order. Your funds were NOT deducted. Please wait a moment and run `croo order preview` again.'
    );
  }
  if (res.httpStatus === 502 && reason === 'SETTLEMENT_FAILED') {
    const failedOrderId = (bodyObj.metadata as Record<string, unknown> | undefined)?.orderId;
    throw new Error(
      `On-chain settlement failed (${bodyObj.message || 'SETTLEMENT_FAILED'}). Your funds were NOT deducted.${
        failedOrderId ? ` (Attempt ID: ${failedOrderId})` : ''
      }`
    );
  }

  throw new Error(
    `Order confirmation failed (${reason || res.httpStatus}): ${
      bodyObj.message || JSON.stringify(bodyObj)
    }`
  );
}

async function confirmBnbDraft(
  draft: OrderDraft,
  paymentHeader: { name: string; value: string },
  asJson: boolean
): Promise<string> {
  let callRes;
  try {
    callRes = await callBnbEndpoint({
      endpoint: draft.endpoint,
      method: draft.method,
      requirementsRaw: draft.requirementsRaw,
      paymentHeader,
      timeoutMs: 120_000,
    });
  } catch {
    // At most 1 automatic retry with the same signature on network error
    try {
      callRes = await callBnbEndpoint({
        endpoint: draft.endpoint,
        method: draft.method,
        requirementsRaw: draft.requirementsRaw,
        paymentHeader,
        timeoutMs: 120_000,
      });
    } catch (retryErr) {
      deleteDraft(draft.draftId);
      throw new Error(
        `Network error while replaying paid request to BNB endpoint (retried once with the same signature): ${
          retryErr instanceof Error ? retryErr.message : String(retryErr)
        }. Check your wallet transaction history in Binance Agentic Wallet before retrying.`
      );
    }
  }

  deleteDraft(draft.draftId);

  const txHash = extractTxHashFromPaymentResponse(callRes.paymentResponseHeader);
  const shortSuffix = txHash ? txHash.slice(2, 10) : crypto.randomBytes(4).toString('hex');
  const orderId = `bnb_${shortSuffix}`;
  const now = new Date().toISOString();

  if (callRes.httpStatus === 402) {
    const bodyObj = (callRes.jsonBody || {}) as Record<string, unknown>;
    const errStr = String(bodyObj.error || bodyObj.reason || callRes.rawText || '');
    if (/expired/i.test(errStr)) {
      throw new Error(COPY.QUOTE_EXPIRED);
    }
    throw new Error(COPY.PRICE_CHANGED);
  }

  const isSuccess = callRes.httpStatus >= 200 && callRes.httpStatus < 300;
  const logEntry: OrderLogEntry = {
    orderId,
    draftId: draft.draftId,
    chain: 'bsc',
    serviceId: draft.serviceId,
    serviceName: draft.serviceName,
    agentId: draft.agentId,
    agentName: draft.agentName,
    amount: draft.totalHuman,
    currency: draft.currency,
    wallet: 'Binance Agentic Wallet',
    payer: draft.selectedOption?.userWalletAddress || '',
    payTo: draft.selectedOption?.payTo || '',
    txHash,
    phase: isSuccess ? 'completed' : 'failed',
    status: isSuccess ? 'completed' : `http_${callRes.httpStatus}`,
    createdAt: now,
    updatedAt: now,
    requirements: draft.requirementsParsed,
    bnbResponseBody: callRes.rawText,
    bnbResponseContentType: callRes.contentType,
    bnbHttpStatus: callRes.httpStatus,
    ...(isSuccess ? {} : { error: callRes.rawText || `HTTP ${callRes.httpStatus}` }),
  };
  appendOrUpdateOrderLog(logEntry);

  if (asJson) {
    return JSON.stringify(
      {
        orderId,
        chain: 'bsc',
        status: logEntry.status,
        txHash: txHash || null,
        httpStatus: callRes.httpStatus,
        result: callRes.jsonBody ?? callRes.rawText,
      },
      null,
      2
    );
  }

  if (!isSuccess) {
    return [
      `BNB Chain request returned HTTP ${callRes.httpStatus} after payment submission.`,
      `  Order ID   ${orderId}`,
      ...(txHash ? [`  Tx Hash    ${txHash}`] : []),
      `  ⚠ Note     Payment on BNB Chain (B402) has no escrow and cannot be refunded.`,
      '',
      'Endpoint error response:',
      callRes.rawText || `(empty HTTP ${callRes.httpStatus} body)`,
    ].join('\n');
  }

  return [
    `BNB Chain payment settled and response received!`,
    `  Order ID   ${orderId}`,
    `  Service    ${draft.agentName} · ${draft.serviceName}`,
    `  Paid       ${draft.totalHuman} ${draft.currency} (BNB Chain · B402)`,
    ...(txHash ? [`  Tx Hash    ${txHash}`] : []),
    '',
    'Result:',
    callRes.rawText,
    '',
    `Save to file anytime with: croo order result ${orderId} -o <file>`,
  ].join('\n');
}

export async function runOrderStatusCommand(opts: StatusCommandOptions): Promise<string> {
  let orderId = (opts.orderId || '').trim();
  if (!orderId) {
    throw new Error('Usage: croo order status <order_id>');
  }

  const byOrderIdx = resolveOrderIndexInput(orderId);
  if (byOrderIdx) {
    orderId = byOrderIdx.orderId;
  } else {
    orderId = extractTrailingIdFromDisplayLine(orderId);
  }

  const local = findLocalOrder(orderId);
  if (local && local.chain === 'bsc') {
    if (opts.json) {
      return JSON.stringify(local, null, 2);
    }
    return formatBnbOrderStatus(local);
  }
  if (orderId.startsWith('bnb_')) {
    throw new Error(
      `BNB Chain order "${orderId}" not found in local audit log (~/.croo/orders.jsonl).`
    );
  }

  const detail = await getBaseOrder(orderId);
  // Only update local audit log if this order is already in local log or belongs to connected wallet
  const summary = await getWalletSummary().catch(() => null);
  const isOwnOrder =
    Boolean(local) ||
    Boolean(
      summary?.connected &&
        summary.baseAddress &&
        detail.payer &&
        summary.baseAddress.toLowerCase() === detail.payer.toLowerCase()
    );

  if (isOwnOrder) {
    const settlementTx =
      detail.timeline?.find((t) => t.phase === 'paid')?.txHash ||
      detail.timeline?.[0]?.txHash ||
      local?.txHash ||
      '';
    appendOrUpdateOrderLog({
      orderId: detail.orderId,
      chain: 'base',
      serviceId: detail.serviceId,
      serviceName: detail.serviceName,
      agentId: detail.agentId,
      agentName: detail.agentName,
      amount: formatAtomicUsdc(detail.price),
      currency: 'USDC',
      wallet: 'Binance Agentic Wallet',
      payer: detail.payer,
      payTo: local?.payTo || '',
      txHash: settlementTx,
      phase: detail.phase,
      status: detail.status,
      createdAt: detail.createdAt,
      updatedAt: new Date().toISOString(),
      slaDeadline: detail.slaDeadline,
      requirements: detail.requirements,
    });
  }

  if (opts.json) {
    return JSON.stringify(detail, null, 2);
  }
  return formatBaseOrderStatus(detail);
}

export async function runOrderResultCommand(opts: ResultCommandOptions): Promise<string> {
  let orderId = (opts.orderId || '').trim();
  if (!orderId) {
    throw new Error('Usage: croo order result <order_id> [-o <file>]');
  }

  const byOrderIdx = resolveOrderIndexInput(orderId);
  if (byOrderIdx) {
    orderId = byOrderIdx.orderId;
  } else {
    orderId = extractTrailingIdFromDisplayLine(orderId);
  }

  const local = findLocalOrder(orderId);
  if (local && local.chain === 'bsc') {
    if (local.phase === 'failed' && !opts.output) {
      if (opts.json) {
        return JSON.stringify(
          {
            orderId,
            chain: 'bsc',
            phase: local.phase,
            status: local.status,
            delivered: false,
            error: local.error || local.bnbResponseBody || null,
          },
          null,
          2
        );
      }
      return `Order ${orderId} is failed (status: ${local.status}) and has no deliverable.${
        local.error ? ` Error: ${local.error}` : ''
      }`;
    }

    const content = local.bnbResponseBody ?? '';
    let formattedContent = content;
    let defaultExt = '.txt';
    try {
      const parsed = JSON.parse(content);
      formattedContent = JSON.stringify(parsed, null, 2) + '\n';
      defaultExt = '.json';
    } catch {
      defaultExt = '.md';
    }

    const outPath = path.resolve(
      process.cwd(),
      opts.output || `./order-${orderId}${defaultExt}`
    );
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, formattedContent, 'utf8');

    if (opts.json) {
      return JSON.stringify(
        {
          orderId,
          chain: 'bsc',
          status: local.status,
          outputFile: outPath,
          content,
        },
        null,
        2
      );
    }

    const lines = [`Saved deliverable to ${outPath}`];
    if (formattedContent.length <= 1200) {
      lines.push('', formattedContent.trimEnd());
    }
    return lines.join('\n');
  }
  if (orderId.startsWith('bnb_')) {
    throw new Error(
      `BNB Chain order "${orderId}" not found in local audit log (~/.croo/orders.jsonl).`
    );
  }

  // Base order
  const detail = await getBaseOrder(orderId);
  const summary = await getWalletSummary().catch(() => null);
  const isOwnOrder =
    Boolean(local) ||
    Boolean(
      summary?.connected &&
        summary.baseAddress &&
        detail.payer &&
        summary.baseAddress.toLowerCase() === detail.payer.toLowerCase()
    );
  if (isOwnOrder) {
    const settlementTx =
      detail.timeline?.find((t) => t.phase === 'paid')?.txHash ||
      detail.timeline?.[0]?.txHash ||
      local?.txHash ||
      '';
    appendOrUpdateOrderLog({
      orderId: detail.orderId,
      chain: 'base',
      serviceId: detail.serviceId,
      serviceName: detail.serviceName,
      agentId: detail.agentId,
      agentName: detail.agentName,
      amount: formatAtomicUsdc(detail.price),
      currency: 'USDC',
      wallet: 'Binance Agentic Wallet',
      payer: detail.payer,
      payTo: local?.payTo || '',
      txHash: settlementTx,
      phase: detail.phase,
      status: detail.status,
      createdAt: detail.createdAt,
      updatedAt: new Date().toISOString(),
      slaDeadline: detail.slaDeadline,
      requirements: detail.requirements,
    });
  }

  if (!detail.delivery) {
    const rem = formatSlaRemaining(detail.slaDeadline);
    if (opts.json) {
      return JSON.stringify(
        {
          orderId: detail.orderId,
          phase: detail.phase,
          status: detail.status,
          delivered: false,
          slaDeadline: detail.slaDeadline,
          slaRemaining: rem || null,
          refund: detail.refund,
        },
        null,
        2
      );
    }
    if (detail.phase === 'expired' || detail.phase === 'failed') {
      const refundMsg = detail.refund
        ? `Refund status: ${detail.refund.status} (${formatAtomicUsdc(detail.refund.amount)} USDC${
            detail.refund.txHash ? `, tx: ${detail.refund.txHash}` : ''
          }).`
        : detail.phase === 'failed'
          ? 'No funds were deducted.'
          : '';
      return `Order ${detail.orderId} is ${detail.phase} (status: ${detail.status}) and has no deliverable. ${refundMsg}`.trim();
    }
    return `Order ${detail.orderId} is not delivered yet (current phase: ${detail.phase}, status: ${detail.status}${
      rem ? `, SLA: ${rem}` : ''
    }).`;
  }

  const { deliverableType, deliverableText, deliverableSchema } = detail.delivery;
  let outputContent = '';
  let defaultExt = '.md';

  if (deliverableType === 'schema' && deliverableSchema) {
    defaultExt = '.json';
    try {
      const parsed = deepParseJsonStrings(JSON.parse(deliverableSchema));
      outputContent = JSON.stringify(parsed, null, 2) + '\n';
    } catch {
      outputContent = deliverableSchema;
    }
    if (deliverableText) {
      outputContent = `${deliverableText}\n\n${outputContent}`;
    }
  } else {
    outputContent = deliverableText || deliverableSchema || '';
    defaultExt = '.md';
  }

  const shortId = detail.orderId.slice(0, 8);
  const outPath = path.resolve(
    process.cwd(),
    opts.output || `./order-${shortId}${defaultExt}`
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, outputContent, 'utf8');

  if (opts.json) {
    return JSON.stringify(
      {
        orderId: detail.orderId,
        chain: 'base',
        phase: detail.phase,
        status: detail.status,
        delivered: true,
        deliverableType,
        submittedAt: detail.delivery.submittedAt,
        outputFile: outPath,
        content: outputContent,
      },
      null,
      2
    );
  }

  const lines = [`Saved deliverable to ${outPath}`];
  if (outputContent.length <= 1200) {
    lines.push('', outputContent.trimEnd());
  }
  return lines.join('\n');
}

export async function runOrderListCommand(opts: ListCommandOptions = {}): Promise<string> {
  const localLogs = readOrderLogs();
  const payerAddresses = new Set<string>();

  for (const entry of localLogs) {
    if (entry.payer && entry.payer.startsWith('0x')) {
      payerAddresses.add(entry.payer.toLowerCase());
    }
  }

  // Also check current signed-in wallet address
  const summary = await getWalletSummary().catch(() => null);
  if (summary?.connected && summary.baseAddress) {
    payerAddresses.add(summary.baseAddress.toLowerCase());
  }

  // Refresh Base orders from backend by payer address
  for (const payer of payerAddresses) {
    const remoteList = await listBaseOrders(payer, 1, 50).catch(() => null);
    if (remoteList?.orders) {
      for (const item of remoteList.orders) {
        const existing = findLocalOrder(item.orderId);
        appendOrUpdateOrderLog({
          orderId: item.orderId,
          chain: 'base',
          serviceId: item.serviceId,
          serviceName: item.serviceName,
          agentId: existing?.agentId || '',
          agentName: item.agentName,
          amount: formatAtomicUsdc(item.price),
          currency: 'USDC',
          wallet: 'Binance Agentic Wallet',
          payer: existing?.payer || payer,
          payTo: existing?.payTo || '',
          txHash: existing?.txHash || '',
          phase: item.phase,
          status: item.status,
          createdAt: item.createdAt,
          updatedAt: new Date().toISOString(),
          slaDeadline: item.slaDeadline,
        });
      }
    }
  }

  // For any local non-terminal Base orders (or Base orders missing txHash), fetch single order status
  const updatedLogs = readOrderLogs();
  for (const entry of updatedLogs) {
    if (
      entry.chain === 'base' &&
      (entry.phase === 'pending' ||
        entry.phase === 'locked' ||
        entry.phase === 'delivered' ||
        (!entry.txHash && entry.phase !== 'failed'))
    ) {
      const detail = await getBaseOrder(entry.orderId).catch(() => null);
      if (detail) {
        const paidTx =
          detail.timeline?.find((t) => t.phase === 'paid')?.txHash ||
          detail.timeline?.[0]?.txHash ||
          entry.txHash ||
          '';
        appendOrUpdateOrderLog({
          ...entry,
          agentId: detail.agentId || entry.agentId,
          phase: detail.phase,
          status: detail.status,
          slaDeadline: detail.slaDeadline,
          txHash: paidTx,
          requirements: detail.requirements ?? entry.requirements,
        });
      }
    }
  }

  const finalLogs = readOrderLogs().sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );

  if (opts.json) {
    const ordersWithIndex = finalLogs.map((e, idx) => ({
      index: idx + 1,
      display_line: `${idx + 1}. ${e.serviceName || e.serviceId}: ${e.orderId}`,
      ...e,
    }));
    return JSON.stringify({ total: ordersWithIndex.length, orders: ordersWithIndex }, null, 2);
  }
  return formatOrderList(finalLogs);
}
