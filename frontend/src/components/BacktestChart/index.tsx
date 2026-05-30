'use client';

import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, HistogramSeries, createSeriesMarkers, SeriesMarker } from 'lightweight-charts';
import type { TradeRow } from '@/lib/api';

type BacktestChartProps = {
  ohlcv: {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
  trades: TradeRow[];
};

export const BacktestChart = ({ ohlcv, trades }: BacktestChartProps) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || ohlcv.length === 0) return;

    const container = chartContainerRef.current;

    // Create chart
    const chart = createChart(container, {
      width: container.clientWidth || 800,
      height: 450,
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
      },
    });

    // Add Candlestick Series (Pane 0)
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#ef4444',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    }, 0);

    const formattedCandles = ohlcv.map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleSeries.setData(formattedCandles);

    // Add Volume Series (Pane 1)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: 'rgba(76, 81, 191, 0.6)',
      priceFormat: { type: 'volume' },
    }, 1);

    const formattedVolume = ohlcv.map((c) => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? '#10b981' : '#ef4444',
    }));

    volumeSeries.setData(formattedVolume);

    // Add Trade Markers on Candlestick Series
    const markers: SeriesMarker<string>[] = [];

    trades.forEach((trade) => {
      const openDate = trade.dt_open.slice(0, 10);
      const closeDate = trade.dt_close.slice(0, 10);

      // Buy marker at entry
      markers.push({
        time: openDate,
        position: 'belowBar',
        color: '#10b981',
        shape: 'arrowUp',
        text: `BUY (Ref:${trade.ref})`,
      });

      // Sell marker at exit
      markers.push({
        time: closeDate,
        position: 'aboveBar',
        color: '#ef4444',
        shape: 'arrowDown',
        text: `SELL (PnL:${trade.pnl_net >= 0 ? '+' : ''}${Math.round(trade.pnl_net)})`,
      });
    });

    // Sort markers chronologically to avoid lightweight-charts rendering issues
    markers.sort((a, b) => {
      const timeA = typeof a.time === 'string' ? a.time : '';
      const timeB = typeof b.time === 'string' ? b.time : '';
      return timeA.localeCompare(timeB);
    });

    createSeriesMarkers(candleSeries, markers);

    // Adjust pane ratios (Candles 4 : Volume 1)
    setTimeout(() => {
      try {
        const panes = chart.panes();
        if (panes && panes.length > 1) {
          panes[0].setStretchFactor(4);
          panes[1].setStretchFactor(1.2);
        }
      } catch (e) {
        console.warn("Failed to set backtest chart stretch factors", e);
      }
    }, 50);

    // Fit content
    chart.timeScale().fitContent();

    // Handle resizing
    const resizeObserver = new ResizeObserver(() => {
      if (container) {
        const width = container.clientWidth;
        const height = container.clientHeight || 450;
        if (width > 0) {
          chart.applyOptions({ width, height });
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [ohlcv, trades]);

  return (
    <div className="relative w-full h-[450px] bg-white rounded-xl border border-zinc-200 overflow-hidden shadow-inner p-2">
      <div ref={chartContainerRef} className="w-full h-full" />
    </div>
  );
};
