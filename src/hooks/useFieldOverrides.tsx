import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { CustomFieldOption, CustomFieldType } from "@/types/settings";
import { toast } from "sonner";

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

export function useFieldOverrides() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["field_overrides", user?.id],
    queryFn: async () => {
      if (!user?.id) return [] as FieldOverride[];
      const { data, error } = await (supabase as any)
        .from("field_overrides")
        .select("*")
        .eq("user_id", user.id);
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        ...r,
        options: (r.options as CustomFieldOption[]) || [],
      })) as FieldOverride[];
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
      const { error } = await (supabase as any)
        .from("field_overrides")
        .upsert(
          {
            user_id: user.id,
            field_key: input.field_key,
            type: input.type,
            options: input.options || [],
            default_value: input.default_value ?? null,
          },
          { onConflict: "user_id,field_key" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["field_overrides"] });
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
      const { error } = await (supabase as any)
        .from("field_overrides")
        .delete()
        .eq("user_id", user.id)
        .eq("field_key", field_key);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["field_overrides"] });
      toast.success("Reset to default");
    },
  });
}
