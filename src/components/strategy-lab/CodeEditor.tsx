import * as React from "react";
import { useState } from "react";
import { Copy, Download, Check, FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CodeEditorProps {
  code: string;
  filename?: string;
  onCodeChange?: (code: string) => void;
  readOnly?: boolean;
}

export function CodeEditor({ code, filename = "Strategy.mq5", onCodeChange, readOnly = true }: CodeEditorProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const lines = code.split("\n");

  return (
    <div className="flex flex-col h-full rounded-lg border border-border overflow-hidden bg-muted/30">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted">
        <div className="flex items-center gap-2">
          <FileCode className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-mono text-muted-foreground">{filename}</span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Code area */}
      <div className="flex-1 overflow-auto">
        {code ? (
          <div className="flex text-sm font-mono leading-6">
            {/* Line numbers */}
            <div className="sticky left-0 select-none text-right pr-4 pl-3 py-3 text-muted-foreground/50 bg-muted/50 border-r border-border">
              {lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            {/* Code content */}
            <pre className="flex-1 py-3 px-4 overflow-x-auto">
              <code className="text-foreground">{code}</code>
            </pre>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center space-y-2">
              <FileCode className="h-12 w-12 mx-auto opacity-20" />
              <p className="text-sm">No code generated yet</p>
              <p className="text-xs">Describe your EA in the chat to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
