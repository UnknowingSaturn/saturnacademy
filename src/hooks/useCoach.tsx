import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import type { CoachMessage, CoachThread } from "@/types/coach";

const THREADS_KEY = ["coach_threads"] as const;
const MESSAGES_KEY = (id: string | null) => ["coach_messages", id] as const;

export function useCoachThreads() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...THREADS_KEY, user?.id ?? null],
    enabled: !!user,
    queryFn: async (): Promise<CoachThread[]> => {
      const { data, error } = await supabase
        .from("coach_threads" as any)
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as CoachThread[];
    },
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
}

export function useCoachMessages(threadId: string | null) {
  return useQuery({
    queryKey: MESSAGES_KEY(threadId),
    enabled: !!threadId,
    queryFn: async (): Promise<CoachMessage[]> => {
      if (!threadId) return [];
      const { data, error } = await supabase
        .from("coach_messages" as any)
        .select("*")
        .eq("thread_id", threadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as unknown as CoachMessage[];
      // Sign attachment URLs (private bucket).
      const paths = rows.flatMap((r) => (r.attachments ?? []).map((a) => a.storage_path)).filter(Boolean);
      if (paths.length === 0) return rows;
      const uniquePaths = Array.from(new Set(paths));
      const { data: signed } = await supabase.storage
        .from("coach-uploads")
        .createSignedUrls(uniquePaths, 60 * 10);
      const map = new Map<string, string>();
      (signed ?? []).forEach((s) => { if (s.signedUrl && s.path) map.set(s.path, s.signedUrl); });
      return rows.map((r) => ({
        ...r,
        attachments: (r.attachments ?? []).map((a) => ({ ...a, signed_url: map.get(a.storage_path) })),
      }));
    },
    staleTime: 5_000,
  });
}

export function useCreateCoachThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { title?: string; context_trade_id?: string; context_route?: string } = {}) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Not authenticated");
      const { data, error } = await supabase
        .from("coach_threads" as any)
        .insert({
          user_id: u.user.id,
          title: input.title ?? "New conversation",
          context_trade_id: input.context_trade_id ?? null,
          context_route: input.context_route ?? null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as CoachThread;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: THREADS_KEY }),
  });
}

export function useRenameCoachThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const { error } = await supabase.from("coach_threads" as any).update({ title }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: THREADS_KEY }),
  });
}

export function useDeleteCoachThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("coach_threads" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: THREADS_KEY }),
    onError: (e: Error) => toast.error(`Delete failed: ${e.message}`),
  });
}

export interface SendCoachMessageInput {
  thread_id: string;
  text: string;
  attachments?: { storage_path: string }[];
}

export function useSendCoachMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SendCoachMessageInput) => {
      const { data, error } = await supabase.functions.invoke("coach-chat", { body: input });
      if (error) {
        // Extract server-side error body if present
        const msg = (error as any).message ?? "Request failed";
        throw new Error(msg);
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      return data as { reply: string; title?: string | null };
    },
    onSuccess: (_r, vars) => {
      qc.invalidateQueries({ queryKey: MESSAGES_KEY(vars.thread_id) });
      qc.invalidateQueries({ queryKey: THREADS_KEY });
    },
    onError: (e: Error) => toast.error(e.message.slice(0, 200)),
  });
}
