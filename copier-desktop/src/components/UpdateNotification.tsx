import { useState, useEffect } from "react";
import { installUpdate } from "@tauri-apps/api/updater";
import { relaunch } from "@tauri-apps/api/process";
import { Download, X, Loader2 } from "lucide-react";

interface UpdateNotificationProps {
  version: string;
  onDismiss: () => void;
}

export default function UpdateNotification({ version, onDismiss }: UpdateNotificationProps) {
  const [installing, setInstalling] = useState(false);
  const [visible, setVisible] = useState(true);

  // Auto-dismiss after 15 seconds
  useEffect(() => {
    const timeout = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // Wait for animation
    }, 15000);
    return () => clearTimeout(timeout);
  }, [onDismiss]);

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await installUpdate();
      await relaunch();
    } catch (e) {
      console.error("Failed to install update:", e);
      setInstalling(false);
    }
  };

  const handleDismiss = () => {
    setVisible(false);
    setTimeout(onDismiss, 300);
  };

  return (
    <div
      className={`fixed bottom-4 right-4 bg-card border border-border rounded-lg shadow-lg p-4 max-w-sm transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
          <Download className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium">Update Available</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            Version {version} is ready to install
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleInstall}
              disabled={installing}
              className="flex-1 flex items-center justify-center gap-1.5 bg-primary text-primary-foreground rounded-md py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {installing ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Installing...
                </>
              ) : (
                <>
                  <Download className="w-3 h-3" />
                  Install Now
                </>
              )}
            </button>
            <button
              onClick={handleDismiss}
              disabled={installing}
              className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary rounded-md transition-colors"
            >
              Later
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          disabled={installing}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
