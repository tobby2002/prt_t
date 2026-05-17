const defaultBase = "http://127.0.0.1:8000";

export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? defaultBase).replace(/\/$/, "");
}

export type BacktestSummary = {
  initial_cash: number;
  final_value: number;
  pnl: number;
  pnl_pct: number;
  sharpe: number | null;
  max_drawdown_pct: number | null;
  total_trades: number;
  won_trades: number;
};

export type EquityPoint = { date: string; value: number };

export type TradeRow = {
  ref: number;
  size: number;
  price: number;
  value: number;
  commission: number;
  pnl_gross: number;
  pnl_net: number;
  dt_open: string;
  dt_close: string;
};

export type BacktestDetail = {
  id: string;
  summary: BacktestSummary;
  equity_curve: EquityPoint[];
  trades: TradeRow[];
};

export async function runBacktest(body: {
  fast: number;
  slow: number;
  cash: number;
  commission: number;
  data_days: number;
  seed: number;
}): Promise<{ id: string; summary: BacktestSummary }> {
  const res = await fetch(`${apiBaseUrl()}/api/backtests/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getBacktest(id: string): Promise<BacktestDetail> {
  const res = await fetch(`${apiBaseUrl()}/api/backtests/${id}`, {
    method: "GET",
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function health(): Promise<{ status: string }> {
  const res = await fetch(`${apiBaseUrl()}/api/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
