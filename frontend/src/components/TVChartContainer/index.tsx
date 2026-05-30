'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  ISeriesApi,
  UTCTimestamp,
} from 'lightweight-charts';
import { getMexcKlines } from '@/lib/api';
import type { CandlestickData as ApiCandlestickData } from '@/lib/api';

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

// Helper to parse Binance Spot klines (includes volume at index 5)
const parseBinanceKlines = (payload: any): ApiCandlestickData[] => {
  if (!Array.isArray(payload)) return [];
  return payload.map((item: any) => ({
    time: (item[0] / 1000) as UTCTimestamp,
    open: parseFloat(item[1]),
    high: parseFloat(item[2]),
    low: parseFloat(item[3]),
    close: parseFloat(item[4]),
    volume: parseFloat(item[5]),
  }));
};

const calculateIchimokuCloud = (data: ApiCandlestickData[]) => {
  const spanA: { time: UTCTimestamp; value: number }[] = [];
  const spanB: { time: UTCTimestamp; value: number }[] = [];

  if (data.length === 0) return { spanA, spanB };

  // Calculate for historical data
  for (let i = 0; i < data.length; i += 1) {
    const tenkanWindow = data.slice(Math.max(0, i - 8), i + 1);
    const kijunWindow = data.slice(Math.max(0, i - 25), i + 1);

    const tenkanHigh = Math.max(...tenkanWindow.map((d) => d.high));
    const tenkanLow = Math.min(...tenkanWindow.map((d) => d.low));
    const kijunHigh = Math.max(...kijunWindow.map((d) => d.high));
    const kijunLow = Math.min(...kijunWindow.map((d) => d.low));

    const tenkan = (tenkanHigh + tenkanLow) / 2;
    const kijun = (kijunHigh + kijunLow) / 2;

    const spanAValue = (tenkan + kijun) / 2;
    if (i + 26 < data.length) {
      spanA.push({ time: data[i + 26].time as UTCTimestamp, value: spanAValue });
    }

    if (i >= 51) {
      const senkouBHigh = Math.max(...data.slice(i - 51, i + 1).map((d) => d.high));
      const senkouBLow = Math.min(...data.slice(i - 51, i + 1).map((d) => d.low));
      const spanBValue = (senkouBHigh + senkouBLow) / 2;
      if (i + 26 < data.length) {
        spanB.push({ time: data[i + 26].time as UTCTimestamp, value: spanBValue });
      }
    }
  }

  // Calculate future part: shift the last 26 calculated values forward
  const lastDataIdx = data.length - 1;
  if (lastDataIdx >= 0) {
    const candle_interval = lastDataIdx > 0 ? data[lastDataIdx].time - data[lastDataIdx - 1].time : 60;

    // Collect the span A and B values for the last 26 periods
    const futureSpanAValues: number[] = [];
    const futureSpanBValues: number[] = [];

    // Calculate span A and B for i from (lastDataIdx - 25) to lastDataIdx
    for (let i = Math.max(0, lastDataIdx - 25); i <= lastDataIdx; i += 1) {
      const tenkanWindow = data.slice(Math.max(0, i - 8), i + 1);
      const kijunWindow = data.slice(Math.max(0, i - 25), i + 1);

      const tenkanHigh = Math.max(...tenkanWindow.map((d) => d.high));
      const tenkanLow = Math.min(...tenkanWindow.map((d) => d.low));
      const kijunHigh = Math.max(...kijunWindow.map((d) => d.high));
      const kijunLow = Math.min(...kijunWindow.map((d) => d.low));

      const tenkan = (tenkanHigh + tenkanLow) / 2;
      const kijun = (kijunHigh + kijunLow) / 2;
      const spanAValue = (tenkan + kijun) / 2;
      futureSpanAValues.push(spanAValue);
    }

    for (let i = Math.max(0, lastDataIdx - 25); i <= lastDataIdx; i += 1) {
      let spanBValue = 0;
      if (i >= 51) {
        const senkouBHigh = Math.max(...data.slice(i - 51, i + 1).map((d) => d.high));
        const senkouBLow = Math.min(...data.slice(i - 51, i + 1).map((d) => d.low));
        spanBValue = (senkouBHigh + senkouBLow) / 2;
      }
      futureSpanBValues.push(spanBValue);
    }

    // Shift these values 26 periods into the future
    for (let j = 1; j <= 26; j++) {
      const futureTime = (data[lastDataIdx].time + j * candle_interval) as UTCTimestamp;
      const valueIdx = j - 1; // Maps j=1 to index 0, j=2 to index 1, etc.

      if (valueIdx < futureSpanAValues.length) {
        spanA.push({ time: futureTime, value: futureSpanAValues[valueIdx] });
      }
      if (valueIdx < futureSpanBValues.length) {
        spanB.push({ time: futureTime, value: futureSpanBValues[valueIdx] });
      }
    }
  }

  return { spanA, spanB };
};

