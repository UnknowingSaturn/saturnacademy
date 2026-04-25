import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { KnowledgeEntry, KnowledgeChatMessage } from "@/types/knowledge";

export function useKnowledgeEntries() {
  return useQuery({
    queryKey: ["knowledge_entries"],
    queryFn: async (): Promise<KnowledgeEntry[]> => {
      const { data, error } = await supabase
        .from("knowledge_entries")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as KnowledgeEntry[];
    },
    refetchInterval: (q) => {
      const list = q.state.data as KnowledgeEntry[] | undefined;
      return list?.some(e => e.status === "extracting") ? 3000 : false;
    },
  });
}

export function useKnowledgeEntry(id: string | null) {
  return useQuery({
    queryKey: ["knowledge_entry", id],
    enabled: !!id,
    queryFn: async (): Promise<KnowledgeEntry | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("knowledge_entries").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return (data as unknown as KnowledgeEntry) || null;
    },
    refetchInterval: (q) => {
      const e = q.state.data as KnowledgeEntry | undefined;
      return e?.status === "extracting" ? 3000 : false;
    },
  });
}

export function useCreateKnowledgeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string): Promise<KnowledgeEntry> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      // Basic URL validation
      try { new URL(url); } catch { throw new Error("Please enter a valid URL"); }

      const { data, error } = await supabase
        .from("knowledge_entries")
        .insert({
          user_id: user.id,
          source_url: url,
          source_title: url,
          status: "extracting",
        })
        .select()
        .single();
      if (error) throw error;

      // Fire extraction (don't await — it can take 20s+)
      supabase.functions.invoke("extract-knowledge", { body: { entry_id: (data as any).id } })
        .then(() => qc.invalidateQueries({ queryKey: ["knowledge_entries"] }))
        .catch(err => console.error("extract-knowledge invoke failed", err));

      return data as unknown as KnowledgeEntry;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge_entries"] });
      toast.success("Extracting article — this takes ~20s");
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });
}

export function useReExtract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry_id: string) => {
      const { data, error } = await supabase.functions.invoke("extract-knowledge", { body: { entry_id } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return data;
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["knowledge_entries"] });
      qc.invalidateQueries({ queryKey: ["knowledge_entry", id] });
      toast.success("Re-extraction started");
    },
    onError: (e: Error) => toast.error(`Failed: ${e.message}`),
  });
}

export function useDeleteKnowledgeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("knowledge_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["knowledge_entries"] });
      toast.success("Entry deleted");
    },
  });
}

export function useKnowledgeChatHistory(entry_id: string | null) {
  return useQuery({
    queryKey: ["knowledge_chat", entry_id],
    enabled: !!entry_id,
    queryFn: async (): Promise<KnowledgeChatMessage[]> => {
      if (!entry_id) return [];
      const { data, error } = await supabase
        .from("knowledge_chat_messages")
        .select("*")
        .eq("knowledge_entry_id", entry_id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as KnowledgeChatMessage[];
    },
  });
}

export function useSendKnowledgeMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entry_id: string; messages: { role: string; content: string }[] }) => {
      const { data, error } = await supabase.functions.invoke("knowledge-chat", { body: input });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return (data as any).reply as string;
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: ["knowledge_chat", vars.entry_id] });
    },
    onError: (e: Error) => toast.error(`Send failed: ${e.message}`),
  });
}
