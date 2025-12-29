import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, IChartApi, ISeriesApi, CandlestickData, LineStyle, Time, CandlestickSeries, LineSeries } from "lightweight-charts";
import { Trade } from "@/types/trading";
import { cn } from "@/lib/utils";
import { ReplayControls } from "./ReplayControls";

interface TradeChartProps {
  trade: Trade;
  className?: string;
}

// Generate mock OHLC data around trade entry/exit times
function generateMockOHLC(trade: Trade): CandlestickData[] {
  const entryTime = new Date(trade.entry_time).getTime();
  const exitTime = trade.exit_time ? new Date(trade.exit_time).getTime() : entryTime + 3600000;
  const entryPrice = trade.entry_price;
  
  // Generate 50 candles before entry and 50 after
  const candleInterval = 15 * 60 * 1000; // 15 minute candles
  const candles: CandlestickData[] = [];
  
  const startTime = entryTime - 50 * candleInterval;
  const endTime = Math.max(exitTime + 20 * candleInterval, entryTime + 70 * candleInterval);
  
  let basePrice = entryPrice * (0.995 + Math.random() * 0.01);
  const volatility = entryPrice * 0.001;
  
  for (let t = startTime; t <= endTime; t += candleInterval) {
    const change = (Math.random() - 0.5) * volatility;
    const open = basePrice;
    const close = basePrice + change;
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low = Math.min(open, close) - Math.random() * volatility * 0.5;
    
    candles.push({
      time: (t / 1000) as Time,
      open,
      high,
      low,
      close,
    });
    
    basePrice = close;
    
    // Bias price towards trade direction near entry
    if (t >= entryTime - candleInterval && t <= entryTime + candleInterval) {
      basePrice = entryPrice;
    }
    
    // Bias towards exit price near exit
    if (trade.exit_price && t >= exitTime - candleInterval * 3 && t <= exitTime) {
      const progress = (t - (exitTime - candleInterval * 3)) / (candleInterval * 3);
      basePrice = entryPrice + (trade.exit_price - entryPrice) * progress;
    }
  }
  
  return candles;
}

