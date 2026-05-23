from __future__ import annotations

import uuid
from functools import lru_cache
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from prj_t_backend.backtest_engine import run_sma_cross_backtest
from prj_t_backend.config import Settings, get_settings

_store: dict[str, dict[str, Any]] = {}

# tobby1-1 백테스트 요청 데이터 구조
class RunBacktestRequest(BaseModel):
    fast: int = Field(10, ge=2, le=200)
    slow: int = Field(30, ge=3, le=500)
    cash: float = Field(100_000.0, gt=0)
    commission: float = Field(0.001, ge=0, le=0.05)
    data_days: int = Field(400, ge=50, le=5000)
    seed: int = Field(42, ge=0)

# tobby2002_1@gmail.com 백테스트 응답 데이터 구조
class RunBacktestResponse(BaseModel):
    id: str
    summary: dict[str, Any]


@lru_cache
def _cached_settings() -> Settings:
    return get_settings()

# 수정:dev_fe로 배포하기위한 수정 
def create_app() -> FastAPI:
    settings = _cached_settings()
    app = FastAPI(title="prj_t Backtrader API", version="0.1.0")

    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["http://localhost:3000"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/bye")
    def health() -> dict[str, str]:
        return {"status": "good bye"}

    @app.get("/api/mexc/klines")
    def get_mexc_klines(symbol: str = "BTC_USDT", interval: str = "Min1") -> list[dict[str, Any]]:
        import urllib.request
        import json

        # Normalize symbol: e.g. BTCUSDT.P -> BTC_USDT, BTCUSDT -> BTC_USDT
        sym = symbol.strip().upper()
        if "." in sym:
            sym = sym.split(".")[0]
        if "_" not in sym:
            if sym.endswith("USDT"):
                sym = sym[:-4] + "_" + "USDT"
            else:
                sym = sym + "_USDT"

        url = f"https://contract.mexc.com/api/v1/contract/kline/{sym}?interval={interval}"
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=15) as response:
                res_data = json.loads(response.read().decode("utf-8"))

            if not res_data.get("success"):
                raise HTTPException(status_code=400, detail=f"MEXC API returned success=false: {res_data}")

            data = res_data.get("data", {})
            # MEXC Contract API returns: { "time": [...], "open": [...], "close": [...], "high": [...], "low": [...] }
            times = data.get("time", [])
            opens = data.get("open", [])
            closes = data.get("close", [])
            highs = data.get("high", [])
            lows = data.get("low", [])

            normalized = []
            for i in range(len(times)):
                normalized.append({
                    "time": int(times[i]),
                    "open": float(opens[i]),
                    "high": float(highs[i]),
                    "low": float(lows[i]),
                    "close": float(closes[i])
                })
            return normalized
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to fetch MEXC klines: {str(e)}")


    @app.post("/api/backtests/run", response_model=RunBacktestResponse)
    def run_backtest(body: RunBacktestRequest) -> RunBacktestResponse:
        try:
            result = run_sma_cross_backtest(
                fast=body.fast,
                slow=body.slow,
                cash=body.cash,
                commission=body.commission,
                data_days=body.data_days,
                seed=body.seed,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        rid = str(uuid.uuid4())
        payload = {
            "id": rid,
            "summary": {
                "initial_cash": result.initial_cash,
                "final_value": result.final_value,
                "pnl": result.pnl,
                "pnl_pct": result.pnl_pct,
                "sharpe": result.sharpe,
                "max_drawdown_pct": result.max_drawdown_pct,
                "total_trades": result.total_trades,
                "won_trades": result.won_trades,
            },
            "equity_curve": result.equity_curve,
            "trades": result.trades,
        }
        _store[rid] = payload
        return RunBacktestResponse(id=rid, summary=payload["summary"])

    @app.get("/api/backtests/{run_id}")
    def get_backtest(run_id: str) -> dict[str, Any]:
        if run_id not in _store:
            raise HTTPException(status_code=404, detail="Unknown backtest id")
        return _store[run_id]

    return app


app = create_app()
