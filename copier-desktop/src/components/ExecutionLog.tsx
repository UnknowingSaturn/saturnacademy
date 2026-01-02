import {
  ArrowDown,
  ArrowUp,
  CheckCircle,
  Clock,
} from "lucide-react";
import { Execution } from "../types";
import ErrorDisplay, { ErrorBadge } from "./ErrorDisplay";

interface ExecutionLogProps {
  executions: Execution[];
}

export default function ExecutionLog({ executions }: ExecutionLogProps) {
  if (executions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <Clock className="w-10 h-10 mb-3 opacity-50" />
        <p className="text-sm">No executions yet</p>
        <p className="text-xs mt-1">Trades will appear here when copied</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full">
      {executions.map((execution) => (
        <ExecutionItem key={execution.id} execution={execution} />
      ))}
    </div>
  );
}

function ExecutionItem({ execution }: { execution: Execution }) {
  const isSuccess = execution.status === "success";
  const isBuy = execution.direction.toLowerCase() === "buy";

  return (
    <div className="border-b border-border px-4 py-3 hover:bg-secondary/30 transition-colors">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {/* Direction indicator */}
          <div
            className={`p-1 rounded ${
              isBuy ? "bg-green-500/20" : "bg-red-500/20"
            }`}
          >
            {isBuy ? (
              <ArrowUp className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <ArrowDown className="w-3.5 h-3.5 text-red-500" />
            )}
          </div>

          {/* Symbol and type */}
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-sm">{execution.symbol}</span>
              <span className="text-xs text-muted-foreground uppercase">
                {execution.event_type}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {execution.receiver_account}
            </div>
          </div>
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-1">
          {isSuccess ? (
            <CheckCircle className="w-4 h-4 text-green-500" />
          ) : (
            <ErrorBadge error={execution.error_message || "Failed"} />
          )}
        </div>
      </div>

      {/* Execution details */}
      <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
        <div>
          <span className="text-muted-foreground">Master</span>
          <div className="font-medium">{execution.master_lots} lots</div>
        </div>
        <div>
          <span className="text-muted-foreground">Receiver</span>
          <div className="font-medium">{execution.receiver_lots} lots</div>
        </div>
        <div>
          <span className="text-muted-foreground">Slippage</span>
          <div
            className={`font-medium ${
              execution.slippage_pips && execution.slippage_pips > 1
                ? "text-yellow-500"
                : ""
            }`}
          >
            {execution.slippage_pips?.toFixed(1) ?? "-"} pips
          </div>
        </div>
      </div>

      {/* Error message if failed */}
      {execution.error_message && (
        <div className="mt-2">
          <ErrorDisplay error={execution.error_message} showSuggestion={false} compact />
        </div>
      )}

      {/* Timestamp */}
      <div className="text-[10px] text-muted-foreground mt-2">
        {formatTimestamp(execution.timestamp)}
      </div>
    </div>
  );
}

function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
