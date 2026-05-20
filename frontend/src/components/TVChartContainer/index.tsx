'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CandlestickData,
  CandlestickSeries,
  createChart,
  ISeriesApi,
  UTCTimestamp,
} from 'lightweight-charts';
import { getMexcKlines } from '@/lib/api';

// Helper to convert user-facing symbols to MEXC Contract / Binance Spot symbols
const getApiSymbol = (userSymbol: string, exchange: 'binance' | 'mexc'): string => {
  const sym = userSymbol.trim().toUpperCase();
  if (exchange === 'mexc') {
    let base = sym;
    if (sym.endsWith('.P')) {
      base = sym.slice(0, -2);
    }
    if (!base.includes('_')) {
      if (base.endsWith('USDT')) {
        return base.replace('USDT', '_USDT');
      }
      return `${base}_USDT`;
    }
    return base;
  } else {
    let base = sym;
    if (sym.endsWith('.P')) {
      base = sym.slice(0, -2);
    }
    return base.replace('_', '');
  }
};

// Helper to convert intervals
const getApiInterval = (interval: string, exchange: 'binance' | 'mexc'): string => {
  if (exchange === 'mexc') {
    const mapping: Record<string, string> = {
      '1m': 'Min1',
      '5m': 'Min5',
      '15m': 'Min15',
      '1h': 'Min60',
      '1d': 'Day1',
    };
    return mapping[interval] || 'Min1';
  }
  return interval;
};

// Helper to parse Binance Spot klines
const parseBinanceKlines = (payload: any): CandlestickData[] => {
  if (!Array.isArray(payload)) return [];
  return payload.map((item: any) => ({
    time: (item[0] / 1000) as UTCTimestamp,
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
  }));
};

