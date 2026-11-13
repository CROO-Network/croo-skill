import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CrooConfig, OrderDraft, OrderLogEntry, SearchItem } from './types.js';

export const DEFAULT_API_BASE_URL = 'https://api.croo.network';

export function getCrooHome(): string {
  return process.env.CROO_HOME || path.join(os.homedir(), '.croo');
}

export function ensureCrooDirs(): {
  home: string;
  draftsDir: string;
  configPath: string;
  ordersPath: string;
  cachePath: string;
} {
  const home = getCrooHome();
  const draftsDir = path.join(home, 'drafts');
  const configPath = path.join(home, 'config.json');
  const ordersPath = path.join(home, 'orders.jsonl');
  const cachePath = path.join(home, 'service-cache.json');

  if (!fs.existsSync(home)) {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(draftsDir)) {
    fs.mkdirSync(draftsDir, { recursive: true, mode: 0o700 });
  }
  return { home, draftsDir, configPath, ordersPath, cachePath };
}

function writeSecureFile(filePath: string, content: string): void {
  ensureCrooDirs();
  fs.writeFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod errors on platforms where not supported
  }
}

export function loadConfig(): CrooConfig {
  const { configPath } = ensureCrooDirs();
  let fileConfig: CrooConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      fileConfig = JSON.parse(raw) as CrooConfig;
    } catch {
      fileConfig = {};
    }
  }
  return {
    apiBaseUrl:
      (process.env.CROO_API_URL || fileConfig.apiBaseUrl || DEFAULT_API_BASE_URL).replace(
        /\/+$/,
        ''
      ),
    bawBin: process.env.CROO_BAW_BIN || fileConfig.bawBin || 'baw',
  };
}

export function saveConfig(config: CrooConfig): void {
  const { configPath } = ensureCrooDirs();
  writeSecureFile(configPath, JSON.stringify(config, null, 2) + '\n');
}

export function pruneStaleDrafts(maxAgeAfterExpirySeconds: number = 3600): void {
  const { draftsDir } = ensureCrooDirs();
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const files = fs.readdirSync(draftsDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const fullPath = path.join(draftsDir, file);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<OrderDraft>;
        if (
          typeof parsed.expiresAt === 'number' &&
          nowSec - parsed.expiresAt > maxAgeAfterExpirySeconds
        ) {
          fs.unlinkSync(fullPath);
        }
      } catch {
        // Ignore unreadable draft files
      }
    }
  } catch {
    // Ignore directory read errors
  }
}

export function saveDraft(draft: OrderDraft): string {
  pruneStaleDrafts();
  const { draftsDir } = ensureCrooDirs();
  const safeId = path.basename(draft.draftId);
  const draftPath = path.join(draftsDir, `${safeId}.json`);
  writeSecureFile(draftPath, JSON.stringify(draft, null, 2) + '\n');
  return draftPath;
}

export function loadDraft(draftId: string): OrderDraft | null {
  const { draftsDir } = ensureCrooDirs();
  const safeId = path.basename(draftId);
  const draftPath = path.join(draftsDir, `${safeId}.json`);
  if (!fs.existsSync(draftPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(draftPath, 'utf8')) as OrderDraft;
  } catch {
    return null;
  }
}

export interface DraftLease {
  draft: OrderDraft;
  consume: () => void;
  restore: () => void;
}

export function takeDraft(draftId: string): DraftLease | null {
  const { draftsDir } = ensureCrooDirs();
  const safeId = path.basename(draftId);
  const draftPath = path.join(draftsDir, `${safeId}.json`);
  const processingPath = path.join(draftsDir, `${safeId}.processing`);
  try {
    fs.renameSync(draftPath, processingPath);
  } catch {
    return null;
  }

  let draft: OrderDraft;
  try {
    draft = JSON.parse(fs.readFileSync(processingPath, 'utf8')) as OrderDraft;
  } catch {
    try {
      fs.unlinkSync(processingPath);
    } catch {
      // Ignore
    }
    return null;
  }

  return {
    draft,
    consume() {
      try {
        fs.unlinkSync(processingPath);
      } catch {
        // Ignore
      }
    },
    restore() {
      try {
        fs.renameSync(processingPath, draftPath);
      } catch {
        // Ignore
      }
    },
  };
}

