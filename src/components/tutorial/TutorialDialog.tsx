import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EASetupGuide, type EAGuideTab } from "./EASetupGuide";

interface TutorialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  defaultTab?: EAGuideTab;
  /** Render the EA setup guide tabs (most pages use this). */
  showEAGuide?: boolean;
  /** Optional extra content rendered above the EA guide. */
  intro?: React.ReactNode;
}

/**
 * Full-screen-ish tutorial modal used by the "How it works" button in page headers.
 * By default it shows the shared EASetupGuide; pages can pre-select a tab.
 */
export function TutorialDialog({
  open,
  onOpenChange,
  title = "How it works",
  description,
  defaultTab = "install",
  showEAGuide = true,
  intro,
}: TutorialDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] sm:max-w-3xl overflow-hidden flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-border">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <ScrollArea className="flex-1">
          <div className="px-6 py-5 space-y-6">
            {intro}
            {showEAGuide && <EASetupGuide defaultTab={defaultTab} />}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

/** Re-export for convenience. */
export { Tabs, TabsContent, TabsList, TabsTrigger };