const calculateRsi = (data: ApiCandlestickData[], period: number = 14) => {
  const rsiValues: { time: UTCTimestamp; value: number }[] = [];
  if (data.length <= period) return rsiValues;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const difference = data[i].close - data[i - 1].close;
    if (difference > 0) {
      gains += difference;
    } else {
      losses -= difference;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

  rsiValues.push({ time: data[period].time as UTCTimestamp, value: rsi });

  for (let i = period + 1; i < data.length; i++) {
    const difference = data[i].close - data[i - 1].close;
    const gain = difference > 0 ? difference : 0;
    const loss = difference < 0 ? -difference : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

    rsiValues.push({ time: data[i].time as UTCTimestamp, value: rsi });
  }

  return rsiValues;
};

const calculateSma = (data: { time: UTCTimestamp; value: number }[], period: number = 14) => {
  const smaValues: { time: UTCTimestamp; value: number }[] = [];
  if (data.length < period) return smaValues;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].value;
  }
  smaValues.push({ time: data[period - 1].time, value: sum / period });

  for (let i = period; i < data.length; i++) {
    sum = sum - data[i - period].value + data[i].value;
    smaValues.push({ time: data[i].time, value: sum / period });
  }
  return smaValues;
};


export const TVChartContainer = () => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  // RSI chart container and refs
  const rsiChartContainerRef = useRef<HTMLDivElement>(null);
  const rsiChartRef = useRef<any>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ichimokuSeriesARef = useRef<ISeriesApi<'Line'> | null>(null);
  const ichimokuSeriesBRef = useRef<ISeriesApi<'Line'> | null>(null);
  const chartRef = useRef<any | null>(null);
  const [chartInstance, setChartInstance] = useState<any>(null);
  const lastVolumeDataRef = useRef<{ time: number; value: number }[] | null>(null);
  const allCandlesRef = useRef<ApiCandlestickData[]>([]);
  const ichimokuDataRef = useRef<{ spanA: { time: number; value: number }[]; spanB: { time: number; value: number }[] } | null>(null);

  const [exchange, setExchange] = useState<'binance' | 'mexc'>('mexc');
  const [symbol, setSymbol] = useState('BTCUSDT.P');
  const [inputSymbol, setInputSymbol] = useState('BTCUSDT.P');
  const [interval, setInterval] = useState('1m');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVolume, setShowVolume] = useState(true);
  const [showIchimoku, setShowIchimoku] = useState(false);
  // RSI toggle and series (length 14)
  const [showRSI, setShowRSI] = useState(false);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiMaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiDataRef = useRef<{ time: number; value: number }[] | null>(null);

  const updateRsiData = () => {
    if (allCandlesRef.current.length === 0) return;
    const rsiVals = calculateRsi(allCandlesRef.current);
    const rsiMaVals = calculateSma(rsiVals);

    if (rsiSeriesRef.current) {
      rsiSeriesRef.current.setData(rsiVals);
    }
    if (rsiMaSeriesRef.current) {
      rsiMaSeriesRef.current.setData(rsiMaVals);
    }
  };

  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChangeDir, setPriceChangeDir] = useState<'up' | 'down' | 'neutral'>('neutral');
  const [showScrollToLatest, setShowScrollToLatest] = useState(false);

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

  const setChartToLatest = (chartInstance: any, totalBars: number) => {
    if (!chartInstance || totalBars === 0) return;
    const from = Math.max(0, totalBars - 120);
    const to = Math.round(from + (totalBars - from) * 1.25);
    chartInstance.timeScale().setVisibleLogicalRange({ from, to });
  };

  const handleScrollToLatest = () => {
    if (chartRef.current && allCandlesRef.current.length > 0) {
      setChartToLatest(chartRef.current, allCandlesRef.current.length);
    }
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

    const VOL_UP_COLOR = '#10b981';
    const VOL_DOWN_COLOR = '#ef4444';

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth || 800,
      height: 500,
      layout: {
        background: { color: '#ffffff' },
        textColor: '#0f172a',
        panes: { enableResize: true },
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
        rightOffset: 30,
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
    chartRef.current = chart;
    setChartInstance(chart);
    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        const width = chartContainerRef.current.clientWidth;
        const height = chartContainerRef.current.clientHeight || 500;
        if (width > 0) {
          chart.applyOptions({ width, height });
        }
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    let isCancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: any = null;
    let pingTimer: any = null;
    let reconnectAttempts = 0;

    const scheduleReconnect = () => {
      if (isCancelled) return;
      if (reconnectAttempts > 8) {
        setError('실시간 연결이 끊어졌습니다. 새로고침하여 재연결해 주세요.');
        return;
      }
      reconnectAttempts++;
      const delay = Math.min(30000, 1000 * 2 ** (reconnectAttempts - 1));
      reconnectTimer = setTimeout(() => {
        if (isCancelled) return;
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
        if (isCancelled) return;
        setWsStatus('connected');
        reconnectAttempts = 0;
        setError(null);
      };

      socket.onmessage = (event) => {
        if (isCancelled) return;
        try {
          const payload = JSON.parse(event.data);
          const k = payload.k;
          if (k && candleSeriesRef.current) {
            const candle: ApiCandlestickData = {
              time: (k.t / 1000) as UTCTimestamp,
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: k.v ? parseFloat(k.v) : undefined,
            };
            candleSeriesRef.current.update(candle as any);
            updateCurrentPrice(parseFloat(k.c));

            const lastIndex = allCandlesRef.current.length - 1;
            if (lastIndex >= 0 && allCandlesRef.current[lastIndex].time === candle.time) {
              allCandlesRef.current[lastIndex] = candle;
            } else {
              allCandlesRef.current.push(candle);
            }
            ichimokuDataRef.current = calculateIchimokuCloud(allCandlesRef.current);
            if (ichimokuSeriesARef.current && ichimokuDataRef.current) {
              ichimokuSeriesARef.current.setData(ichimokuDataRef.current.spanA as any);
            }
            if (ichimokuSeriesBRef.current && ichimokuDataRef.current) {
              ichimokuSeriesBRef.current.setData(ichimokuDataRef.current.spanB as any);
            }
            updateRsiData();

            if (volumeSeriesRef.current && candle.volume !== undefined) {
              const raw = candle.volume ?? 0;
              const prevMax = lastVolumeDataRef.current && lastVolumeDataRef.current.length
                ? Math.max(...lastVolumeDataRef.current.map((v) => v.value))
                : raw;
              const capVal = Math.max(1, prevMax * 1.2);
              const capped = Math.min(raw, capVal);
              const color = (candle.close ?? 0) >= (candle.open ?? 0) ? VOL_UP_COLOR : VOL_DOWN_COLOR;
              volumeSeriesRef.current.update({ time: candle.time as UTCTimestamp, value: capped, color } as any);
            }
          }
        } catch (err) {
          console.warn('Binance WS error parsing kline message', err);
        }
      };

      socket.onerror = () => {
        if (isCancelled) return;
        setWsStatus('disconnected');
      };

      socket.onclose = (event) => {
        if (isCancelled) return;
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
        if (isCancelled) return;
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
        if (socket) {
          socket.send(JSON.stringify(subMsg));
        }

        // Start ping heartbeat every 30s
        pingTimer = window.setInterval(() => {
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ method: 'ping' }));
          }
        }, 30000);
      };

      socket.onmessage = (event) => {
        if (isCancelled) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload.channel === 'push.kline' && payload.data) {
            const k = payload.data;
            if (candleSeriesRef.current) {
              const candle: ApiCandlestickData = {
                time: k.t as UTCTimestamp,
                open: parseFloat(k.o),
                high: parseFloat(k.h),
                low: parseFloat(k.l),
                close: parseFloat(k.c),
                volume: k.v ? parseFloat(k.v) : k.v2 ? parseFloat(k.v2) : undefined,
              };
              candleSeriesRef.current.update(candle as any);
              updateCurrentPrice(parseFloat(k.c));

              const lastIndex = allCandlesRef.current.length - 1;
              if (lastIndex >= 0 && allCandlesRef.current[lastIndex].time === candle.time) {
                allCandlesRef.current[lastIndex] = candle;
              } else {
                allCandlesRef.current.push(candle);
              }
              ichimokuDataRef.current = calculateIchimokuCloud(allCandlesRef.current);
              if (ichimokuSeriesARef.current && ichimokuDataRef.current) {
                ichimokuSeriesARef.current.setData(ichimokuDataRef.current.spanA as any);
              }
              if (ichimokuSeriesBRef.current && ichimokuDataRef.current) {
                ichimokuSeriesBRef.current.setData(ichimokuDataRef.current.spanB as any);
              }
              updateRsiData();

              if (volumeSeriesRef.current && candle.volume !== undefined) {
                const raw = candle.volume ?? 0;
                const prevMax = lastVolumeDataRef.current && lastVolumeDataRef.current.length
                  ? Math.max(...lastVolumeDataRef.current.map((v) => v.value))
                  : raw;
                const capVal = Math.max(1, prevMax * 1.2);
                const capped = Math.min(raw, capVal);
                const color = (candle.close ?? 0) >= (candle.open ?? 0) ? VOL_UP_COLOR : VOL_DOWN_COLOR;
                volumeSeriesRef.current.update({ time: candle.time as UTCTimestamp, value: capped, color } as any);
              }
            }
          }
        } catch (err) {
          console.warn('MEXC WS error parsing kline message', err);
        }
      };

      socket.onerror = () => {
        if (isCancelled) return;
        setWsStatus('disconnected');
      };

      socket.onclose = (event) => {
        if (isCancelled) return;
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
          if (isCancelled) return;
          if (data.length > 0) {
            const sortedData = [...data].sort((a, b) => a.time - b.time);
            candleSeries.setData(sortedData as any);
            setChartToLatest(chart, sortedData.length);
            allCandlesRef.current = sortedData;
            ichimokuDataRef.current = calculateIchimokuCloud(sortedData);
            if (ichimokuSeriesARef.current && ichimokuDataRef.current) {
              ichimokuSeriesARef.current.setData(ichimokuDataRef.current.spanA as any);
            }
            if (ichimokuSeriesBRef.current && ichimokuDataRef.current) {
              ichimokuSeriesBRef.current.setData(ichimokuDataRef.current.spanB as any);
            }

            const latest = sortedData[sortedData.length - 1];
            if (latest) {
              setCurrentPrice(latest.close);
            }
            // set volume series data if available (with up/down color and value capping)
            const vols = sortedData.map((d) => d.volume ?? 0);
            const maxVol = vols.length ? Math.max(...vols) : 1;
            const cap = Math.max(1, maxVol * 1.2);
            const volData = sortedData.map((d) => ({
              time: d.time,
              value: Math.min(d.volume ?? 0, cap),
              color: (d.close ?? 0) >= (d.open ?? 0) ? VOL_UP_COLOR : VOL_DOWN_COLOR,
            }));
            lastVolumeDataRef.current = volData;
            if (volumeSeriesRef.current) volumeSeriesRef.current.setData(volData as any);
          } else {
            setError('MEXC로부터 캔들 데이터를 받아오지 못했습니다.');
          }
        } else {
          const url = `https://api.binance.com/api/v3/klines?symbol=${apiSymbol}&interval=${apiInterval}&limit=300`;
          const res = await fetch(url);
          if (isCancelled) return;
          if (!res.ok) {
            throw new Error(`Binance API 오류: ${res.status}`);
          }
          const payload = await res.json();
          if (isCancelled) return;
          const candles = parseBinanceKlines(payload);
          if (candles.length > 0) {
            candleSeries.setData(candles as any);
            setChartToLatest(chart, candles.length);
            allCandlesRef.current = candles;
            ichimokuDataRef.current = calculateIchimokuCloud(candles);
            if (ichimokuSeriesARef.current && ichimokuDataRef.current) {
              ichimokuSeriesARef.current.setData(ichimokuDataRef.current.spanA as any);
            }
            if (ichimokuSeriesBRef.current && ichimokuDataRef.current) {
              ichimokuSeriesBRef.current.setData(ichimokuDataRef.current.spanB as any);
            }

            const latest = candles[candles.length - 1];
            if (latest) {
              setCurrentPrice(latest.close);
            }
            const vols = candles.map((d) => d.volume ?? 0);
            const maxVol = vols.length ? Math.max(...vols) : 1;
            const cap = Math.max(1, maxVol * 1.2);
            const volData = candles.map((d) => ({
              time: d.time,
              value: Math.min(d.volume ?? 0, cap),
              color: (d.close ?? 0) >= (d.open ?? 0) ? VOL_UP_COLOR : VOL_DOWN_COLOR,
            }));
            lastVolumeDataRef.current = volData;
            if (volumeSeriesRef.current) volumeSeriesRef.current.setData(volData as any);
          } else {
            setError('Binance로부터 캔들 데이터를 받아오지 못했습니다.');
          }
        }

        updateRsiData();

        // Connect WS
        if (isCancelled) return;
        if (exchange === 'mexc') connectMexc();
        else connectBinance();
      } catch (err: any) {
        if (isCancelled) return;
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    const createIchimokuSeries = () => {
      if (!chartRef.current) return null;
      const a = chartRef.current.addSeries(LineSeries, {
        color: 'rgba(128, 128, 128, 0.5)',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ichimokuSeriesARef.current = a;

      const b = chartRef.current.addSeries(LineSeries, {
        color: 'rgba(128, 128, 128, 0.5)',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ichimokuSeriesBRef.current = b;

      if (ichimokuDataRef.current) {
        a.setData(ichimokuDataRef.current.spanA as any);
        b.setData(ichimokuDataRef.current.spanB as any);
      }

      return { a, b };
    };

    loadData();
    if (showIchimoku) {
      createIchimokuSeries();
    }

    let isFetchingHistory = false;
    let hasMoreHistory = true;

    const handleVisibleRangeChange = async (newRange: any) => {
      if (newRange === null || isCancelled) return;

      // 우측 끝에서 벗어났는지 확인하여 처음가기 버튼 노출 제어
      const totalBars = allCandlesRef.current.length;
      const isPast = newRange.to < totalBars - 5;
      setShowScrollToLatest((prev) => (prev !== isPast ? isPast : prev));

      if (isFetchingHistory || !hasMoreHistory) return;

      // 사용자가 왼쪽 경계 근처로 스크롤한 경우 (보이는 캔들 인덱스 < 15)
      if (newRange.from < 15) {
        isFetchingHistory = true;
        try {
          const firstCandle = allCandlesRef.current[0];
          if (!firstCandle) {
            isFetchingHistory = false;
            return;
          }
          const firstCandleTime = firstCandle.time;

          let newKlines: ApiCandlestickData[] = [];
          const apiSymbol = getApiSymbol(symbol, exchange);
          const apiInterval = getApiInterval(interval, exchange);

          if (exchange === 'mexc') {
            const end = firstCandleTime - 1;
            const data = await getMexcKlines(apiSymbol, apiInterval, undefined, end);
            if (isCancelled) return;
            if (data && data.length > 0) {
              newKlines = [...data].sort((a, b) => a.time - b.time);
            }
          } else {
            const endTimeMs = (firstCandleTime * 1000) - 1;
            const url = `https://api.binance.com/api/v3/klines?symbol=${apiSymbol}&interval=${apiInterval}&limit=300&endTime=${endTimeMs}`;
            const res = await fetch(url);
            if (isCancelled) return;
            if (res.ok) {
              const payload = await res.json();
              newKlines = parseBinanceKlines(payload);
            }
          }

          if (newKlines.length === 0) {
            hasMoreHistory = false;
            isFetchingHistory = false;
            return;
          }

          // 중복 시간 제거 및 기존 데이터와 결합
          const existingTimes = new Set(allCandlesRef.current.map((c) => c.time));
          const filteredNew = newKlines.filter((c) => !existingTimes.has(c.time));

          if (filteredNew.length === 0) {
            hasMoreHistory = false;
            isFetchingHistory = false;
            return;
          }

          const combinedCandles = [...filteredNew, ...allCandlesRef.current].sort((a, b) => a.time - b.time);
          allCandlesRef.current = combinedCandles;

          // 일목구름 재계산
          ichimokuDataRef.current = calculateIchimokuCloud(combinedCandles);
          updateRsiData();

          // 메인 캔들스틱 데이터 업데이트
          candleSeries.setData(combinedCandles as any);

          // 거래량 시리즈 업데이트
          const VOL_UP_COLOR = '#10b981';
          const VOL_DOWN_COLOR = '#ef4444';
          const vols = combinedCandles.map((d) => d.volume ?? 0);
          const maxVol = vols.length ? Math.max(...vols) : 1;
          const cap = Math.max(1, maxVol * 1.2);
          const volData = combinedCandles.map((d) => ({
            time: d.time,
            value: Math.min(d.volume ?? 0, cap),
            color: (d.close ?? 0) >= (d.open ?? 0) ? VOL_UP_COLOR : VOL_DOWN_COLOR,
          }));
          lastVolumeDataRef.current = volData;
          if (volumeSeriesRef.current) {
            volumeSeriesRef.current.setData(volData as any);
          }

          // 일목구름 시리즈 업데이트
          if (ichimokuSeriesARef.current && ichimokuSeriesBRef.current && ichimokuDataRef.current) {
            ichimokuSeriesARef.current.setData(ichimokuDataRef.current.spanA as any);
            ichimokuSeriesBRef.current.setData(ichimokuDataRef.current.spanB as any);
          }

          // 화면이 튀는 현상 방지를 위해 가시 영역 재설정 (Shift)
          const N = filteredNew.length;
          chart.timeScale().setVisibleLogicalRange({
            from: newRange.from + N,
            to: newRange.to + N,
          });
        } catch (err) {
          console.error("Failed to load historical klines", err);
        } finally {
          isFetchingHistory = false;
        }
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

    return () => {
      isCancelled = true;
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
      } catch (_) {}
      if (socket) socket.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pingTimer) clearInterval(pingTimer);
      if (priceDirTimeoutRef.current) clearTimeout(priceDirTimeoutRef.current);
      resizeObserver.disconnect();
      if (volumeSeriesRef.current && chartRef.current) {
        try {
          chartRef.current.removeSeries(volumeSeriesRef.current);
        } catch (_) {}
      }
      if (rsiSeriesRef.current && chartRef.current) {
        try {
          chartRef.current.removeSeries(rsiSeriesRef.current);
        } catch (_) {}
      }
      if (rsiMaSeriesRef.current && chartRef.current) {
        try {
          chartRef.current.removeSeries(rsiMaSeriesRef.current);
        } catch (_) {}
      }
      if (ichimokuSeriesARef.current && chartRef.current) {
        try {
          chartRef.current.removeSeries(ichimokuSeriesARef.current);
        } catch (_) {}
      }
      if (ichimokuSeriesBRef.current && chartRef.current) {
        try {
          chartRef.current.removeSeries(ichimokuSeriesBRef.current);
        } catch (_) {}
      }
      setChartInstance(null);
      chart.remove();
    };
  }, [exchange, symbol, interval]);

  // watch showVolume and showRSI to add/remove/recreate series and manage multi-pane layout
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Always clean up existing series first to prevent any moveToPane null errors or incorrect order
    if (volumeSeriesRef.current) {
      try {
        chart.removeSeries(volumeSeriesRef.current);
      } catch (_) {}
      volumeSeriesRef.current = null;
    }
    if (rsiSeriesRef.current) {
      try {
        chart.removeSeries(rsiSeriesRef.current);
      } catch (_) {}
      rsiSeriesRef.current = null;
    }
    if (rsiMaSeriesRef.current) {
      try {
        chart.removeSeries(rsiMaSeriesRef.current);
      } catch (_) {}
      rsiMaSeriesRef.current = null;
    }

    // Determine pane indices dynamically
    let currentPaneIdx = 1;
    const volPaneIdx = showVolume ? currentPaneIdx++ : -1;
    const rsiPaneIdx = showRSI ? currentPaneIdx++ : -1;

    // 1. Create Volume Series if enabled
    if (showVolume) {
      const s = chart.addSeries(HistogramSeries, {
        color: 'rgba(76, 81, 191, 0.7)',
        priceFormat: { type: 'volume' },
      }, volPaneIdx);
      volumeSeriesRef.current = s;
      if (lastVolumeDataRef.current) s.setData(lastVolumeDataRef.current as any);
    }

    // 2. Create RSI Series if enabled
    if (showRSI) {
      const rsiSeries = chart.addSeries(LineSeries, {
        color: '#7E57C2',
        lineWidth: 2,
        title: 'RSI',
      }, rsiPaneIdx);

      rsiSeries.createPriceLine({
        price: 70,
        color: '#787B86',
        lineWidth: 1,
        lineStyle: 1, // Dashed
        axisLabelVisible: true,
      });
      rsiSeries.createPriceLine({
        price: 50,
        color: 'rgba(120, 123, 134, 0.4)',
        lineWidth: 1,
        lineStyle: 1, // Dashed
        axisLabelVisible: true,
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: '#787B86',
        lineWidth: 1,
        lineStyle: 1, // Dashed
        axisLabelVisible: true,
      });

      const rsiMaSeries = chart.addSeries(LineSeries, {
        color: '#E9D5FF',
        lineWidth: 1.5,
        title: 'RSI-based MA',
      }, rsiPaneIdx);

      rsiSeriesRef.current = rsiSeries;
      rsiMaSeriesRef.current = rsiMaSeries;
      updateRsiData();
    }

    // 3. Adjust stretch factors for the panes
    setTimeout(() => {
      try {
        const panes = chart.panes();
        if (panes && panes.length > 0) {
          // Main price pane gets the most height
          panes[0].setStretchFactor(4);
          let currentIdx = 1;
          if (showVolume && panes.length > currentIdx) {
            panes[currentIdx++].setStretchFactor(1.2);
          }
          if (showRSI && panes.length > currentIdx) {
            panes[currentIdx++].setStretchFactor(1.5);
          }
        }
      } catch (e) {
        console.warn("Failed to set stretch factors", e);
      }
    }, 50);

  }, [chartInstance, showVolume, showRSI]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (showIchimoku) {
      if (!ichimokuSeriesARef.current || !ichimokuSeriesBRef.current) {
        const a = chart.addSeries(LineSeries, {
          color: 'rgba(128, 128, 128, 0.5)',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        const b = chart.addSeries(LineSeries, {
          color: 'rgba(128, 128, 128, 0.5)',
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
        ichimokuSeriesARef.current = a;
        ichimokuSeriesBRef.current = b;
      }
      if (ichimokuDataRef.current) {
        ichimokuSeriesARef.current?.setData(ichimokuDataRef.current.spanA as any);
        ichimokuSeriesBRef.current?.setData(ichimokuDataRef.current.spanB as any);
      }
    } else {
      if (ichimokuSeriesARef.current) {
        try {
          chart.removeSeries(ichimokuSeriesARef.current);
        } catch (_) {}
        ichimokuSeriesARef.current = null;
      }
      if (ichimokuSeriesBRef.current) {
        try {
          chart.removeSeries(ichimokuSeriesBRef.current);
        } catch (_) {}
        ichimokuSeriesBRef.current = null;
      }
    }
  }, [chartInstance, showIchimoku]);

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
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${exchange === 'mexc'
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-600 hover:text-zinc-900'
                }`}
            >
              MEXC 선물 (.P)
            </button>
            <button
              onClick={() => handleExchangeChange('binance')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${exchange === 'binance'
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

          <button
            onClick={() => setShowVolume((s) => !s)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${showVolume
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
              }`}
          >
            볼륨
          </button>
          <button
            onClick={() => setShowIchimoku((s) => !s)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${showIchimoku
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
              }`}
          >
            일목 구름
          </button>
          <button
            onClick={() => setShowRSI((s) => !s)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all duration-200 ${showRSI
                ? 'bg-white text-zinc-900 shadow-sm'
                : 'text-zinc-600 hover:text-zinc-900'
              }`}
          >
            RSI
          </button>

          {/* Connection status badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white shadow-sm">
            <span className={`relative flex h-2 w-2`}>
              {wsStatus === 'connected' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              {wsStatus === 'connecting' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${wsStatus === 'connected'
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
            <span className={`text-xl font-bold font-mono transition-all duration-300 ${priceChangeDir === 'up'
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
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${symbol === qs
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

        {/* 최근 시점으로 가기 플로팅 버튼 */}
        {showScrollToLatest && (
          <button
            onClick={handleScrollToLatest}
            className="absolute bottom-6 right-16 z-20 flex items-center justify-center w-8 h-8 rounded-full bg-white/90 backdrop-blur-xs border border-zinc-200 shadow-md text-zinc-600 hover:text-zinc-900 hover:bg-zinc-50 hover:border-zinc-300 transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none"
            title="최근 시점으로 이동"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
              className="w-5 h-5"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.25 4.5l7.5 7.5-7.5 7.5m-6-15l7.5 7.5-7.5 7.5"
              />
            </svg>
          </button>
        )}
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
