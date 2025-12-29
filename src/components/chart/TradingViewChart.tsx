import { useEffect, useRef, memo } from "react";
import { Trade } from "@/types/trading";
import { mapToTradingViewSymbol } from "@/lib/symbolMapping";
import { cn } from "@/lib/utils";

interface TradingViewChartProps {
  trade: Trade;
  className?: string;
}

declare global {
  interface Window {
    TradingView: any;
  }
}

function TradingViewChartComponent({ trade, className }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);

  const tradingViewSymbol = mapToTradingViewSymbol(trade.symbol);

  useEffect(() => {
    if (!containerRef.current || !tradingViewSymbol) return;

    // Load TradingView library script if not already loaded
    const scriptId = "tradingview-widget-script";
    let script = document.getElementById(scriptId) as HTMLScriptElement;

    const initWidget = () => {
      if (!containerRef.current || !window.TradingView) return;

      // Clear previous widget
      containerRef.current.innerHTML = "";

      widgetRef.current = new window.TradingView.widget({
        symbol: tradingViewSymbol,
        interval: "15",
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1", // Candlestick
        locale: "en",
        toolbar_bg: "rgba(0, 0, 0, 0)",
        enable_publishing: false,
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
        container_id: containerRef.current.id,
        width: "100%",
        height: "100%",
        hide_volume: true,
        studies: [],
        disabled_features: [
          "header_symbol_search",
          "symbol_search_hot_key",
          "header_compare",
          "header_screenshot",
          "use_localstorage_for_settings",
        ],
        enabled_features: [
          "hide_left_toolbar_by_default",
        ],
        overrides: {
          "mainSeriesProperties.candleStyle.upColor": "#22c55e",
          "mainSeriesProperties.candleStyle.downColor": "#ef4444",
          "mainSeriesProperties.candleStyle.borderUpColor": "#22c55e",
          "mainSeriesProperties.candleStyle.borderDownColor": "#ef4444",
          "mainSeriesProperties.candleStyle.wickUpColor": "#22c55e",
          "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444",
          "paneProperties.background": "#0a0a0a",
          "paneProperties.backgroundType": "solid",
        },
      });
    };

    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    } else if (window.TradingView) {
      initWidget();
    } else {
      script.addEventListener("load", initWidget);
    }

    return () => {
      if (widgetRef.current) {
        widgetRef.current = null;
      }
    };
  }, [tradingViewSymbol, trade.id]);

  if (!tradingViewSymbol) {
    return (
      <div className={cn("flex items-center justify-center h-[500px] bg-muted/20 rounded-lg", className)}>
        <p className="text-muted-foreground text-sm">
          Symbol "{trade.symbol}" is not supported by TradingView
        </p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between mb-2 px-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{trade.symbol}</span>
          <span className="text-xs text-muted-foreground">• TradingView</span>
          <span
            className={cn(
              "text-xs font-bold uppercase px-1.5 py-0.5 rounded",
              trade.direction === "buy" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"
            )}
          >
            {trade.direction}
          </span>
        </div>
      </div>
      <div
        id={`tradingview-widget-${trade.id}`}
        ref={containerRef}
        className="w-full h-[500px] rounded-lg overflow-hidden"
      />
      
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

export const TradingViewChart = memo(TradingViewChartComponent);
