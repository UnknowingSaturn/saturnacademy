import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FieldDef, fieldDependents } from "@/lib/journalFields/registry";
import { useFieldLayoutActions } from "@/hooks/useFieldLayoutActions";
import {
  useEraseSystemFieldData,
  useCountTradesWithSystemField,
  useUpdateCustomField,
  useCustomFieldDefinitions,
} from "@/hooks/useCustomFields";
import { AlertTriangle } from "lucide-react";

interface Props {
  field: FieldDef | null;
  label: string;
  onClose: () => void;
}

/**
 * Shared remove-field confirmation used by the inline menus on the journal
 * table header and the trade detail panel.
 *
 * Locked fields never reach this dialog. Analytics-tier fields get an explicit
 * list of the surfaces that go blank; free-tier fields get a plain confirm.
 */
export function RemoveFieldDialog({ field, label, onClose }: Props) {
  const { removeField } = useFieldLayoutActions();
  const eraseSystemData = useEraseSystemFieldData();
  const updateCustomField = useUpdateCustomField();
  const { data: customFields = [] } = useCustomFieldDefinitions();
  const [erase, setErase] = useState(false);

  const canErase = !!field && field.erasable && field.group !== "custom";
  const { data: valueCount = 0 } = useCountTradesWithSystemField(
    canErase && field ? field.key : null,
  );
  const dependents = useMemo(() => fieldDependents(field ?? undefined), [field]);

  const confirm = async () => {
    if (!field) return;
    if (field.group === "custom") {
      const def = customFields.find((f) => f.key === field.key);
      if (def) await updateCustomField.mutateAsync({ id: def.id, is_active: false });
    } else {
      await removeField(field.key);
      if (erase && canErase) await eraseSystemData.mutateAsync(field.key);
    }
    setErase(false);
    onClose();
  };

  return (
    <AlertDialog open={!!field} onOpenChange={(o) => { if (!o) { setErase(false); onClose(); } }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove "{label}"?</AlertDialogTitle>
          <AlertDialogDescription>
            It disappears from the table and trade detail. Stored values stay on your trades and the
            field can be restored from Journal settings → Fields.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {dependents.length > 0 && (
          <div className="flex items-start gap-2 p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 shrink-0" />
            <div>
              <div className="font-medium">This field feeds other analysis</div>
              <div className="text-xs text-muted-foreground">
                {dependents.join(", ")} rely on it. Removing it here does not delete the data, but you
                will no longer be able to fill it in for new trades.
              </div>
            </div>
          </div>
        )}

        {canErase && (
          <label className="flex items-start gap-2 p-3 rounded-md bg-muted/50 cursor-pointer">
            <input
              type="checkbox"
              checked={erase}
              onChange={(e) => setErase(e.target.checked)}
              className="mt-0.5"
            />
            <div className="text-sm">
              <div className="font-medium">Also permanently erase data</div>
              <div className="text-xs text-muted-foreground">
                Wipes the value from {valueCount} trade{valueCount === 1 ? "" : "s"}. Cannot be undone.
              </div>
            </div>
          </label>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {erase ? `Remove & erase ${valueCount} value${valueCount === 1 ? "" : "s"}` : "Remove field"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
