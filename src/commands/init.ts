import { formatInitOutput } from '../format.js';
import { getWalletSummary } from '../wallet.js';

export interface InitCommandOptions {
  json?: boolean;
}

export async function runInitCommand(opts: InitCommandOptions = {}): Promise<string> {
  const summary = await getWalletSummary();
  if (opts.json) {
    return JSON.stringify(
      {
        wallet: 'Binance Agentic Wallet',
        installed: summary.installed,
        connected: summary.connected,
        status: summary.status,
        address: summary.address,
        balances: {
          base: { currency: 'USDC', balance: summary.baseUsdcBalance },
          bsc: { currency: 'USDT', balance: summary.bscUsdtBalance },
        },
        ready: summary.installed && summary.connected,
      },
      null,
      2
    );
  }
  return formatInitOutput(summary);
}
