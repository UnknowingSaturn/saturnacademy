import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CustomFieldOption, CustomFieldType } from "@/types/settings";
import { toast } from "sonner";

// Field overrides are stored as rows in `custom_field_definitions` where
// scope='system_override' and key=field_key. The wire/UI shape below preserves
// the original FieldOverride contract so call sites don't need to change.

export interface FieldOverride {
  id: string;
  user_id: string;
  field_key: string;
  type: CustomFieldType;
  options: CustomFieldOption[];
  default_value: any;
  created_at: string;
  updated_at: string;
}

const transform = (row: any): FieldOverride => ({
  id: row.id,
  user_id: row.user_id,
  field_key: row.key,
  type: row.type as CustomFieldType,
  options: (row.options as CustomFieldOption[]) || [],
  default_value: row.default_value,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

export function useFieldOverrides() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["field_overrides", user?.id],
    queryFn: async () => {
      if (!user?.id) return [] as FieldOverride[];
      const { data, error } = await supabase
        .from("custom_field_definitions")
        .select("*")
        .eq("user_id", user.id)
        .eq("scope", "system_override");
      if (error) throw error;
      return ((data || []) as any[]).map(transform);
    },
    enabled: !!user?.id,
  });
}

export function useUpsertFieldOverride() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      field_key: string;
      type: CustomFieldType;
      options?: CustomFieldOption[];
      default_value?: any;
    }) => {
      if (!user?.id) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("custom_field_definitions")
        .upsert(
          {
            user_id: user.id,
            scope: "system_override",
            key: input.field_key,
            label: input.field_key,
            type: input.type,
            options: (input.options || []) as any,
            default_value: input.default_value ?? null,
          },
          { onConflict: "user_id,scope,key" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["field_overrides"] });
      qc.invalidateQueries({ queryKey: ["custom_field_definitions"] });
      toast.success("Field configuration saved");
    },
    onError: (e: any) => {
      console.error(e);
      toast.error("Failed to save field configuration");
    },
  });
}

export function useDeleteFieldOverride() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (field_key: string) => {
      if (!user?.id) throw new Error("Not authenticated");
      const { error } = await supabase
        .from("custom_field_definitions")
        .delete()
        .eq("user_id", user.id)
        .eq("scope", "system_override")
        .eq("key", field_key);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["field_overrides"] });
      qc.invalidateQueries({ queryKey: ["custom_field_definitions"] });
      toast.success("Reset to default");
    },
  });
}