export function TradeChart({ trade, className }: TradeChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentCandle, setCurrentCandle] = useState(0);
  const [allCandles, setAllCandles] = useState<CandlestickData[]>([]);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "hsl(0 0% 55%)",
      },
      grid: {
        vertLines: { color: "hsl(0 0% 12%)" },
        horzLines: { color: "hsl(0 0% 12%)" },
      },
      crosshair: {
        vertLine: { color: "hsl(217 100% 60%)", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "hsl(217 100% 60%)", width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: "hsl(0 0% 12%)",
      },
      timeScale: {
        borderColor: "hsl(0 0% 12%)",
        timeVisible: true,
      },
      handleScroll: true,
      handleScale: true,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "hsl(152 95% 45%)",
      downColor: "hsl(0 85% 58%)",
      borderUpColor: "hsl(152 95% 45%)",
      borderDownColor: "hsl(0 85% 58%)",
      wickUpColor: "hsl(152 95% 45%)",
      wickDownColor: "hsl(0 85% 58%)",
    });

    // Generate and set mock data
    const candles = generateMockOHLC(trade);
    setAllCandles(candles);
    setCurrentCandle(candles.length);
    candlestickSeries.setData(candles);

    // Add entry marker
    const entryTimestamp = new Date(trade.entry_time).getTime() / 1000;
    
    // Add SL line if exists
    if (trade.sl_initial) {
      const slLine = chart.addSeries(LineSeries, {
        color: "rgba(239, 68, 68, 0.6)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      slLine.setData([
        { time: (entryTimestamp - 3600) as Time, value: trade.sl_initial },
        { time: (entryTimestamp + 7200) as Time, value: trade.sl_initial },
      ]);
    }

    // Add TP line if exists
    if (trade.tp_initial) {
      const tpLine = chart.addSeries(LineSeries, {
        color: "rgba(34, 197, 94, 0.6)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      tpLine.setData([
        { time: (entryTimestamp - 3600) as Time, value: trade.tp_initial },
        { time: (entryTimestamp + 7200) as Time, value: trade.tp_initial },
      ]);
    }

    // Add entry price line
    const entryLine = chart.addSeries(LineSeries, {
      color: "hsl(45 95% 55%)",
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    entryLine.setData([
      { time: (entryTimestamp - 1800) as Time, value: trade.entry_price },
      { time: (entryTimestamp + 1800) as Time, value: trade.entry_price },
    ]);

    // Fit content
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [trade]);

  // Replay functionality
  useEffect(() => {
    if (!isPlaying || !seriesRef.current) return;

    const interval = setInterval(() => {
      setCurrentCandle((prev) => {
        if (prev >= allCandles.length) {
          setIsPlaying(false);
          return prev;
        }
        seriesRef.current?.setData(allCandles.slice(0, prev + 1));
        return prev + 1;
      });
    }, 500 / speed);

    return () => clearInterval(interval);
  }, [isPlaying, allCandles, speed]);

  const handleReplay = useCallback(() => {
    setCurrentCandle(10);
    seriesRef.current?.setData(allCandles.slice(0, 10));
    setIsPlaying(true);
  }, [allCandles]);

  const handleStepForward = useCallback(() => {
    if (currentCandle < allCandles.length) {
      const next = currentCandle + 1;
      setCurrentCandle(next);
      seriesRef.current?.setData(allCandles.slice(0, next));
    }
  }, [currentCandle, allCandles]);

  const handleStepBackward = useCallback(() => {
    if (currentCandle > 1) {
      const prev = currentCandle - 1;
      setCurrentCandle(prev);
      seriesRef.current?.setData(allCandles.slice(0, prev));
    }
  }, [currentCandle, allCandles]);

  const handleJumpToEntry = useCallback(() => {
    const entryTime = new Date(trade.entry_time).getTime() / 1000;
    const entryIndex = allCandles.findIndex((c) => (c.time as number) >= entryTime);
    if (entryIndex > 0) {
      setCurrentCandle(entryIndex + 5);
      seriesRef.current?.setData(allCandles.slice(0, entryIndex + 5));
    }
  }, [trade, allCandles]);

  const handleReset = useCallback(() => {
    setCurrentCandle(allCandles.length);
    seriesRef.current?.setData(allCandles);
    setIsPlaying(false);
    chartRef.current?.timeScale().fitContent();
  }, [allCandles]);

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="flex items-center justify-between mb-2 px-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{trade.symbol}</span>
          <span className="text-xs text-muted-foreground">• M15</span>
          <span
            className={cn(
              "text-xs font-bold uppercase px-1.5 py-0.5 rounded",
              trade.direction === "buy" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"
            )}
          >
            {trade.direction}
          </span>
        </div>
        <ReplayControls
          isPlaying={isPlaying}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onReplay={handleReplay}
          onStepForward={handleStepForward}
          onStepBackward={handleStepBackward}
          onJumpToEntry={handleJumpToEntry}
          onReset={handleReset}
          speed={speed}
          onSpeedChange={setSpeed}
        />
      </div>
      <div ref={containerRef} className="w-full flex-1 min-h-[300px] rounded-lg overflow-hidden bg-background/50" />
      
      {/* Trade info overlay */}
      <div className="flex items-center justify-between mt-3 px-2 text-sm">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-muted-foreground">Entry: </span>
            <span className="font-mono-numbers text-[hsl(45_95%_55%)]">{trade.entry_price}</span>
          </div>
          {trade.sl_initial && (
            <div>
              <span className="text-muted-foreground">SL: </span>
              <span className="font-mono-numbers text-loss">{trade.sl_initial}</span>
            </div>
          )}
          {trade.tp_initial && (
            <div>
              <span className="text-muted-foreground">TP: </span>
              <span className="font-mono-numbers text-profit">{trade.tp_initial}</span>
            </div>
          )}
        </div>
        {trade.r_multiple_actual !== null && (
          <div
            className={cn(
              "font-mono-numbers font-bold px-2 py-1 rounded",
              trade.r_multiple_actual >= 0 ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"
            )}
          >
            {trade.r_multiple_actual >= 0 ? "+" : ""}
            {trade.r_multiple_actual.toFixed(2)}R
          </div>
        )}
      </div>
    </div>
  );
}