export const TVChartContainer = () => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const [exchange, setExchange] = useState<'binance' | 'mexc'>('mexc');
  const [symbol, setSymbol] = useState('BTCUSDT.P');
  const [inputSymbol, setInputSymbol] = useState('BTCUSDT.P');
  const [interval, setInterval] = useState('1m');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChangeDir, setPriceChangeDir] = useState<'up' | 'down' | 'neutral'>('neutral');

  const priceDirTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleExchangeChange = (newExchange: 'binance' | 'mexc') => {
    setExchange(newExchange);
    if (newExchange === 'mexc') {
      const nextSym = symbol.endsWith('.P') ? symbol : `${symbol.replace('_', '')}.P`;
      setSymbol(nextSym);
      setInputSymbol(nextSym);
    } else {
      const nextSym = symbol.endsWith('.P') ? symbol.slice(0, -2) : symbol;
      setSymbol(nextSym);
      setInputSymbol(nextSym);
    }
  };

  const handleSymbolSubmit = () => {
    if (!inputSymbol.trim()) return;
    const formatted = inputSymbol.trim().toUpperCase();
    setSymbol(formatted);
    setInputSymbol(formatted);
  };

  const handleQuickSymbol = (quickSym: string) => {
    setSymbol(quickSym);
    setInputSymbol(quickSym);
  };

  const updateCurrentPrice = (price: number) => {
    setCurrentPrice((prev) => {
      if (prev !== null) {
        if (price > prev) {
          setPriceChangeDir('up');
          if (priceDirTimeoutRef.current) clearTimeout(priceDirTimeoutRef.current);
          priceDirTimeoutRef.current = setTimeout(() => setPriceChangeDir('neutral'), 400);
        } else if (price < prev) {
          setPriceChangeDir('down');
          if (priceDirTimeoutRef.current) clearTimeout(priceDirTimeoutRef.current);
          priceDirTimeoutRef.current = setTimeout(() => setPriceChangeDir('neutral'), 400);
        }
      }
      return price;
    });
  };

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth || 800,
      height: 500,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#0f172a',
      },
      grid: {
        vertLines: { color: '#f1f5f9' },
        horzLines: { color: '#f1f5f9' },
      },
      rightPriceScale: {
        borderColor: '#cbd5e1',
      },
      timeScale: {
        borderColor: '#cbd5e1',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    candleSeriesRef.current = candleSeries;

    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight || 500,
        });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    let socket: WebSocket | null = null;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let pingTimer: NodeJS.Timeout | null = null;
    let reconnectAttempts = 0;

    const scheduleReconnect = () => {
      if (reconnectAttempts > 8) {
        setError('실시간 연결이 끊어졌습니다. 새로고침하여 재연결해 주세요.');
        return;
      }
      reconnectAttempts++;
      const delay = Math.min(30000, 1000 * 2 ** (reconnectAttempts - 1));
      reconnectTimer = setTimeout(() => {
        if (exchange === 'mexc') connectMexc();
        else connectBinance();
      }, delay);
    };

    const connectBinance = () => {
      if (socket) socket.close();
      setWsStatus('connecting');

      const apiSymbol = getApiSymbol(symbol, 'binance');
      const apiInterval = getApiInterval(interval, 'binance');
      const wsUrl = `wss://stream.binance.com:9443/ws/${apiSymbol.toLowerCase()}@kline_${apiInterval}`;

      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setWsStatus('connected');
        reconnectAttempts = 0;
        setError(null);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const k = payload.k;
          if (k && candleSeriesRef.current) {
            const candle: CandlestickData = {
              time: (k.t / 1000) as UTCTimestamp,
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
            };
            candleSeriesRef.current.update(candle);
            updateCurrentPrice(parseFloat(k.c));
          }
        } catch (err) {
          console.warn('Binance WS error parsing kline message', err);
        }
      };

      socket.onerror = () => {
        setWsStatus('disconnected');
      };

      socket.onclose = (event) => {
        setWsStatus('disconnected');
        if (event.code !== 1000 && event.code !== 1005) {
          scheduleReconnect();
        }
      };
    };

    const connectMexc = () => {
      if (socket) socket.close();
      setWsStatus('connecting');

      const apiSymbol = getApiSymbol(symbol, 'mexc');
      const apiInterval = getApiInterval(interval, 'mexc');
      const wsUrl = 'wss://contract.mexc.com/edge';

      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        setWsStatus('connected');
        reconnectAttempts = 0;
        setError(null);

        // Subscribe to K-line stream
        const subMsg = {
          method: 'sub.kline',
          param: {
            symbol: apiSymbol,
            interval: apiInterval,
          },
        };
        socket.send(JSON.stringify(subMsg));

        // Start ping heartbeat every 30s
        pingTimer = setInterval(() => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ method: 'ping' }));
          }
        }, 30000);
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.channel === 'push.kline' && payload.data) {
            const k = payload.data;
            if (candleSeriesRef.current) {
              const candle: CandlestickData = {
                time: k.t as UTCTimestamp,
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
              };
              candleSeriesRef.current.update(candle);
              updateCurrentPrice(parseFloat(k.c));
            }
          }
        } catch (err) {
          console.warn('MEXC WS error parsing kline message', err);
        }
      };

      socket.onerror = () => {
        setWsStatus('disconnected');
      };

      socket.onclose = (event) => {
        setWsStatus('disconnected');
        if (pingTimer) clearInterval(pingTimer);
        if (event.code !== 1000 && event.code !== 1005) {
          scheduleReconnect();
        }
      };
    };

    const loadData = async () => {
      setLoading(true);
      setError(null);
      setCurrentPrice(null);
      setPriceChangeDir('neutral');

      const apiSymbol = getApiSymbol(symbol, exchange);
      const apiInterval = getApiInterval(interval, exchange);

      try {
        if (exchange === 'mexc') {
          const data = await getMexcKlines(apiSymbol, apiInterval);
          if (data.length > 0) {
            const sortedData = [...data].sort((a, b) => a.time - b.time);
            candleSeries.setData(sortedData as any);
            chart.timeScale().fitContent();

            const latest = sortedData[sortedData.length - 1];
            if (latest) {
              setCurrentPrice(latest.close);
            }
          } else {
            setError('MEXC로부터 캔들 데이터를 받아오지 못했습니다.');
          }
        } else {
          const url = `https://api.binance.com/api/v3/klines?symbol=${apiSymbol}&interval=${apiInterval}&limit=300`;
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Binance API 오류: ${res.status}`);
          }
          const payload = await res.json();
          const candles = parseBinanceKlines(payload);
          if (candles.length > 0) {
            candleSeries.setData(candles);
            chart.timeScale().fitContent();

            const latest = candles[candles.length - 1];
            if (latest) {
              setCurrentPrice(latest.close);
            }
          } else {
            setError('Binance로부터 캔들 데이터를 받아오지 못했습니다.');
          }
        }

        // Connect WS
        if (exchange === 'mexc') connectMexc();
        else connectBinance();
      } catch (err: any) {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    loadData();

    return () => {
      if (socket) socket.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (priceDirTimeoutRef.current) clearTimeout(priceDirTimeoutRef.current);
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [exchange, symbol, interval]);

  const quickSymbols = exchange === 'mexc'
    ? ['BTCUSDT.P', 'ETHUSDT.P', 'SOLUSDT.P', 'XRPUSDT.P']
    : ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];

  return (
    <div className="flex flex-col w-full bg-white rounded-xl shadow-sm border border-zinc-200 overflow-hidden">
      {/* Control panel header */}
      <div className="flex flex-col gap-4 p-4 border-b border-zinc-100 sm:flex-row sm:items-center sm:justify-between bg-zinc-50/50">
        <div className="flex flex-wrap items-center gap-3">
          {/* Exchange selection */}
          <div className="flex bg-zinc-200 p-0.5 rounded-lg border border-zinc-300 shadow-inner">
            <button
              onClick={() => handleExchangeChange('mexc')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                exchange === 'mexc'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              MEXC 선물 (.P)
            </button>
            <button
              onClick={() => handleExchangeChange('binance')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${
                exchange === 'binance'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
              }`}
            >
              Binance 현물
            </button>
          </div>

          {/* Timeframe dropdown */}
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            className="px-3 py-1.5 text-xs font-semibold border border-zinc-300 bg-white rounded-lg focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 shadow-sm"
          >
            <option value="1m">1분봉 (1m)</option>
            <option value="5m">5분봉 (5m)</option>
            <option value="15m">15분봉 (15m)</option>
            <option value="1h">1시간봉 (1h)</option>
            <option value="1d">1일봉 (1d)</option>
          </select>

          {/* Connection status badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white shadow-sm">
            <span className={`relative flex h-2 w-2`}>
              {wsStatus === 'connected' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              {wsStatus === 'connecting' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${
                wsStatus === 'connected'
                  ? 'bg-emerald-500'
                  : wsStatus === 'connecting'
                  ? 'bg-amber-500'
                  : 'bg-red-500'
              }`}></span>
            </span>
            <span className="text-2xs font-bold uppercase tracking-wider text-zinc-500">
              WS {wsStatus === 'connected' ? '연결됨' : wsStatus === 'connecting' ? '연결중' : '연결끊김'}
            </span>
          </div>
        </div>

        {/* Real-time price display */}
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-3xs font-bold uppercase tracking-wider text-zinc-400">실시간 체결가</span>
            <span className={`text-xl font-bold font-mono transition-all duration-300 ${
              priceChangeDir === 'up'
                ? 'text-emerald-500 scale-105'
                : priceChangeDir === 'down'
                ? 'text-red-500 scale-105'
                : 'text-zinc-900'
            }`}>
              {currentPrice !== null
                ? currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Quick selection & custom symbol input */}
      <div className="flex flex-col gap-3 px-4 py-3 border-b border-zinc-100 bg-white sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-zinc-500 mr-1.5">인기 심볼:</span>
          {quickSymbols.map((qs) => (
            <button
              key={qs}
              onClick={() => handleQuickSymbol(qs)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                symbol === qs
                  ? 'bg-zinc-900 text-white'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'
              }`}
            >
              {qs}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-zinc-500">직접 입력:</span>
          <input
            type="text"
            value={inputSymbol}
            onChange={(e) => setInputSymbol(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSymbolSubmit()}
            className="w-32 px-3 py-1 text-xs font-medium uppercase border border-zinc-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-zinc-900 focus:border-zinc-900 shadow-sm"
            placeholder={exchange === 'mexc' ? 'BTCUSDT.P' : 'BTCUSDT'}
          />
          <button
            onClick={handleSymbolSubmit}
            className="px-3 py-1 text-xs font-bold bg-zinc-900 text-white hover:bg-zinc-800 rounded-lg shadow-sm transition-colors cursor-pointer"
          >
            조회
          </button>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="relative w-full h-[500px] bg-white">
        {error && (
          <div className="absolute top-4 left-4 right-4 z-10 p-3 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-red-800 shadow-sm">
            {error}
          </div>
        )}
        
        {loading && (
          <div className="absolute inset-0 z-25 flex items-center justify-center bg-white/70 backdrop-blur-xs">
            <div className="flex flex-col items-center gap-2">
              <span className="animate-spin h-6 w-6 border-2 border-zinc-900 border-t-transparent rounded-full"></span>
              <span className="text-xs font-semibold text-zinc-500">데이터를 로드하는 중입니다...</span>
            </div>
          </div>
        )}

        <div ref={chartContainerRef} className="w-full h-full" />
      </div>

      {/* Chart Footer Info */}
      <div className="px-4 py-2 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between text-3xs text-zinc-400 font-medium">
        <span>
          차트 제공: Lightweight-Charts (TradingView) | 데이터: {exchange === 'mexc' ? 'MEXC 선물 REST + WS' : 'Binance Spot REST + WS'}
        </span>
        <span>심볼: {symbol} | 봉간격: {interval}</span>
      </div>
    </div>
  );
};
