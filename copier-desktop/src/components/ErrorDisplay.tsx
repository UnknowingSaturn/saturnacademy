import { AlertCircle, AlertTriangle, Info, Lightbulb } from "lucide-react";
import { parseErrorMessage, MT5ErrorInfo } from "../lib/mt5Errors";

interface ErrorDisplayProps {
  error: string;
  showSuggestion?: boolean;
  compact?: boolean;
}

export default function ErrorDisplay({ 
  error, 
  showSuggestion = true,
  compact = false 
}: ErrorDisplayProps) {
  const errorInfo = parseErrorMessage(error);

  if (!errorInfo) {
    // Generic error display
    return (
      <div className={`flex items-start gap-2 ${compact ? "p-2" : "p-3"} bg-red-500/10 rounded-lg`}>
        <AlertCircle className={`${compact ? "w-3.5 h-3.5" : "w-4 h-4"} text-red-400 mt-0.5 flex-shrink-0`} />
        <span className={`${compact ? "text-xs" : "text-sm"} text-red-400`}>{error}</span>
      </div>
    );
  }

  const SeverityIcon = {
    info: Info,
    warning: AlertTriangle,
    error: AlertCircle,
  }[errorInfo.severity];

  const colorClass = {
    info: "text-blue-400 bg-blue-500/10",
    warning: "text-yellow-400 bg-yellow-500/10",
    error: "text-red-400 bg-red-500/10",
  }[errorInfo.severity];

  const [textColor, bgColor] = colorClass.split(" ");

  if (compact) {
    return (
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${bgColor}`}>
        <SeverityIcon className={`w-3 h-3 ${textColor} flex-shrink-0`} />
        <span className={`text-xs ${textColor} font-medium`}>{errorInfo.shortName}</span>
      </div>
    );
  }

  return (
    <div className={`rounded-lg overflow-hidden ${bgColor}`}>
      {/* Error header */}
      <div className="flex items-start gap-2 p-3">
        <SeverityIcon className={`w-4 h-4 ${textColor} mt-0.5 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${textColor}`}>
              {errorInfo.shortName}
            </span>
            <span className="text-xs text-muted-foreground">
              Code {errorInfo.code}
            </span>
          </div>
          <p className={`text-sm ${textColor} opacity-90 mt-0.5`}>
            {errorInfo.description}
          </p>
        </div>
      </div>

      {/* Suggestion */}
      {showSuggestion && errorInfo.suggestion && (
        <div className="flex items-start gap-2 px-3 pb-3 pt-0">
          <Lightbulb className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
          <span className="text-xs text-muted-foreground">
            {errorInfo.suggestion}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Inline error badge for tables/lists
 */
export function ErrorBadge({ error }: { error: string }) {
  const errorInfo = parseErrorMessage(error);
  
  const severity = errorInfo?.severity || "error";
  const label = errorInfo?.shortName || "Error";
  
  const colorClass = {
    info: "bg-blue-500/15 text-blue-400",
    warning: "bg-yellow-500/15 text-yellow-400",
    error: "bg-red-500/15 text-red-400",
  }[severity];

  return (
    <span 
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${colorClass}`}
      title={error}
    >
      {label}
    </span>
  );
}
