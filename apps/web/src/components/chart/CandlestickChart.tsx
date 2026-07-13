'use client';
import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  IChartApi,
  ISeriesApi,
  ColorType,
  CrosshairMode,
  createSeriesMarkers,
  LineStyle,
} from 'lightweight-charts';
import type { DrawingTool } from './DrawingToolbar';

export interface OHLCBar {
  time:   number | string;
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

export interface ChartMarker {
  time:     number | string;
  position: 'aboveBar' | 'belowBar';
  color:    string;
  shape:    'arrowUp' | 'arrowDown' | 'circle';
  text:     string;
}

export interface Drawing {
  id:    string;
  type:  DrawingTool;
  color: string;
  // hline
  price?: number;
  // trendline / rect: two points
  p1?: { time: number; price: number };
  p2?: { time: number; price: number };
}

export interface IndicatorSeries {
  ema20?:  { time: number; value: number }[];
  ema50?:  { time: number; value: number }[];
  bbUpper?: { time: number; value: number }[];
  bbLower?: { time: number; value: number }[];
  rsi?:    { time: number; value: number }[];
}

export interface PriceLevel {
  price: number;
  color: string;
  label: string;
  style?: 'solid' | 'dashed';
}

interface Props {
  data:         OHLCBar[];
  markers?:     ChartMarker[];
  height?:      number;
  showVolume?:  boolean;
  activeTool?:  DrawingTool;
  drawings?:    Drawing[];
  onDrawingsChange?: (d: Drawing[]) => void;
  indicators?:  IndicatorSeries;
  levels?:      PriceLevel[];
  showRsi?:     boolean;
}

const DRAWING_COLORS: Record<DrawingTool, string> = {
  pointer:   '#ffffff',
  hline:     '#facc15',
  trendline: '#60a5fa',
  rect:      '#a78bfa',
};

export function CandlestickChart({
  data,
  markers       = [],
  height        = 420,
  showVolume    = true,
  activeTool    = 'pointer',
  drawings      = [],
  onDrawingsChange,
  indicators    = {},
  levels        = [],
  showRsi       = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const rsiChartRef  = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
  // Map drawing id → series references for cleanup
  const drawingSeriesRef = useRef<Map<string, ISeriesApi<any>[]>>(new Map());
  // Pending first click for two-point tools
  const pendingRef = useRef<{ time: number; price: number } | null>(null);

  // ── Render all drawings on chart ──────────────────────────────────────────
  const renderDrawings = useCallback((chart: IChartApi, ds: Drawing[]) => {
    // Remove old series
    drawingSeriesRef.current.forEach(series => series.forEach(s => { try { chart.removeSeries(s); } catch {} }));
    drawingSeriesRef.current.clear();

    ds.forEach(d => {
      const series: ISeriesApi<any>[] = [];

      if (d.type === 'hline' && d.price !== undefined) {
        const s = chart.addSeries(LineSeries, {
          color: d.color,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        const tStart = data[0]?.time as number;
        const tEnd   = data[data.length - 1]?.time as number;
        s.setData([{ time: tStart as any, value: d.price }, { time: tEnd as any, value: d.price }]);
        series.push(s);
      }

      if (d.type === 'trendline' && d.p1 && d.p2) {
        const s = chart.addSeries(LineSeries, {
          color: d.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
        s.setData([
          { time: d.p1.time as any, value: d.p1.price },
          { time: d.p2.time as any, value: d.p2.price },
        ]);
        series.push(s);
      }

      if (d.type === 'rect' && d.p1 && d.p2) {
        const tMin = Math.min(d.p1.time, d.p2.time);
        const tMax = Math.max(d.p1.time, d.p2.time);
        const pMin = Math.min(d.p1.price, d.p2.price);
        const pMax = Math.max(d.p1.price, d.p2.price);
        // Top border
        const sTop = chart.addSeries(LineSeries, {
          color: d.color, lineWidth: 1, lineStyle: LineStyle.Solid,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        sTop.setData([{ time: tMin as any, value: pMax }, { time: tMax as any, value: pMax }]);
        // Bottom border
        const sBot = chart.addSeries(LineSeries, {
          color: d.color, lineWidth: 1, lineStyle: LineStyle.Solid,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        sBot.setData([{ time: tMin as any, value: pMin }, { time: tMax as any, value: pMin }]);
        series.push(sTop, sBot);
      }

      if (series.length > 0) drawingSeriesRef.current.set(d.id, series);
    });
  }, [data]);

  // ── Chart init ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#111827' },
        textColor:  '#9ca3af',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#374151' },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
        secondsVisible: false,
      },
      width:  containerRef.current.clientWidth,
      height,
    });
    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#34d399', downColor: '#f87171',
      borderUpColor: '#34d399', borderDownColor: '#f87171',
      wickUpColor: '#34d399', wickDownColor: '#f87171',
    });
    // Trier par time croissant et supprimer les doublons (yfinance/TwelveData peuvent en produire)
    const seen = new Set<number>();
    const cleanData = [...data]
      .sort((a, b) => (a.time as number) - (b.time as number))
      .filter(b => { const t = b.time as number; if (seen.has(t)) return false; seen.add(t); return true; });
    candleSeries.setData(cleanData.map(b => ({
      time: b.time as any, open: b.open, high: b.high, low: b.low, close: b.close,
    })));
    candleRef.current = candleSeries;

    if (markers.length > 0) createSeriesMarkers(candleSeries, markers as any);

    if (showVolume) {
      const volSeries = chart.addSeries(HistogramSeries, {
        color: '#6b7280', priceFormat: { type: 'volume' }, priceScaleId: 'vol',
      });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volSeries.setData(cleanData.map(b => ({
        time: b.time as any, value: b.volume,
        color: b.close >= b.open ? '#34d39940' : '#f8717140',
      })));
    }

    // ── Indicateurs overlay ──────────────────────────────────────
    if (indicators.ema20 && indicators.ema20.length > 0) {
      const s = chart.addSeries(LineSeries, {
        color: '#f59e0b', lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(indicators.ema20 as any);
    }
    if (indicators.ema50 && indicators.ema50.length > 0) {
      const s = chart.addSeries(LineSeries, {
        color: '#818cf8', lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(indicators.ema50 as any);
    }
    if (indicators.bbUpper && indicators.bbUpper.length > 0) {
      const sUp = chart.addSeries(LineSeries, {
        color: '#6b7280', lineWidth: 1, lineStyle: LineStyle.Dashed,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      sUp.setData(indicators.bbUpper as any);
    }
    if (indicators.bbLower && indicators.bbLower.length > 0) {
      const sDn = chart.addSeries(LineSeries, {
        color: '#6b7280', lineWidth: 1, lineStyle: LineStyle.Dashed,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      sDn.setData(indicators.bbLower as any);
    }

    // ── Niveaux Entry / SL / TP ─────────────────────────────────
    levels.forEach(lv => {
      candleSeries.createPriceLine({
        price:          lv.price,
        color:          lv.color,
        lineWidth:      1,
        lineStyle:      lv.style === 'dashed' ? LineStyle.Dashed : LineStyle.Solid,
        axisLabelVisible: true,
        title:          lv.label,
      });
    });

    chart.timeScale().fitContent();
    renderDrawings(chart, drawings);

    // ── RSI chart ────────────────────────────────────────────────
    if (showRsi && indicators.rsi && indicators.rsi.length > 0 && rsiContainerRef.current) {
      const rsiChart = createChart(rsiContainerRef.current, {
        layout: { background: { type: ColorType.Solid, color: '#111827' }, textColor: '#9ca3af' },
        grid:   { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
        crosshair: { mode: CrosshairMode.Normal },
        rightPriceScale: { borderColor: '#374151', scaleMargins: { top: 0.1, bottom: 0.1 } },
        timeScale: { borderColor: '#374151', timeVisible: true, secondsVisible: false },
        width:  rsiContainerRef.current.clientWidth,
        height: 100,
      });
      rsiChartRef.current = rsiChart;

      const rsiSeries = rsiChart.addSeries(LineSeries, {
        color: '#a78bfa', lineWidth: 1,
        priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
      });
      rsiSeries.setData(indicators.rsi as any);
      // Lignes 30/70
      rsiSeries.createPriceLine({ price: 70, color: '#f8717160', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '70' });
      rsiSeries.createPriceLine({ price: 30, color: '#34d39960', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '30' });
      rsiSeries.createPriceLine({ price: 50, color: '#6b728060', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });

      // Synchroniser les timescales
      chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) chart.timeScale().setVisibleLogicalRange(range);
      });
      rsiChart.timeScale().fitContent();
    }

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
      if (rsiContainerRef.current && rsiChartRef.current)
        rsiChartRef.current.applyOptions({ width: rsiContainerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, markers, height, showVolume, indicators, levels, showRsi]);

  // Re-render drawings when they change
  useEffect(() => {
    if (chartRef.current) renderDrawings(chartRef.current, drawings);
  }, [drawings, renderDrawings]);

  // ── Click handler for drawing tools ──────────────────────────────────────
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool === 'pointer' || !chartRef.current || !containerRef.current) return;
    const chart = chartRef.current;

    const rect  = containerRef.current.getBoundingClientRect();
    const x     = e.clientX - rect.left;
    const y     = e.clientY - rect.top;
    const price = candleRef.current?.coordinateToPrice(y) ?? 0;
    const time  = chart.timeScale().coordinateToTime(x) as number | null;
    if (!time || !price) return;

    const color = DRAWING_COLORS[activeTool];
    const id    = `${activeTool}-${Date.now()}`;

    if (activeTool === 'hline') {
      const newDrawing: Drawing = { id, type: 'hline', color, price };
      onDrawingsChange?.([...drawings, newDrawing]);
      return;
    }

    // Two-point tools (trendline, rect)
    if (!pendingRef.current) {
      pendingRef.current = { time: time as number, price };
    } else {
      const p1 = pendingRef.current;
      pendingRef.current = null;
      const newDrawing: Drawing = {
        id, type: activeTool, color,
        p1: { time: p1.time, price: p1.price },
        p2: { time: time as number, price },
      };
      onDrawingsChange?.([...drawings, newDrawing]);
    }
  }, [activeTool, drawings, onDrawingsChange]);

  const cursorClass =
    activeTool === 'pointer'   ? 'cursor-default' :
    activeTool === 'hline'     ? 'cursor-crosshair' :
    activeTool === 'trendline' ? 'cursor-crosshair' :
    'cursor-crosshair';

  const hasRsi = showRsi && (indicators.rsi?.length ?? 0) > 0;

  return (
    <>
      <div className="relative">
        {activeTool !== 'pointer' && pendingRef.current && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 text-xs text-yellow-400 bg-gray-900/80 border border-yellow-400/30 px-3 py-1 rounded-full pointer-events-none">
            Cliquez sur le deuxième point…
          </div>
        )}
        <div
          ref={containerRef}
          style={{ width: '100%', height }}
          className={cursorClass}
          onClick={handleClick}
        />
      </div>
      {hasRsi && (
        <div className="border-t border-gray-800">
          <div className="flex items-center gap-2 px-3 pt-1 pb-0">
            <span className="text-[10px] font-medium text-violet-400">RSI(14)</span>
          </div>
          <div ref={rsiContainerRef} style={{ width: '100%', height: 100 }} />
        </div>
      )}
    </>
  );
}
