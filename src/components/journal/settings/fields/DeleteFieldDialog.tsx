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
import { CustomFieldDefinition, resolveFieldLabel } from "@/types/settings";
import type { FieldRow } from "./constants";

export type DeleteTarget =
  | { kind: "system-soft"; field: FieldRow }
  | { kind: "system-erasable"; field: FieldRow }
  | { kind: "custom-soft"; field: CustomFieldDefinition }
  | { kind: "custom-hard"; field: CustomFieldDefinition }
  | { kind: "custom-erase"; field: CustomFieldDefinition };

interface Props {
  target: DeleteTarget | null;
  overrides: Record<string, string>;
  customEraseCount: number;
  systemEraseCount: number;
  eraseAlongDelete: boolean;
  onEraseAlongDeleteChange: (v: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteFieldDialog({
  target, overrides, customEraseCount, systemEraseCount,
  eraseAlongDelete, onEraseAlongDeleteChange, onClose, onConfirm,
}: Props) {
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        {target?.kind === "system-soft" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete "{resolveFieldLabel(target.field.key, target.field.defaultLabel, overrides)}"?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This is a system field. Removing it hides it from the table and trade detail.
                Underlying data on existing trades is preserved and can be restored from the Hidden
                fields section below.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Hide field
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}

        {target?.kind === "system-erasable" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete "{resolveFieldLabel(target.field.key, target.field.defaultLabel, overrides)}"?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Hides this system field from the table and trade detail. <strong>{systemEraseCount}</strong>{" "}
                trade{systemEraseCount === 1 ? " has" : "s have"} a value for it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label className="flex items-start gap-2 p-3 rounded-md bg-muted/50 cursor-pointer">
              <input
                type="checkbox"
                checked={eraseAlongDelete}
                onChange={(e) => onEraseAlongDeleteChange(e.target.checked)}
                className="mt-0.5"
              />
              <div className="text-sm">
                <div className="font-medium">Also permanently erase data</div>
                <div className="text-xs text-muted-foreground">
                  Wipes the value from {systemEraseCount} trade{systemEraseCount === 1 ? "" : "s"}.
                  Cannot be undone.
                </div>
              </div>
            </label>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {eraseAlongDelete
                  ? `Hide & erase ${systemEraseCount} value${systemEraseCount === 1 ? "" : "s"}`
                  : "Hide field"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}

        {target?.kind === "custom-soft" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{target.field.label}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Hides this custom field. Data is preserved on every trade and the field can be
                restored from the Hidden custom fields section below. To remove permanently, use the
                options menu there.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Hide field
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}

        {target?.kind === "custom-erase" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Erase data for "{target.field.label}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Permanently removes the value for this field from <strong>{customEraseCount}</strong>{" "}
                trade{customEraseCount === 1 ? "" : "s"}. The field definition stays. Cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Erase {customEraseCount} value{customEraseCount === 1 ? "" : "s"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}

        {target?.kind === "custom-hard" && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently delete "{target.field.label}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Removes the field definition entirely. <strong>{customEraseCount}</strong> trade
                {customEraseCount === 1 ? " still has" : "s still have"} a value for it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <label className="flex items-start gap-2 p-3 rounded-md bg-muted/50 cursor-pointer">
              <input
                type="checkbox"
                checked={eraseAlongDelete}
                onChange={(e) => onEraseAlongDeleteChange(e.target.checked)}
                className="mt-0.5"
              />
              <div className="text-sm">
                <div className="font-medium">Also wipe the data from those trades</div>
                <div className="text-xs text-muted-foreground">
                  Recommended — otherwise stored values become orphaned.
                </div>
              </div>
            </label>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={onConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Permanently delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
