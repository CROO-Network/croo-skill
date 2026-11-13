export type Chain = 'base' | 'bsc';
export type SearchView = 'service' | 'agent';

export interface SearchItem {
  type: 'service' | 'agent';
  chain: Chain;
  serviceId: string;
  name: string;
  description: string;
  agentId: string;
  agentName: string;
  settlement: 'cap_escrow' | 'b402_direct' | '';
  currency: string;
  price: string; // Base: smallest unit (6 decimals for USDC, e.g. "3000000"); BNB: ""
  slaMinutes: number;
  orders: number;
  url: string;
  endpoint: string; // BNB direct HTTP endpoint
  score: number;
  feedbackCount: number;
  completion: number; // 0~1
  volumeUsd: string;
  fromPriceUsd: string;
}

export interface SearchResponse {
  view: SearchView;
  items: SearchItem[];
  agent: SearchItem | null;
}

export interface RequirementFieldSchema {
  name: string;
  type: string; // "string" | "number" | "boolean" | "array" | "object"
  required: boolean;
  description?: string;
  itemType?: string;
  stringSubtype?: string;
  fields?: RequirementFieldSchema[];
}

export interface RequirementErrorItem {
  field: string;
  reason: string;
}

export interface InvalidRequirementsMetadata {
  serviceName: string;
  requirementType: 'schema' | 'text';
  requirementText: string;
  requirementSchema: RequirementFieldSchema[];
  errors: RequirementErrorItem[];
}

export interface ApiErrorBody {
  code: number;
  reason: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface X402Accept {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface BaseQuoteInfo {
  serviceName: string;
  agentName: string;
  currency: string;
  price: string;
  gas: string;
  total: string;
  slaMinutes: number;
}

export interface X402PaymentRequiredBody {
  code?: number;
  reason?: string;
  message?: string;
  x402Version: number;
  error?: string;
  resource?: {
    url: string;
    description?: string;
    mimeType?: string;
  };
  accepts: X402Accept[];
  quote?: BaseQuoteInfo;
}

export interface BaseConfirmResponse {
  orderId: string;
  phase: OrderPhase;
  status: string;
  chain: 'base';
  payer: string;
  price: string;
  lockTxHash: string;
  slaDeadline: string;
}

export type OrderPhase =
  | 'pending'
  | 'locked'
  | 'delivered'
  | 'completed'
  | 'failed'
  | 'expired';

export interface OrderTimelineItem {
  phase: string;
  occurredAt: string;
  txHash: string;
}

export interface OrderDelivery {
  deliverableType: 'text' | 'schema';
  deliverableText: string;
  deliverableSchema: string;
  submittedAt: string;
}

export interface OrderRefund {
  status: 'pending' | 'done';
  amount: string;
  txHash: string;
}

export interface BaseOrderDetail {
  orderId: string;
  phase: OrderPhase;
  status: string;
  chain: 'base';
  serviceId: string;
  serviceName: string;
  agentId: string;
  agentName: string;
  payer: string;
  price: string;
  requirements: unknown;
  createdAt: string;
  slaDeadline: string;
  timeline: OrderTimelineItem[];
  delivery: OrderDelivery | null;
  refund: OrderRefund | null;
}

export interface BaseOrderListItem {
  orderId: string;
  phase: OrderPhase;
  status: string;
  serviceId: string;
  serviceName: string;
  agentName: string;
  price: string;
  createdAt: string;
  slaDeadline: string;
}

export interface BaseOrderListResponse {
  total: number;
  orders: BaseOrderListItem[];
}

// Binance Agentic Wallet (`baw`) types
export interface BawResponse<T> {
  success: boolean;
  data?: T;
  error?: string | { code?: string; message?: string };
  message?: string;
}

export interface BawWalletStatusData {
  status: 'UNCONNECTED' | 'CREATING' | 'CONNECTED' | 'EXPIRED';
}

export interface BawAddressEntry {
  binanceChainId: string;
  chainName: string;
  address: string;
}

export interface BawWalletAddressData {
  addresses: BawAddressEntry[];
}

export interface BawBalanceEntry {
  symbol: string;
  address: string;
  binanceChainId: string;
  balance: string;
  price?: string;
  value?: string;
}

export type BawOptionStatus = 'READY_TO_SIGN' | 'ACTION_REQUIRED' | 'NOT_SIGNABLE';

export interface BawPaymentOption {
  index: number;
  status: BawOptionStatus;
  reasons: string[];
  scheme: string;
  assetTransferMethod?: string;
  binanceChainId?: string;
  tokenAddress?: string;
  tokenSymbol?: string;
  amount?: string;
  amountUsd?: string;
  payTo?: string;
  userWalletAddress?: string;
  currentBalance?: string;
  currentBalanceUsd?: string;
  needApproveFirst?: boolean;
  originalAccept: X402Accept;
}

export interface BawPaymentPreviewData {
  paymentId: string;
  options: BawPaymentOption[];
}

export interface BawPaymentSignData {
  paymentHeaderName: string;
  paymentHeaderValue: string;
  approveTxHash: string | null;
  binanceChainId: string | null;
  signatureExpiresAt: number;
}

export interface BawTxHistoryData {
  transactions: Array<{
    txHash: string;
    status: 'pending' | 'confirmed' | 'failed';
    binanceChainId: string;
  }>;
}

// Local storage types
export interface CrooConfig {
  apiBaseUrl?: string;
  bawBin?: string;
}

export interface OrderDraft {
  draftId: string;
  createdAt: string;
  expiresAt: number; // unix epoch seconds
  chain: Chain;
  serviceId: string;
  serviceName: string;
  agentId: string;
  agentName: string;
  endpoint: string;
  method: 'GET' | 'POST';
  requirementsRaw: string;
  requirementsParsed: unknown;
  requirementsFile?: string;
  paymentId: string;
  selectedIndex: number;
  selectedOption: BawPaymentOption;
  // Quote metadata
  currency: string;
  priceHuman: string;
  gasHuman: string;
  totalHuman: string;
  priceAtomic: string;
  slaMinutes?: number;
  score?: number;
  feedbackCount?: number;
}

export interface OrderLogEntry {
  orderId: string;
  draftId?: string;
  chain: Chain;
  serviceId: string;
  serviceName: string;
  agentId: string;
  agentName: string;
  amount: string; // human readable e.g. "3.00"
  currency: string;
  wallet: string;
  payer: string;
  payTo: string;
  txHash: string;
  lockTxHash?: string;
  phase: OrderPhase | 'free';
  status: string;
  createdAt: string;
  updatedAt: string;
  slaMinutes?: number;
  slaDeadline?: string;
  requirements?: unknown;
  bnbResponseBody?: string;
  bnbResponseContentType?: string;
  bnbHttpStatus?: number;
  error?: string;
}