export function deleteDraft(draftId: string): void {
  const { draftsDir } = ensureCrooDirs();
  const safeId = path.basename(draftId);
  for (const ext of ['.json', '.processing']) {
    const p = path.join(draftsDir, `${safeId}${ext}`);
    if (fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        // Ignore
      }
    }
  }
}

export function readOrderLogs(): OrderLogEntry[] {
  const { ordersPath } = ensureCrooDirs();
  if (!fs.existsSync(ordersPath)) {
    return [];
  }
  const content = fs.readFileSync(ordersPath, 'utf8');
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const map = new Map<string, OrderLogEntry>();
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as OrderLogEntry;
      if (entry && entry.orderId) {
        map.set(entry.orderId, entry);
      }
    } catch {
      // Skip malformed line
    }
  }
  return Array.from(map.values());
}

export function appendOrUpdateOrderLog(entry: OrderLogEntry): void {
  const { ordersPath } = ensureCrooDirs();
  const existing = readOrderLogs();
  const idx = existing.findIndex((e) => e.orderId === entry.orderId);
  if (idx >= 0) {
    existing[idx] = { ...existing[idx], ...entry, updatedAt: new Date().toISOString() };
  } else {
    existing.push(entry);
  }
  const serialized = existing.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeSecureFile(ordersPath, serialized);
}

export function findLocalOrder(orderId: string): OrderLogEntry | null {
  const logs = readOrderLogs();
  return logs.find((e) => e.orderId === orderId) || null;
}

// Service & Agent metadata cache (for BNB endpoint lookup, Agent ID detection, and 1-based index selection)
interface LocalCacheData {
  services: Record<string, SearchItem>;
  agents: Record<string, SearchItem>;
  lastList?: SearchItem[];
}

