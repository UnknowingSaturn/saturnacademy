import { useNavigate } from "react-router-dom";
import { Wallet, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface NoAccountsEmptyStateProps {
  onAction?: () => void;
  title?: string;
  description?: string;
}

export function NoAccountsEmptyState({
  onAction,
  title = "Create an account first",
  description = "You need at least one trading account before you can log a trade.",
}: NoAccountsEmptyStateProps) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center space-y-4">
      <div className="rounded-full bg-muted p-4">
        <Wallet className="h-8 w-8 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-xs">{description}</p>
      </div>
      <Button
        onClick={() => {
          onAction?.();
          navigate("/accounts");
        }}
        className="gap-2"
      >
        <Plus className="h-4 w-4" />
        Create Account
      </Button>
    </div>
  );
}
