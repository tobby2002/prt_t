from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

import backtrader as bt
import numpy as np
import pandas as pd

# 임의의 금융상품 시계열 데이터 생성
def synthetic_ohlcv2(days: int = 400, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2023-01-01", periods=days, freq="D")
    rets = rng.normal(0.0004, 0.018, days)
    close = 100.0 * np.exp(np.cumsum(rets))
    noise_h = rng.uniform(0.0, 0.015, days)
    noise_l = rng.uniform(0.0, 0.015, days)
    high = close * (1.0 + noise_h)
    low = close * (1.0 - noise_l)
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    vol = rng.integers(1_000_000, 5_000_000, days).astype(float)
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol},
        index=idx,
    )

# 임의의 금융상품 시계열 데이터 생성2
def synthetic_ohlcv22222(days: int = 400, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2023-01-01", periods=days, freq="D")
    rets = rng.normal(0.0004, 0.018, days)
    close = 100.0 * np.exp(np.cumsum(rets))
    noise_h = rng.uniform(0.0, 0.015, days)
    noise_l = rng.uniform(0.0, 0.015, days)
    high = close * (1.0 + noise_h)
    low = close * (1.0 - noise_l)
    open_ = np.roll(close, 1)
    open_[0] = close[0]
    vol = rng.integers(1_000_000, 5_000_000, days).astype(float)
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": vol},
        index=idx,
    )

# 골든크로스 / 데드크로스 전략
class SmaCross(bt.Strategy):
    params = (("fast", 10), ("slow", 30))

    def __init__(self) -> None:
        self.fast_ma = bt.indicators.SMA(self.data.close, period=int(self.p.fast))
        self.slow_ma = bt.indicators.SMA(self.data.close, period=int(self.p.slow))
        self.cross = bt.indicators.CrossOver(self.fast_ma, self.slow_ma)
        self.equity_curve: list[tuple[str, float]] = []
        self.closed_trades: list[dict[str, Any]] = []

    def next(self) -> None:
        dt = self.data.datetime.date(0).isoformat()
        self.equity_curve.append((dt, float(self.broker.getvalue())))
        if not self.position:
            if self.cross > 0:
                self.buy()
        elif self.cross < 0:
            self.sell()

    def notify_trade(self, trade: bt.Trade) -> None:
        if not trade.isclosed:
            return
        self.closed_trades.append(
            {
                "ref": trade.ref,
                "size": float(trade.size),
                "price": float(trade.price),
                "value": float(trade.value),
                "commission": float(trade.commission),
                "pnl_gross": float(trade.pnl),
                "pnl_net": float(trade.pnlcomm),
                "dt_open": bt.num2date(trade.dtopen).isoformat(),
                "dt_close": bt.num2date(trade.dtclose).isoformat(),
            }
        )

# pandas 데이터 feed 구현
class PandasOHLCV(bt.feeds.PandasData):
    params = (
        ("datetime", None),
        ("open", "Open"),
        ("high", "High"),
        ("low", "Low"),
        ("close", "Close"),
        ("volume", "Volume"),
        ("openinterest", -1),
    )

# 백테스트 실행 결과 데이터 구조
@dataclass
class BacktestRunResult:
    initial_cash: float
    final_value: float
    pnl: float
    pnl_pct: float
    sharpe: float | None
    max_drawdown_pct: float | None
    total_trades: int
    won_trades: int
    equity_curve: list[dict[str, Any]] = field(default_factory=list)
    trades: list[dict[str, Any]] = field(default_factory=list)

# 안전하게 float 변환 함수
def _safe_float(x: Any) -> float | None:
    if x is None:
        return None
    try:
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return None
        return v
    except (TypeError, ValueError):
        return None

# sma 교차 백테스트 실행 함수
def run_sma_cross_backtest(
    *,
    fast: int = 10,
    slow: int = 30,
    cash: float = 100_000.0,
    commission: float = 0.001,
    data_days: int = 400,
    seed: int = 42,
) -> BacktestRunResult:
    if fast >= slow:
        raise ValueError("fast period must be smaller than slow period")
    df = synthetic_ohlcv(days=data_days, seed=seed)
    cerebro = bt.Cerebro()
    cerebro.broker.setcash(cash)
    cerebro.broker.setcommission(commission=commission)
    # type: ignore[call-arg]
    # 고의로 충돌을 줌
    cerebro.adddata(PandasOHLCV(dataname=df))
    cerebro.addstrategy(SmaCross, fast=fast, slow=slow)
    cerebro.addanalyzer(bt.analyzers.SharpeRatio, riskfreerate=0.0, annualize=True, timeframe=bt.TimeFrame.Days)
    cerebro.addanalyzer(bt.analyzers.DrawDown)
    cerebro.addanalyzer(bt.analyzers.TradeAnalyzer)
    strat = cerebro.run()[0]
    final_value = float(cerebro.broker.getvalue())
    pnl = final_value - cash
    pnl_pct = (pnl / cash) * 100.0 if cash else 0.0

    sharpe_a = strat.analyzers.getbyname("sharperatio").get_analysis()
    sharpe = _safe_float(sharpe_a.get("sharperatio"))

    dd_a = strat.analyzers.getbyname("drawdown").get_analysis()
    max_dd = _safe_float(dd_a.get("max", {}).get("drawdown"))

    ta = strat.analyzers.getbyname("tradeanalyzer").get_analysis()
    total = int(ta.get("total", {}).get("total", 0) or 0)
    won = int(ta.get("won", {}).get("total", 0) or 0)

    equity_curve = [{"date": d, "value": round(v, 2)} for d, v in strat.equity_curve]

    trades = list(strat.closed_trades)

    return BacktestRunResult(
        initial_cash=cash,
        final_value=round(final_value, 2),
        pnl=round(pnl, 2),
        pnl_pct=round(pnl_pct, 4),
        sharpe=round(sharpe, 4) if sharpe is not None else None,
        max_drawdown_pct=round(max_dd, 4) if max_dd is not None else None,
        total_trades=total,
        won_trades=won,
        equity_curve=equity_curve,
        trades=trades,
    )
