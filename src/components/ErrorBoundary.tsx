import * as React from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface State {
  error: Error | null;
}

interface Props {
  children: React.ReactNode;
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Surface in console; production telemetry hook can be added later.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);

    return (
      <div className="min-h-[50vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-lg border border-destructive/30 bg-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-5 h-5" />
            <h2 className="font-semibold">Something went wrong</h2>
          </div>
          <p className="text-sm text-muted-foreground break-words">
            {this.state.error.message || "An unexpected error occurred."}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={this.reset}>Try again</Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