function loadSearchCache(): LocalCacheData {
  const { cachePath } = ensureCrooDirs();
  if (!fs.existsSync(cachePath)) {
    return { services: {}, agents: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as Partial<LocalCacheData>;
    return {
      services:
        parsed && typeof parsed.services === 'object' && parsed.services ? parsed.services : {},
      agents: parsed && typeof parsed.agents === 'object' && parsed.agents ? parsed.agents : {},
      ...(Array.isArray(parsed?.lastList) ? { lastList: parsed.lastList } : {}),
    };
  } catch {
    return { services: {}, agents: {} };
  }
}

export function cacheSearchItems(
  items: SearchItem[],
  agent?: SearchItem | null,
  updateLastList: boolean = true
): void {
  const { cachePath } = ensureCrooDirs();
  const cache = loadSearchCache();
  if (updateLastList && items.length > 0) {
    cache.lastList = items;
  }
  for (const item of items) {
    if (item.type === 'service' && item.serviceId) {
      cache.services[item.serviceId] = item;
      if (item.agentId && !cache.agents[item.agentId]) {
        cache.agents[item.agentId] = {
          ...item,
          type: 'agent',
          serviceId: '',
          name: item.agentName || item.agentId,
        };
      }
    } else if (item.type === 'agent' && item.agentId) {
      cache.agents[item.agentId] = item;
    }
  }
  if (agent && agent.agentId) {
    cache.agents[agent.agentId] = agent;
  }
  writeSecureFile(cachePath, JSON.stringify(cache, null, 2) + '\n');
}

function parseListIndexToken(raw: string): number | null {
  const match = raw.trim().match(/^(?:\[|#)?(\d+)(?:\]|\.)?$/);
  if (!match) return null;
  const idx = Number(match[1]);
  return Number.isInteger(idx) ? idx : null;
}

export function extractTrailingIdFromDisplayLine(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(?:\d+\.\s+)?.+?:\s+`?([^\s`]+)`?$/);
  if (!match) return trimmed;
  const candidate = match[1];
  if (
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|bsc:\S+|svc_\S+|agent[-_]\S+|bnb_\S+)$/i.test(
      candidate
    )
  ) {
    return candidate;
  }
  const cache = loadSearchCache();
  if (cache.services[candidate] || cache.agents[candidate]) {
    return candidate;
  }
  return trimmed;
}

export function resolveSearchIndexInput(
  raw: string,
  target: 'service' | 'agent' | 'any' = 'any'
): SearchItem | null {
  const extracted = extractTrailingIdFromDisplayLine(raw);
  if (!extracted) return null;

  const cache = loadSearchCache();
  const idx = parseListIndexToken(extracted);
  if (idx !== null) {
    if (!Array.isArray(cache.lastList) || cache.lastList.length === 0) {
      throw new Error(
        `No recent search results found for selection #${idx}. Run \`croo search\` first.`
      );
    }
    if (idx < 1 || idx > cache.lastList.length) {
      throw new Error(
        `Selection #${idx} is out of range (last search returned ${cache.lastList.length} item${
          cache.lastList.length === 1 ? '' : 's'
        }). Run \`croo search\` to see available items.`
      );
    }
    return cache.lastList[idx - 1] || null;
  }

  // Exact ID match in cache
  if (target === 'agent' && cache.agents[extracted]) {
    return cache.agents[extracted];
  }
  if (cache.services[extracted]) {
    return cache.services[extracted];
  }
  if (cache.agents[extracted]) {
    return cache.agents[extracted];
  }

  // Fallback: match by service or agent name (case-insensitive, stripping optional leading "1. ")
  const cleanName = extracted.replace(/^(?:\[\d+\]|#\d+|\d+\.)\s+/, '').trim().toLowerCase();
  if (!cleanName) return null;

  if (target === 'service' || target === 'any') {
    if (Array.isArray(cache.lastList)) {
      const byLastSvc = cache.lastList.find(
        (item) =>
          item.type === 'service' &&
          ((item.name && item.name.toLowerCase() === cleanName) ||
            (item.agentName &&
              item.name &&
              `${item.agentName} · ${item.name}`.toLowerCase() === cleanName))
      );
      if (byLastSvc) return byLastSvc;
    }
    for (const svc of Object.values(cache.services)) {
      if (
        (svc.name && svc.name.toLowerCase() === cleanName) ||
        (svc.agentName && svc.name && `${svc.agentName} · ${svc.name}`.toLowerCase() === cleanName)
      ) {
        return svc;
      }
    }
  }

  // Match agent name (either for `--agent <name>` or so `order preview <agent_name>` triggers NOT_A_SERVICE)
  if (Array.isArray(cache.lastList)) {
    const byLastAgent = cache.lastList.find(
      (item) => item.type === 'agent' && item.name && item.name.toLowerCase() === cleanName
    );
    if (byLastAgent) return byLastAgent;

    const byLastSvcAgent = cache.lastList.find(
      (item) =>
        item.type === 'service' &&
        item.agentId &&
        item.agentName &&
        item.agentName.toLowerCase() === cleanName
    );
    if (byLastSvcAgent && byLastSvcAgent.agentId) {
      return (
        cache.agents[byLastSvcAgent.agentId] || {
          ...byLastSvcAgent,
          type: 'agent',
          serviceId: '',
          name: byLastSvcAgent.agentName || byLastSvcAgent.agentId,
        }
      );
    }
  }
  for (const ag of Object.values(cache.agents)) {
    if (ag.name && ag.name.toLowerCase() === cleanName) {
      return ag;
    }
  }
  return null;
}

export function resolveOrderIndexInput(raw: string): OrderLogEntry | null {
  const extracted = extractTrailingIdFromDisplayLine(raw);
  const idx = parseListIndexToken(extracted);
  if (idx === null) return null;
  const sorted = readOrderLogs().sort((a, b) =>
    (b.createdAt || '').localeCompare(a.createdAt || '')
  );
  if (sorted.length === 0) {
    throw new Error(
      `No orders found in local history for selection #${idx}. Run \`croo order list\` first.`
    );
  }
  if (idx < 1 || idx > sorted.length) {
    throw new Error(
      `Order selection #${idx} is out of range (${sorted.length} order${
        sorted.length === 1 ? '' : 's'
      } in history). Run \`croo order list\` to see available orders.`
    );
  }
  return sorted[idx - 1] || null;
}

export function getCachedService(serviceId: string): SearchItem | null {
  const cache = loadSearchCache();
  return cache.services[serviceId] || null;
}

export function getCachedAgent(agentId: string): SearchItem | null {
  const cache = loadSearchCache();
  return cache.agents[agentId] || null;
}
