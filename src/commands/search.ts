import { searchSkill } from '../api.js';
import {
  cacheSearchItems,
  extractTrailingIdFromDisplayLine,
  readOrderLogs,
  resolveSearchIndexInput,
} from '../config.js';
import { formatAtomicUsdc, formatSearchOutput } from '../format.js';
import type { Chain, SearchItem, SearchView } from '../types.js';
import { isWalletReady } from '../wallet.js';

export interface SearchCommandOptions {
  query?: string;
  view?: SearchView;
  chain?: Chain;
  agent?: string;
  limit?: number;
  json?: boolean;
}

function enrichSearchItemForJson(
  item: SearchItem,
  walletReady: boolean,
  index?: number
): Record<string, unknown> {
  const numPrefix = index !== undefined ? `${index}. ` : '';
  if (item.type === 'agent') {
    const displayLine = `${numPrefix}${item.name || item.agentId}: ${item.agentId}`;
    if (item.chain === 'base') {
      return {
        ...(index !== undefined ? { index } : {}),
        ...item,
        id: item.agentId,
        agent_id: item.agentId,
        display_line: displayLine,
        volume_usd: item.volumeUsd,
        from_price_usd: item.fromPriceUsd,
        needs_wallet: !walletReady,
      };
    }
    return {
      ...(index !== undefined ? { index } : {}),
      ...item,
      id: item.agentId,
      agent_id: item.agentId,
      display_line: displayLine,
      feedback_count: item.feedbackCount,
      needs_wallet: !walletReady,
    };
  }

  // type === 'service'
  const displayLine = `${numPrefix}${item.name || item.serviceId}: ${item.serviceId}`;
  if (item.chain === 'base') {
    return {
      ...(index !== undefined ? { index } : {}),
      ...item,
      id: item.serviceId,
      service_id: item.serviceId,
      agent_id: item.agentId,
      agent_name: item.agentName,
      display_line: displayLine,
      price_usd: formatAtomicUsdc(item.price),
      sla_minutes: item.slaMinutes,
      needs_wallet: !walletReady,
    };
  }
  return {
    ...(index !== undefined ? { index } : {}),
    ...item,
    id: item.serviceId,
    service_id: item.serviceId,
    agent_id: item.agentId,
    agent_name: item.agentName,
    display_line: displayLine,
    feedback_count: item.feedbackCount,
    needs_wallet: !walletReady,
  };
}

export async function runSearchCommand(opts: SearchCommandOptions): Promise<string> {
  let agentTarget = opts.agent;
  if (agentTarget) {
    const byIdx = resolveSearchIndexInput(agentTarget, 'agent');
    if (byIdx?.agentId) {
      agentTarget = byIdx.agentId;
    } else {
      agentTarget = extractTrailingIdFromDisplayLine(agentTarget);
    }
  }
  const isAgentDrilldown = Boolean(agentTarget);
  const view: SearchView = opts.view || 'service';

  if (!isAgentDrilldown && (!opts.query || !opts.query.trim())) {
    throw new Error(
      'Usage: croo search <query> [--view service|agent] [--chain base|bsc] [--limit N]\n       croo search --agent <agent_id>'
    );
  }

  let resp;
  let walletReady: boolean;
  try {
    [resp, walletReady] = await Promise.all([
      searchSkill({
        q: opts.query,
        view,
        chain: opts.chain,
        agentId: agentTarget,
        limit: opts.limit,
      }),
      isWalletReady(),
    ]);
  } catch (err) {
    if (
      err instanceof Error &&
      opts.query &&
      /q or agentId is required/i.test(err.message)
    ) {
      throw new Error(
        `Search query "${opts.query.trim()}" is too short (minimum 2 characters). Try a more specific keyword.`
      );
    }
    throw err;
  }

  // Downrank BNB endpoints that previously returned 2xx instead of 402 (logged as phase: 'free')
  if (resp.items && resp.items.length > 1) {
    const logs = readOrderLogs();
    const freeServiceIds = new Set(
      logs.filter((l) => l.chain === 'bsc' && l.phase === 'free' && l.serviceId).map((l) => l.serviceId)
    );
    const freeAgentIds = new Set(
      logs.filter((l) => l.chain === 'bsc' && l.phase === 'free' && l.agentId).map((l) => l.agentId)
    );
    if (freeServiceIds.size > 0 || freeAgentIds.size > 0) {
      resp.items = [...resp.items].sort((a, b) => {
        const aDemoted =
          a.type === 'service'
            ? freeServiceIds.has(a.serviceId || '')
            : freeAgentIds.has(a.agentId || '');
        const bDemoted =
          b.type === 'service'
            ? freeServiceIds.has(b.serviceId || '')
            : freeAgentIds.has(b.agentId || '');
        if (aDemoted === bDemoted) return 0;
        return aDemoted ? 1 : -1;
      });
    }
  }

  // Cache returned service/agent items locally for subsequent preview/confirm
  cacheSearchItems(resp.items || [], resp.agent);

  if (opts.json) {
    return JSON.stringify(
      {
        view: resp.view,
        walletReady,
        agent: resp.agent ? enrichSearchItemForJson(resp.agent, walletReady) : null,
        items: (resp.items || []).map((item, idx) =>
          enrichSearchItemForJson(item, walletReady, idx + 1)
        ),
      },
      null,
      2
    );
  }

  return formatSearchOutput(resp, walletReady, isAgentDrilldown);
}
