import { useState, useEffect, useRef, useMemo } from "react";
import { Trade } from "@/types/trading";
import { useUpsertTradeReview } from "@/hooks/useTrades";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useLiveTrades } from "@/contexts/LiveTradesContext";
import { LiveTradeQuestion } from "@/types/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { BadgeSelect } from "./BadgeSelect";
import { HelpCircle, Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveTradeQuestionsPanelProps {
  trade: Trade;
  playbookId?: string | null;
}

const PREFIX = "__live_questions.";

export function LiveTradeQuestionsPanel({ trade, playbookId }: LiveTradeQuestionsPanelProps) {
  const { data: settings } = useUserSettings();
  const upsertReview = useUpsertTradeReview();
  const { registerPendingSave, unregisterPendingSave } = useLiveTrades();

  const questions: LiveTradeQuestion[] = settings?.live_trade_questions || [];
  const existingReview = trade.review;

  // Hydrate from review.checklist_answers using prefix
  const initialAnswers = useMemo(() => {
    const out: Record<string, string | number> = {};
    const ans = (existingReview?.checklist_answers || {}) as Record<string, any>;
    for (const k of Object.keys(ans)) {
      if (k.startsWith(PREFIX)) {
        out[k.slice(PREFIX.length)] = ans[k];
      }
    }
    return out;
  }, [existingReview?.checklist_answers]);

  const [answers, setAnswers] = useState<Record<string, string | number>>(initialAnswers);
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  // Re-hydrate when trade changes
  useEffect(() => {
    setAnswers(initialAnswers);
    dirtyRef.current = false;
  }, [trade.id, initialAnswers]);

  // Debounced auto-save
  useEffect(() => {
    if (!dirtyRef.current) return;
    if (upsertReview.isPending) return;

    registerPendingSave(trade.id, 'questions');

    pendingSaveRef.current = setTimeout(async () => {
      const baseAnswers = (existingReview?.checklist_answers || {}) as Record<string, any>;
      // Strip old live-question keys, then re-add current
      const merged: Record<string, any> = {};
      for (const k of Object.keys(baseAnswers)) {
        if (!k.startsWith(PREFIX)) merged[k] = baseAnswers[k];
      }
      for (const [k, v] of Object.entries(answers)) {
        if (v !== "" && v !== null && v !== undefined) {
          merged[`${PREFIX}${k}`] = v;
        }
      }

      try {
        await upsertReview.mutateAsync({
          review: {
            trade_id: trade.id,
            ...(playbookId ? { playbook_id: playbookId } : {}),
            checklist_answers: merged,
            ...(existingReview && {
              regime: existingReview.regime,
              emotional_state_before: existingReview.emotional_state_before,
              psychology_notes: existingReview.psychology_notes,
              screenshots: existingReview.screenshots,
            }),
          },
          silent: true,
        });
        dirtyRef.current = false;
        unregisterPendingSave(trade.id, 'questions');
      } catch {
        unregisterPendingSave(trade.id, 'questions');
      }
    }, 500);

    return () => {
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, trade.id, playbookId]);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (pendingSaveRef.current) {
        clearTimeout(pendingSaveRef.current);
        if (dirtyRef.current) {
          const baseAnswers = (existingReview?.checklist_answers || {}) as Record<string, any>;
          const merged: Record<string, any> = {};
          for (const k of Object.keys(baseAnswers)) {
            if (!k.startsWith(PREFIX)) merged[k] = baseAnswers[k];
          }
          for (const [k, v] of Object.entries(answers)) {
            if (v !== "" && v !== null && v !== undefined) {
              merged[`${PREFIX}${k}`] = v;
            }
          }
          upsertReview.mutate({
            review: {
              trade_id: trade.id,
              ...(playbookId ? { playbook_id: playbookId } : {}),
              checklist_answers: merged,
            },
            silent: true,
          });
        }
        unregisterPendingSave(trade.id, 'questions');
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.id]);

  const updateAnswer = (qid: string, value: string | number) => {
    dirtyRef.current = true;
    setAnswers(prev => ({ ...prev, [qid]: value }));
  };

  if (!questions || questions.length === 0) return null;

  return (
    <Card className="border-border/50">
      <CardHeader className="py-2.5 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-primary" />
          Live Trade Questions
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 pt-0 space-y-4">
        {questions.map((q) => {
          const value = answers[q.id];

          if (q.type === 'text') {
            return (
              <div key={q.id} className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{q.label}</Label>
                <Textarea
                  value={(value as string) || ""}
                  onChange={(e) => updateAnswer(q.id, e.target.value)}
                  placeholder="Type your answer..."
                  className="min-h-[60px] text-sm"
                />
              </div>
            );
          }

          if (q.type === 'select') {
            const options = (q.options || []).map(o => ({ value: o, label: o, color: 'muted' }));
            return (
              <div key={q.id} className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{q.label}</Label>
                <BadgeSelect
                  value={(value as string) || null}
                  onChange={(v) => updateAnswer(q.id, v as string)}
                  options={options}
                  placeholder="Select..."
                  allowClear
                />
              </div>
            );
          }

          if (q.type === 'rating') {
            const current = typeof value === 'number' ? value : 0;
            return (
              <div key={q.id} className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{q.label}</Label>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "h-8 w-8",
                        n <= current ? "text-warning" : "text-muted-foreground/40"
                      )}
                      onClick={() => updateAnswer(q.id, n === current ? 0 : n)}
                    >
                      <Star className={cn("h-5 w-5", n <= current && "fill-current")} />
                    </Button>
                  ))}
                  {current > 0 && (
                    <span className="ml-2 text-xs text-muted-foreground">{current}/5</span>
                  )}
                </div>
              </div>
            );
          }

          return null;
        })}
      </CardContent>
    </Card>
  );
}
