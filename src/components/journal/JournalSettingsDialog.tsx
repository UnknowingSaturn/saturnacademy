import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SessionConfigPanel } from "./settings/SessionConfigPanel";
import { FieldsPanel } from "./settings/FieldsPanel";
import { DetailLayoutPanel } from "./settings/DetailLayoutPanel";
import { FilterPresetsPanel } from "./settings/FilterPresetsPanel";

interface JournalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: string;
}

export function JournalSettingsDialog({ open, onOpenChange, defaultTab }: JournalSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || "fields");

  useEffect(() => {
    if (open && defaultTab) setActiveTab(defaultTab);
  }, [open, defaultTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Journal Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="sections">Sections</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="filters">Filters</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto mt-4">
            <TabsContent value="fields" className="mt-0 h-full">
              <FieldsPanel />
            </TabsContent>

            <TabsContent value="sections" className="mt-0 h-full">
              <DetailLayoutPanel />
            </TabsContent>

            <TabsContent value="sessions" className="mt-0 h-full">
              <SessionConfigPanel />
            </TabsContent>

            <TabsContent value="filters" className="mt-0 h-full">
              <FilterPresetsPanel />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
