import type {
  BaseOrderDetail,
  InvalidRequirementsMetadata,
  OrderDraft,
  OrderLogEntry,
  RequirementFieldSchema,
  SearchItem,
  SearchResponse,
} from './types.js';
import type { WalletSummary } from './wallet.js';

export const COPY = {
  NO_WALLET_INIT: `No agentic wallet found. croo pays with your Binance Agentic Wallet; it never holds your keys.

  Install it:
    npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet

Sign in with the Binance App, then run \`croo init\` again.`,
  NO_WALLET_SHORT: 'No agentic wallet found. Run croo init.',
  WALLET_READY: 'Ready to order on Base and BNB Chain.',
  NEEDS_WALLET: 'Needs Binance Agentic Wallet',
  AGENT_DRILLDOWN_HINT: 'Reply with an agent id to see all of its services.',
  NOT_A_SERVICE: (id: string) =>
    `That's an agent, not a service. See its services: croo search --agent ${id}`,
  BNB_PRICE_PLACEHOLDER: 'Price shown at preview',
  BNB_SEARCH_SETTLEMENT: 'Direct payment via B402, no escrow',
  BASE_CARD_SETTLEMENT: 'CAP escrow',
  BNB_CARD_SETTLEMENT: 'B402 direct payment',
  BNB_GAS: 'none for you',
  BNB_RISK_WARNING_1: "⚠ No escrow. Payment is final and can't be",
  BNB_RISK_WARNING_2: '  refunded, even if the result is wrong.',
  PRICE_CHANGED: 'Price changed since preview. Run preview again.',
  QUOTE_EXPIRED: 'Quote expired. Run preview again.',
  UNSUPPORTED_PAYMENT_METHOD:
    "This agent doesn't accept a payment method your wallet supports.",
  LONG_SLA: (sla: string, orderId: string) =>
    `This order can take up to ${sla}. Get the result later with: croo order result ${orderId}`,
};

export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function isFullWidthCodePoint(cp: number): boolean {
  return (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0x3247 && cp !== 0x303f) ||
      (cp >= 0x3250 && cp <= 0x4dbf) ||
      (cp >= 0x4e00 && cp <= 0xa4c6) ||
      (cp >= 0xa960 && cp <= 0xa97c) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6b) ||
      (cp >= 0xff01 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1f64f) ||
      (cp >= 0x1f900 && cp <= 0x1f9ff) ||
      (cp >= 0x20000 && cp <= 0x3fffd))
  );
}

export function getDisplayWidth(str: string): number {
  const clean = stripAnsi(str);
  let width = 0;
  for (const ch of clean) {
    const cp = ch.codePointAt(0) || 0;
    width += isFullWidthCodePoint(cp) ? 2 : 1;
  }
  return width;
}

export function padEndDisplay(str: string, targetWidth: number): string {
  const w = getDisplayWidth(str);
  if (w >= targetWidth) return str;
  return str + ' '.repeat(targetWidth - w);
}

export function truncateDisplayWidth(str: string, maxWidth: number): string {
  if (getDisplayWidth(str) <= maxWidth) return str;
  let width = 0;
  let out = '';
  for (const ch of str) {
    const cp = ch.codePointAt(0) || 0;
    const chW = isFullWidthCodePoint(cp) ? 2 : 1;
    if (width + chW + 1 > maxWidth) {
      break;
    }
    out += ch;
    width += chW;
  }
  return `${out}…`;
}

export function shortenAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr || '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function shortenInlineHexAddresses(text: string): string {
  return text.replace(/\b0x[a-fA-F0-9]{40}\b/g, (match) => shortenAddress(match));
}

export function formatAtomicUsdc(atomic: string | number | undefined): string {
  if (atomic === undefined || atomic === null || atomic === '') return '0.00';
  const str = String(atomic).trim();
  if (/^\d+$/.test(str)) {
    const bi = BigInt(str);
    const whole = bi / 1_000_000n;
    const frac = (bi % 1_000_000n).toString().padStart(6, '0');
    const trimmedFrac = frac.replace(/0+$/, '');
    const finalFrac = trimmedFrac.length <= 2 ? frac.slice(0, 2) : trimmedFrac;
    return `${whole.toString()}.${finalFrac}`;
  }
  const num = Number(atomic);
  if (Number.isNaN(num)) return String(atomic);
  const val = num / 1_000_000;
  if (val > 0 && val < 0.01) {
    return val.toString();
  }
  return val.toFixed(2);
}

