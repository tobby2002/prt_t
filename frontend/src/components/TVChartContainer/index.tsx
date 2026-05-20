'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CandlestickData,
  CandlestickSeries,
  createChart,
  ISeriesApi,
  UTCTimestamp,
} from 'lightweight-charts';
import styles from './index.module.css';

const BINANCE_SYMBOL = 'BTCUSDT';
const SYMBOL_LABEL = 'BTCUSDT';
const INTERVAL = '1m';
const KLINES_LIMIT = 200;
const BINANCE_API_BASE = 'https://api.binance.com';
const BINANCE_WS_URL = `wss://stream.binance.com:9443/ws/${BINANCE_SYMBOL.toLowerCase()}@kline_${INTERVAL}`;

const parseKlines = (payload: any): CandlestickData[] => {
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#ffffff' },
        textColor: '#0f172a',
      },
      grid: {
        vertLines: { color: '#e2e8f0' },
        horzLines: { color: '#e2e8f0' },
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
      upColor: '#16a34a',
      downColor: '#dc2626',
      borderVisible: false,
      wickUpColor: '#16a34a',
      wickDownColor: '#dc2626',
    });

    candleSeriesRef.current = candleSeries;

    const resizeObserver = new ResizeObserver(() => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    // WebSocket 연결은 현재 비활성화합니다.
    // let socket: WebSocket | null = null;
    // let reconnectTimer: number | null = null;
    // let reconnectAttempts = 0;

    // const scheduleReconnect = () => {
    //   reconnectAttempts += 1;
    //   const delay = Math.min(60000, 1000 * 2 ** (reconnectAttempts - 1));
    //   console.warn(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    //   reconnectTimer = window.setTimeout(() => {
    //     connectSocket();
    //   }, delay);
    // };

    // const processKlineMessage = (message: any) => {
    //   const kline = message.k ?? message.data?.k;
    //   if (!kline || !candleSeriesRef.current) return;

    //   const candle: CandlestickData = {
    //     time: (kline.t / 1000) as UTCTimestamp,
    //     open: parseFloat(kline.o),
    //     high: parseFloat(kline.h),
    //     low: parseFloat(kline.l),
    //     close: parseFloat(kline.c),
    //   };

    //   candleSeriesRef.current.update(candle);
    // };

    // const connectSocket = () => {
    //   if (socket) {
    //     socket.close();
    //   }

    //   socket = new WebSocket(BINANCE_WS_URL);

    //   socket.onopen = () => {
    //     console.log('Binance WebSocket opened', BINANCE_WS_URL);
    //     reconnectAttempts = 0;
    //     setError(null);
    //   };

    //   socket.onmessage = (event) => {
    //     try {
    //       const payload = JSON.parse(event.data);
    //       processKlineMessage(payload);
    //     } catch (parseError) {
    //       console.warn('WebSocket parse error', parseError);
    //     }
    //   };

    //   socket.onerror = (event) => {
    //     console.error('Binance WebSocket error', event, { readyState: socket?.readyState });
    //     setError(
    //       `Binance WebSocket error. 상태 ${socket?.readyState ?? 'unknown'}. 콘솔에서 추가 정보를 확인하세요.`
    //     );
    //   };

    //   socket.onclose = (event) => {
    //     console.warn('Binance WebSocket closed', event.code, event.reason);
    //     if (event.code === 1000) {
    //       return;
    //     }

    //     switch (event.code) {
    //       case 1001:
    //       case 1006:
    //       case 1011:
    //         setError(`Binance WebSocket disconnected (${event.code}). 자동 재연결 중입니다.`);
    //         scheduleReconnect();
    //         break;
    //       case 1008:
    //         setError('Binance WebSocket policy violation. rate limit 또는 형식을 확인하세요.');
    //         break;
    //       default:
    //         setError(`Binance WebSocket closed with code ${event.code}. 재연결 시도 중입니다.`);
    //         scheduleReconnect();
    //     }
    //   };
    // };

    const loadCandles = async () => {
      try {
        const response = await fetch(
          `${BINANCE_API_BASE}/fapi/v1/klines?symbol=${BINANCE_SYMBOL}&interval=${INTERVAL}&limit=${KLINES_LIMIT}`
        );
        if (!response.ok) {
          throw new Error(`Binance REST error: ${response.status}`);
        }

        const payload = await response.json();
        const candles = parseKlines(payload);
        candleSeries.setData(candles);
        chart.timeScale().fitContent();
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : '차트 데이터를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    };

    // WebSocket 연결은 주석 처리했습니다.
    loadCandles();

    return () => {
      // if (socket) {
      //   socket.close();
      // }
      // if (reconnectTimer !== null) {
      //   clearTimeout(reconnectTimer);
      // }
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  return (
    <>
      <header className={styles.VersionHeader}>
        <h1>{SYMBOL_LABEL} 실시간 차트</h1>
      </header>
      <div className={styles.ChartInfo}>
        <p>Binance 현물 BTCUSDT 1분봉 차트 (lightweight-charts)</p>
      </div>
      {error && <div className={styles.ErrorBox}>{error}</div>}
      <div ref={chartContainerRef} className={styles.TVChartContainer} />
      {loading && <div className={styles.LoadingOverlay}>차트를 로딩 중입니다...</div>}
    </>
  );
};
