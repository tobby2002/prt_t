"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BacktestDetail, BacktestSummary } from "@/lib/api";
import { getBacktest, health, runBacktest } from "@/lib/api";

const defaultForm = {
  fast: 10,
  slow: 30,
  cash: 100_000,
  commission: 0.001,
  data_days: 400,
  seed: 42,
};

function formatMoney(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function Home() {
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<BacktestDetail | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const h = await health();
      setApiOk(h.status === "ok");
    } catch {
      setApiOk(false);
    }
  }, []);

  const onRun = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const started = await runBacktest(form);
      const full = await getBacktest(started.id);
      setDetail(full);
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [form]);

  const chartData = useMemo(
    () => detail?.equity_curve.map((p) => ({ ...p, label: p.date.slice(5) })) ?? [],
    [detail],
  );

  const summary: BacktestSummary | null = detail?.summary ?? null;

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">prj_t · Backtrader</h1>
            <p className="mt-1 text-sm text-zinc-600">
              FastAPI 백엔드에서 SMA 크로스 전략을 실행하고 결과를 확인합니다.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={checkHealth}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50"
            >
              API 상태 확인
            </button>
            {apiOk === true && (
              <span className="text-sm font-medium text-emerald-700">백엔드 연결됨</span>
            )}
            {apiOk === false && (
              <span className="text-sm font-medium text-red-700">백엔드에 연결할 수 없음</span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-8">
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">백테스트 파라미터</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">빠른 SMA</span>
              <input
                type="number"
                className="rounded-md border border-zinc-300 px-3 py-2"
                value={form.fast}
                min={2}
                max={200}
                onChange={(e) => setForm((f) => ({ ...f, fast: Number(e.target.value) }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">느린 SMA</span>
              <input
                type="number"
                className="rounded-md border border-zinc-300 px-3 py-2"
                value={form.slow}
                min={3}
                max={500}
                onChange={(e) => setForm((f) => ({ ...f, slow: Number(e.target.value) }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">초기 자금</span>
              <input
                type="number"
                className="rounded-md border border-zinc-300 px-3 py-2"
                value={form.cash}
                min={1000}
                onChange={(e) => setForm((f) => ({ ...f, cash: Number(e.target.value) }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">수수료율</span>
              <input
                type="number"
                step="0.0001"
                className="rounded-md border border-zinc-300 px-3 py-2"
                value={form.commission}
                min={0}
                max={0.05}
                onChange={(e) => setForm((f) => ({ ...f, commission: Number(e.target.value) }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">데이터 일수</span>
              <input
                type="number"
                className="rounded-md border border-zinc-300 px-3 py-2"
                value={form.data_days}
                min={50}
                max={5000}
                onChange={(e) => setForm((f) => ({ ...f, data_days: Number(e.target.value) }))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-zinc-700">난수 시드</span>
              <input
                type="number"
                className="rounded-md border border-zinc-300 px-3 py-2"
                value={form.seed}
                min={0}
                onChange={(e) => setForm((f) => ({ ...f, seed: Number(e.target.value) }))}
              />
            </label>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={loading}
              onClick={onRun}
              className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "실행 중…" : "백테스트 실행"}
            </button>
            <p className="text-xs text-zinc-500">
              백엔드 기본 주소: <code className="rounded bg-zinc-100 px-1">NEXT_PUBLIC_API_URL</code> 미설정 시{" "}
              <code className="rounded bg-zinc-100 px-1">http://127.0.0.1:8000</code>
            </p>
          </div>
          {error && (
            <pre className="mt-4 overflow-x-auto rounded-md bg-red-50 p-3 text-xs text-red-800">{error}</pre>
          )}
        </section>

        {summary && (
          <section className="grid gap-4 lg:grid-cols-4">
            <Stat label="최종 자산" value={`${formatMoney(summary.final_value)}`} hint={`시작 ${formatMoney(summary.initial_cash)}`} />
            <Stat label="손익" value={`${formatMoney(summary.pnl)}`} hint={`${summary.pnl_pct.toFixed(2)} %`} />
            <Stat label="샤프 (연율화)" value={summary.sharpe == null ? "—" : `${summary.sharpe}`} hint="일간 데이터 기준" />
            <Stat
              label="최대 낙폭"
              value={summary.max_drawdown_pct == null ? "—" : `${summary.max_drawdown_pct} %`}
              hint="백트레이더 DrawDown"
            />
            <Stat label="거래 수" value={`${summary.total_trades}`} hint={`승: ${summary.won_trades}`} />
          </section>
        )}

        {chartData.length > 0 && (
          <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">자산 곡선</h2>
            <div className="mt-4 h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} tickFormatter={(v) => formatMoney(Number(v))} />
                  <Tooltip
                    formatter={(value) => {
                      const n = typeof value === "number" ? value : Number(value);
                      return [formatMoney(Number.isFinite(n) ? n : 0), "자산"];
                    }}
                    labelFormatter={(_, payload) => {
                      const p = payload?.[0]?.payload as { date?: string } | undefined;
                      return p?.date ?? "";
                    }}
                  />
                  <Line type="monotone" dataKey="value" stroke="#18181b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {detail && detail.trades.length > 0 && (
          <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">체결된 거래</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                    <th className="py-2 pr-4">Open</th>
                    <th className="py-2 pr-4">Close</th>
                    <th className="py-2 pr-4">Size</th>
                    <th className="py-2 pr-4">Price</th>
                    <th className="py-2 pr-4">수수료</th>
                    <th className="py-2 pr-4">순손익</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.trades.map((t) => (
                    <tr key={`${t.ref}-${t.dt_close}`} className="border-b border-zinc-100">
                      <td className="py-2 pr-4 whitespace-nowrap text-zinc-700">{t.dt_open}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-zinc-700">{t.dt_close}</td>
                      <td className="py-2 pr-4">{t.size}</td>
                      <td className="py-2 pr-4">{formatMoney(t.price)}</td>
                      <td className="py-2 pr-4">{formatMoney(t.commission)}</td>
                      <td className={`py-2 pr-4 font-medium ${t.pnl_net >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {formatMoney(t.pnl_net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-2 text-xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
}