export function formatNumberWithCommas(n: number | string): string {
  const num = typeof n === 'string' ? Number(n) : n;
  if (Number.isNaN(num)) return String(n);
  return num.toLocaleString('en-US');
}

export function formatUsdAmount(val: string | number): string {
  const num = typeof val === 'string' ? Number(val) : val;
  if (Number.isNaN(num)) return String(val);
  if (num >= 1000) {
    return num.toLocaleString('en-US', {
      minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  }
  return num.toFixed(2);
}

export function formatSlaShort(slaMinutes: number): string {
  if (!slaMinutes || slaMinutes <= 0) return '< 30 min';
  if (slaMinutes < 60) return `< ${slaMinutes} min`;
  const hours = slaMinutes / 60;
  if (Number.isInteger(hours)) return `< ${hours} h`;
  return `< ${hours.toFixed(1)} h`;
}

export function formatSlaDurationWords(slaMinutes: number): string {
  if (!slaMinutes || slaMinutes <= 0) return '30 min';
  if (slaMinutes < 60) return `${slaMinutes} min`;
  const hours = slaMinutes / 60;
  if (Number.isInteger(hours)) return `${hours} h`;
  return `${hours.toFixed(1)} h`;
}

export function stripUrlProtocol(url: string): string {
  if (!url) return '';
  return url.replace(/^https?:\/\//i, '');
}

export function formatInitOutput(summary: WalletSummary): string {
  if (!summary.installed || !summary.connected) {
    if (summary.status === 'EXPIRED') {
      return `Binance Agentic Wallet session expired. Please re-authorize in the Binance App (run \`baw auth signin\` and \`baw auth verify\`), then run \`croo init\` again.`;
    }
    if (summary.installed) {
      return `${COPY.NO_WALLET_INIT}\n\n  Already installed? Sign in directly:\n    baw auth signin`;
    }
    return COPY.NO_WALLET_INIT;
  }

  const shortAddr = shortenAddress(summary.address);
  return [
    'Wallet',
    `  Binance Agentic Wallet   ✓ signed in    ${shortAddr}`,
    '',
    'Balances',
    `  Base       ${summary.baseUsdcBalance} USDC`,
    `  BNB Chain  ${summary.bscUsdtBalance} USDT`,
    '',
    COPY.WALLET_READY,
  ].join('\n');
}

export function formatSearchOutput(
  resp: SearchResponse,
  walletReady: boolean,
  isAgentDrilldown: boolean = false
): string {
  // Agent drilldown mode: `croo search --agent <agent_id>`
  if (isAgentDrilldown) {
    if (!resp.items || resp.items.length === 0) {
      return 'This agent is offline or currently has no orderable services. Try running `croo search <query>` again.';
    }
    const first = resp.items[0];
    const chain = resp.agent?.chain || first.chain;
    const agentName = resp.agent?.name || first.agentName || first.agentId;
    const badge = chain === 'base' ? '[Base · USDC]' : '[BNB Chain · x402]';
    const headerLeft = `${agentName} · ${resp.items.length} service${resp.items.length === 1 ? '' : 's'}`;
    const padLen = Math.max(2, 60 - getDisplayWidth(headerLeft));
    const lines: string[] = [`${headerLeft}${' '.repeat(padLen)}${badge}`, ''];

    const maxIdxLen = `[${resp.items.length}]`.length;
    const truncatedNames = resp.items.map((item) =>
      truncateDisplayWidth(item.name || '', 48)
    );
    const maxNameLen = Math.max(
      16,
      ...truncatedNames.map((n) => getDisplayWidth(n))
    );

    if (chain === 'base') {
      const rows = resp.items.map((item, idx) => ({
        idxStr: `[${idx + 1}]`.padEnd(maxIdxLen, ' '),
        nameStr: padEndDisplay(truncatedNames[idx], maxNameLen + 2),
        priceStr: `Price ${formatAtomicUsdc(item.price)} ${item.currency || 'USDC'} / call`,
        slaStr: `SLA ${formatSlaShort(item.slaMinutes)}`,
        ordersStr: `Orders ${formatNumberWithCommas(item.orders)}`,
        serviceId: item.serviceId,
      }));

      const maxPriceLen = Math.max(...rows.map((r) => r.priceStr.length));
      const maxSlaLen = Math.max(...rows.map((r) => r.slaStr.length));
      const maxOrdersLen = Math.max(...rows.map((r) => r.ordersStr.length));

      for (const r of rows) {
        lines.push(
          `${r.idxStr} ${r.nameStr}${r.priceStr.padEnd(maxPriceLen, ' ')} · ${r.slaStr.padEnd(maxSlaLen, ' ')} · ${r.ordersStr.padEnd(maxOrdersLen, ' ')}   id: ${r.serviceId}`
        );
      }
    } else {
      resp.items.forEach((item, idx) => {
        const idxStr = `[${idx + 1}]`.padEnd(maxIdxLen, ' ');
        const paddedName = padEndDisplay(truncatedNames[idx], maxNameLen + 2);
        lines.push(
          `${idxStr} ${paddedName}${COPY.BNB_PRICE_PLACEHOLDER} · ${COPY.BNB_SEARCH_SETTLEMENT}   id: ${item.serviceId}`
        );
      });
    }

    return lines.join('\n');
  }

  // Standard search (service or agent view)
  if (!resp.items || resp.items.length === 0) {
    const altView = resp.view === 'agent' ? 'service' : 'agent';
    return `No results found. Try different keywords or switch view with \`--view ${altView}\`.`;
  }

  if (resp.view === 'agent') {
    return formatAgentSearchItems(resp.items, walletReady);
  }
  return formatServiceSearchItems(resp.items, walletReady);
}

function formatServiceSearchItems(items: SearchItem[], walletReady: boolean): string {
  const blocks: string[] = [];

  const targetBadgeCol = Math.min(
    96,
    Math.max(
      60,
      ...items.map((item, idx) =>
        getDisplayWidth(`[${idx + 1}] ${item.agentName || item.agentId} · ${item.name}`) + 2
      )
    )
  );
  const targetIdWidth = Math.max(
    33,
    ...items.map((item) => `id: ${item.serviceId}`.length + 3)
  );

  items.forEach((item, idx) => {
    const num = `[${idx + 1}]`;
    const title = `${item.agentName || item.agentId} · ${item.name}`;
    const badge = item.chain === 'base' ? '[Base · USDC]' : '[BNB Chain · x402]';
    const padLen = Math.max(2, targetBadgeCol - getDisplayWidth(`${num} ${title}`));
    const line1 = `${num} ${title}${' '.repeat(padLen)}${badge}`;

    const shortUrl = stripUrlProtocol(item.url);
    const idPart = `id: ${item.serviceId}`;
    const idPad = Math.max(2, targetIdWidth - idPart.length);
    const idLine = `    ${idPart}${' '.repeat(idPad)}${shortUrl}`;

    if (item.chain === 'base') {
      const priceStr = `${formatAtomicUsdc(item.price)} ${item.currency || 'USDC'} / call`;
      const slaStr = formatSlaShort(item.slaMinutes);
      const ordersStr = formatNumberWithCommas(item.orders);
      const walletSuffix = !walletReady ? ` · ${COPY.NEEDS_WALLET}` : '';
      const line2 = `    Price ${priceStr} · SLA ${slaStr} · Orders ${ordersStr}${walletSuffix}`;
      blocks.push([line1, line2, idLine].join('\n'));
    } else {
      const line2 = `    ${COPY.BNB_PRICE_PLACEHOLDER} · ${COPY.BNB_SEARCH_SETTLEMENT}`;
      const walletSuffix = !walletReady ? ` · ${COPY.NEEDS_WALLET}` : '';
      const line3 = `    Score ${item.score} · ${item.feedbackCount} feedback${walletSuffix}`;
      blocks.push([line1, line2, line3, idLine].join('\n'));
    }
  });

  return blocks.join('\n\n');
}

function formatAgentSearchItems(items: SearchItem[], walletReady: boolean): string {
  const blocks: string[] = [];

  const targetBadgeCol = Math.min(
    96,
    Math.max(
      60,
      ...items.map((item, idx) =>
        getDisplayWidth(`[${idx + 1}] ${item.name || item.agentId}`) + 2
      )
    )
  );
  const targetIdWidth = Math.max(
    33,
    ...items.map((item) => `agent id: ${item.agentId}`.length + 3)
  );

  items.forEach((item, idx) => {
    const num = `[${idx + 1}]`;
    const title = item.name || item.agentId;
    const badge = item.chain === 'base' ? '[Base · USDC]' : '[BNB Chain · x402]';
    const padLen = Math.max(2, targetBadgeCol - getDisplayWidth(`${num} ${title}`));
    const line1 = `${num} ${title}${' '.repeat(padLen)}${badge}`;

    const shortUrl = stripUrlProtocol(item.url);
    const idPart = `agent id: ${item.agentId}`;
    const idPad = Math.max(2, targetIdWidth - idPart.length);
    const idLine = `    ${idPart}${' '.repeat(idPad)}${shortUrl}`;

    if (item.chain === 'base') {
      const ordersStr = formatNumberWithCommas(item.orders);
      const compPct = `${(Number(item.completion || 0) * 100).toFixed(1).replace(/\.0$/, '')}%`;
      const volStr = `${formatUsdAmount(item.volumeUsd || '0')} USD`;
      const fromStr = `${Number(item.fromPriceUsd || 0).toFixed(2)} USD`;
      const walletSuffix = !walletReady ? ` · ${COPY.NEEDS_WALLET}` : '';
      const line2 = `    Orders ${ordersStr} · Completion ${compPct} · Volume ${volStr} · From ${fromStr}${walletSuffix}`;
      blocks.push([line1, line2, idLine].join('\n'));
    } else {
      const walletSuffix = !walletReady ? ` · ${COPY.NEEDS_WALLET}` : '';
      const line2 = `    Score ${item.score} · ${item.feedbackCount} feedback${walletSuffix}`;
      blocks.push([line1, line2, idLine].join('\n'));
    }
  });

  blocks.push(COPY.AGENT_DRILLDOWN_HINT);
  return blocks.join('\n\n');
}

export function formatSchemaFieldType(field: RequirementFieldSchema): string {
  if (field.type === 'array') {
    return `${field.itemType || 'string'}[]`;
  }
  return field.type || 'string';
}

function flattenSchemaFields(
  fields: RequirementFieldSchema[],
  prefix: string = ''
): RequirementFieldSchema[] {
  const result: RequirementFieldSchema[] = [];
  for (const f of fields) {
    const fullName = prefix ? `${prefix}.${f.name}` : f.name;
    result.push({ ...f, name: fullName });
    if (f.fields && f.fields.length > 0) {
      result.push(...flattenSchemaFields(f.fields, fullName));
    }
  }
  return result;
}

export function formatMissingRequirementsOutput(
  serviceId: string,
  meta: InvalidRequirementsMetadata,
  wasRequirementsProvided: boolean = false
): string {
  const title = meta.serviceName || serviceId;
  const lines: string[] = [];

  const nonEmptyErrors = (meta.errors || []).filter(
    (e) => e.field && e.reason !== 'body_required'
  );

  if (meta.requirementType === 'text') {
    lines.push(`Missing required input for "${title}":`);
    lines.push(
      `  (text)      string     required   ${meta.requirementText || 'Provide plain text or JSON string input'}`
    );
    lines.push('');
    lines.push('Fill it and run:');
    lines.push(`  croo order preview ${serviceId} --requirements '"<your instructions>"'`);
    return lines.join('\n');
  }

  const flatSchema = flattenSchemaFields(meta.requirementSchema || []);
  const hasRequired = flatSchema.some((f) => f.required);

  if (hasRequired || nonEmptyErrors.length > 0) {
    lines.push(`Missing required fields for "${title}":`);
  } else {
    lines.push(`Fields for "${title}" (all optional — pass '{}' to use defaults):`);
  }

  if (flatSchema.length === 0) {
    lines.push("  (none)      object     optional   Pass '{}' as --requirements");
  } else {
    const maxName = Math.max(...flatSchema.map((f) => f.name.length), 9);
    const maxType = Math.max(...flatSchema.map((f) => formatSchemaFieldType(f).length), 8);

    for (const f of flatSchema) {
      const nameCol = f.name.padEnd(maxName + 3, ' ');
      const typeCol = formatSchemaFieldType(f).padEnd(maxType + 3, ' ');
      const reqCol = (f.required ? 'required' : 'optional').padEnd(11, ' ');
      const desc = f.description || '';
      lines.push(`  ${nameCol}${typeCol}${reqCol}${desc}`.trimEnd());
    }
  }

  if (wasRequirementsProvided && nonEmptyErrors.length > 0) {
    lines.push('');
    lines.push('Validation errors:');
    for (const err of nonEmptyErrors) {
      lines.push(`  - ${err.field}: ${err.reason}`);
    }
  }

  lines.push('');
  lines.push('Fill them and run:');
  if (!hasRequired) {
    lines.push(`  croo order preview ${serviceId} --requirements '{}'`);
  } else {
    lines.push(`  croo order preview ${serviceId} --requirements @req.json`);
  }
  return lines.join('\n');
}

export function truncateRequirementValue(val: unknown, sourcePathHint?: string): string {
  if (typeof val === 'string') {
    const normalized = val.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const lineCount = lines.length;

    if (normalized.length <= 80 && getDisplayWidth(normalized) <= 80 && lineCount === 1) {
      return normalized;
    }

    if (lineCount > 1) {
      const looksLikeContract = /\b(pragma\s+solidity|contract\s+\w+|interface\s+\w+|library\s+\w+)\b/.test(
        normalized
      );
      if (looksLikeContract) {
        if (sourcePathHint) {
          return `<contract source, ${lineCount} lines from ${sourcePathHint}>`;
        }
        return `<contract source, ${lineCount} lines, ${normalized.length} chars>`;
      }
      if (sourcePathHint) {
        return `<${lineCount} lines from ${sourcePathHint}>`;
      }
      const firstLine = truncateDisplayWidth(
        (lines.find((l) => l.trim().length > 0) || lines[0]).trim(),
        32
      );
      return `<${firstLine}, ${lineCount} lines, ${normalized.length} chars>`;
    }

    return `${truncateDisplayWidth(normalized, 57)} (${normalized.length} chars)`;
  }

  let json: string;
  if (Array.isArray(val)) {
    json = `[${val.map((item) => JSON.stringify(item)).join(', ')}]`;
  } else if (val && typeof val === 'object') {
    json = `{${Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
      .join(', ')}}`;
  } else {
    json = JSON.stringify(val);
  }
  if (json.length <= 80 && getDisplayWidth(json) <= 80) {
    return json;
  }
  return `${truncateDisplayWidth(json, 57)} (${json.length} chars)`;
}

export function formatBnbRequestPreviewLine(rawBody: string): string {
  const shortened = shortenInlineHexAddresses(rawBody || '{}');
  try {
    const parsed = JSON.parse(shortened);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const pairs = Object.entries(parsed as Record<string, unknown>).map(
        ([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`
      );
      const prettyInline = `{${pairs.join(', ')}}`;
      return truncateRequirementValue(prettyInline);
    }
  } catch {
    // not JSON object
  }
  return truncateRequirementValue(shortened);
}

function renderCardBox(contentLines: string[]): string {
  // Flatten any accidental embedded newlines and replace tabs
  const safeLines: string[] = [];
  for (const rawLine of contentLines) {
    const parts = rawLine.replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n');
    safeLines.push(...parts);
  }

  // Compute inner width (minimum 50 chars inside box)
  const maxContentLen = Math.max(
    46,
    ...safeLines.map((l) => getDisplayWidth(l))
  );
  const innerWidth = maxContentLen + 4; // 2 spaces padding on each side

  const top = `┌${'─'.repeat(innerWidth)}┐`;
  const bottom = `└${'─'.repeat(innerWidth)}┘`;
  const body = safeLines.map((line) => {
    const visibleLen = getDisplayWidth(line);
    const rightPad = Math.max(2, innerWidth - 2 - visibleLen);
    return `│  ${line}${' '.repeat(rightPad)}│`;
  });

  return [top, ...body, bottom].join('\n');
}

export interface QuoteCardRenderOptions {
  draft: OrderDraft;
  walletBalanceHuman: string;
  walletErrorReason?: string; // If present, wallet line is highlighted red and draft is NOT confirmable
}

export function formatQuoteCard(opts: QuoteCardRenderOptions): string {
  const { draft, walletBalanceHuman, walletErrorReason } = opts;
  const lines: string[] = [];

  const title = `${draft.agentName || draft.agentId} · ${draft.serviceName || draft.serviceId}`;
  lines.push(title);

  if (draft.chain === 'base') {
    lines.push(`Base · ${draft.currency} · ${COPY.BASE_CARD_SETTLEMENT}`);
    lines.push('');
    lines.push(`Price     ${draft.priceHuman} ${draft.currency}`);
    lines.push(`Gas       ${draft.gasHuman} ${draft.currency}`);
    lines.push(`Total     ${draft.totalHuman} ${draft.currency}`);
    lines.push(
      `SLA       ${formatSlaShort(draft.slaMinutes || 30)}, price refunded if missed`
    );

    const walletText = `Binance Agentic Wallet · ${walletBalanceHuman} ${draft.currency}`;
    if (walletErrorReason) {
      const shortTag = walletErrorReason.split('—')[0].trim();
      lines.push(`Wallet    \x1b[31m${walletText} (${shortTag})\x1b[0m`);
    } else {
      lines.push(`Wallet    ${walletText}`);
    }

    lines.push('');
    lines.push('Requirements');
    const req = draft.requirementsParsed;
    if (req && typeof req === 'object' && !Array.isArray(req)) {
      const entries = Object.entries(req as Record<string, unknown>);
      if (entries.length === 0) {
        lines.push('  (default parameters)');
      } else {
        const reqObj = req as Record<string, unknown>;
        const pathCandidate =
          reqObj.file ||
          reqObj.path ||
          reqObj.filePath ||
          reqObj.filename ||
          reqObj.contractPath ||
          draft.requirementsFile;
        const sourcePathHint =
          typeof pathCandidate === 'string' && pathCandidate.length > 0 && pathCandidate.length <= 60
            ? pathCandidate
            : undefined;
        const maxKey = Math.max(...entries.map(([k]) => getDisplayWidth(k)), 7);
        for (const [k, v] of entries) {
          lines.push(
            `  ${padEndDisplay(k, maxKey + 3)}${truncateRequirementValue(v, sourcePathHint)}`
          );
        }
      }
    } else if (typeof req === 'string' && req.length > 0) {
      lines.push(`  ${truncateRequirementValue(req, draft.requirementsFile)}`);
    } else if (!draft.requirementsRaw || draft.requirementsRaw === '{}') {
      lines.push('  (default parameters)');
    } else {
      lines.push(`  ${truncateRequirementValue(draft.requirementsRaw, draft.requirementsFile)}`);
    }
  } else {
    // BNB Chain
    lines.push(`BNB Chain · ${draft.currency} · ${COPY.BNB_CARD_SETTLEMENT}`);
    lines.push('');
    lines.push(`Price     ${draft.priceHuman} ${draft.currency}`);
    lines.push(`Gas       ${COPY.BNB_GAS}`);
    lines.push(`Pay to    ${shortenAddress(draft.selectedOption.payTo || '')}`);

    const walletText = `Binance Agentic Wallet · ${walletBalanceHuman} ${draft.currency}`;
    if (walletErrorReason) {
      const shortTag = walletErrorReason.split('—')[0].trim();
      lines.push(`Wallet    \x1b[31m${walletText} (${shortTag})\x1b[0m`);
    } else {
      lines.push(`Wallet    ${walletText}`);
    }

    if (draft.score !== undefined || draft.feedbackCount !== undefined) {
      lines.push(`Score     ${draft.score ?? 0} · ${draft.feedbackCount ?? 0} feedback`);
    }

    lines.push('');
    lines.push(`Request   ${draft.method} ${draft.endpoint}`);
    lines.push(`  ${formatBnbRequestPreviewLine(draft.requirementsRaw || '{}')}`);
    lines.push('');
    lines.push(COPY.BNB_RISK_WARNING_1);
    lines.push(COPY.BNB_RISK_WARNING_2);
  }

  const box = renderCardBox(lines);
  if (walletErrorReason) {
    return `${box}\n\nCannot confirm order: ${walletErrorReason}`;
  }
  return `${box}\n\nReply \`croo order confirm ${draft.draftId}\` to authorize the ${draft.totalHuman} ${draft.currency} payment.`;
}

export function formatSlaRemaining(slaDeadline?: string): string {
  if (!slaDeadline) return '';
  const deadlineMs = Date.parse(slaDeadline);
  if (Number.isNaN(deadlineMs)) return '';
  const diffMs = deadlineMs - Date.now();
  if (diffMs <= 0) return '0 min (deadline passed)';
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) return `${mins} min remaining`;
  const hrs = (mins / 60).toFixed(1);
  return `${hrs} h remaining`;
}

export function formatBaseOrderStatus(order: BaseOrderDetail): string {
  const lines: string[] = [
    `Order ${order.orderId}`,
    `  Service   ${order.agentName} · ${order.serviceName}`,
    `  Chain     Base · USDC · CAP escrow`,
    `  Price     ${formatAtomicUsdc(order.price)} USDC`,
    `  Phase     ${order.phase} (status: ${order.status})`,
  ];

  if (order.phase === 'locked' || order.phase === 'pending') {
    const rem = formatSlaRemaining(order.slaDeadline);
    if (rem) {
      lines.push(`  SLA       ${rem} (deadline: ${order.slaDeadline})`);
    }
  }

  if (order.timeline && order.timeline.length > 0) {
    lines.push('');
    lines.push('Timeline');
    for (const step of order.timeline) {
      const p = step.phase.padEnd(10, ' ');
      const tx = step.txHash ? `  tx: ${step.txHash}` : '';
      lines.push(`  ✓ ${p} ${step.occurredAt}${tx}`);
    }
  }

  if (order.refund) {
    lines.push('');
    lines.push('Refund');
    const payerShort = order.payer ? ` to ${shortenAddress(order.payer)}` : '';
    lines.push(
      `  Status    ${order.refund.status} (${formatAtomicUsdc(order.refund.amount)} USDC${payerShort})` +
        (order.refund.txHash ? `  tx: ${order.refund.txHash}` : '')
    );
  } else if (order.phase === 'failed') {
    lines.push('');
    lines.push('Refund');
    lines.push(`  Status    No funds were deducted (${order.status})`);
  }

  if (order.delivery) {
    lines.push('');
    lines.push(
      `Deliverable ready! Run: croo order result ${order.orderId}`
    );
  }

  return lines.join('\n');
}

export function formatBnbOrderStatus(entry: OrderLogEntry): string {
  const lines: string[] = [
    `Order ${entry.orderId}`,
    `  Service   ${entry.agentName} · ${entry.serviceName}`,
    `  Chain     BNB Chain · ${entry.currency} · B402 direct payment`,
    `  Amount    ${entry.amount} ${entry.currency}`,
    `  Status    ${entry.status}`,
    `  Time      ${entry.createdAt}`,
  ];
  if (entry.txHash) {
    lines.push(`  Tx Hash   ${entry.txHash}`);
  }
  if (entry.error) {
    lines.push(`  Error     ${entry.error}`);
  }
  return lines.join('\n');
}

export function formatOrderList(entries: OrderLogEntry[]): string {
  if (entries.length === 0) {
    return 'No orders found.';
  }
  const maxIdxLen = `[${entries.length}]`.length;
  const rows = entries.map((e, idx) => {
    const idxStr = `[${idx + 1}]`.padEnd(maxIdxLen, ' ');
    const chainBadge = e.chain === 'base' ? '[Base]' : '[BNB] ';
    const amountStr = `${e.amount} ${e.currency}`;
    const rawTitle = `${e.agentName ? e.agentName + ' · ' : ''}${e.serviceName || e.serviceId}`;
    const title = truncateDisplayWidth(rawTitle, 80);
    const txInfo = e.txHash ? ` · tx ${shortenAddress(e.txHash)}` : '';
    return {
      idxStr,
      chainBadge,
      orderId: e.orderId,
      phase: e.phase || '',
      amountStr,
      title,
      createdAt: e.createdAt,
      txInfo,
    };
  });

  const maxIdLen = Math.max(...rows.map((r) => r.orderId.length), 12);
  const maxPhaseLen = Math.max(...rows.map((r) => r.phase.length), 9);
  const maxAmountLen = Math.max(...rows.map((r) => r.amountStr.length), 10);
  const maxTitleWidth = Math.max(...rows.map((r) => getDisplayWidth(r.title)), 16);

  const lines: string[] = [];
  for (const r of rows) {
    lines.push(
      `${r.idxStr} ${r.chainBadge} ${r.orderId.padEnd(maxIdLen, ' ')}  ${r.phase.padEnd(maxPhaseLen, ' ')}  ${r.amountStr.padEnd(maxAmountLen, ' ')}  ${padEndDisplay(r.title, maxTitleWidth)}  (${r.createdAt})${r.txInfo}`
    );
  }
  return lines.join('\n');
}
