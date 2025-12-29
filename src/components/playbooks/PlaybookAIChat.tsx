import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Send, Sparkles, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PlaybookSuggestion {
  name?: string;
  description?: string;
  session_filter?: string[];
  symbol_filter?: string[];
  valid_regimes?: string[];
  entry_zone_rules?: {
    min_percentile?: number;
    max_percentile?: number;
    require_htf_alignment?: boolean;
  };
  confirmation_rules?: string[];
  invalidation_rules?: string[];
  management_rules?: string[];
  failure_modes?: string[];
  checklist_questions?: string[];
  max_r_per_trade?: number;
  max_daily_loss_r?: number;
  max_trades_per_session?: number;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: PlaybookSuggestion;
}

interface PlaybookAIChatProps {
  onApplySuggestions: (suggestions: PlaybookSuggestion) => void;
  currentPlaybook?: Partial<PlaybookSuggestion>;
}

export function PlaybookAIChat({ onApplySuggestions, currentPlaybook }: PlaybookAIChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Hi! I'm here to help you build your trading playbook. Describe your setup in natural language - tell me about when you trade, what market conditions you look for, your entry criteria, and how you manage trades. I'll help structure it into a proper playbook."
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState<PlaybookSuggestion | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const { data, error } = await supabase.functions.invoke('playbook-assistant', {
        body: { 
          message: userMessage,
          currentPlaybook: currentPlaybook
        }
      });

      if (error) throw error;

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message || 'I understood your description. Let me help structure that.',
        suggestions: data.suggestions
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      if (data.suggestions && Object.keys(data.suggestions).length > 0) {
        setPendingSuggestions(data.suggestions);
      }
    } catch (error) {
      console.error('Error calling playbook assistant:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try describing your setup again.'
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const applySuggestions = () => {
    if (pendingSuggestions) {
      onApplySuggestions(pendingSuggestions);
      setPendingSuggestions(null);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '✅ Suggestions applied! You can continue describing more details, or review the form fields to make adjustments.'
      }]);
    }
  };

  const renderSuggestionPreview = (suggestions: PlaybookSuggestion) => {
    const items: string[] = [];
    if (suggestions.name) items.push(`Name: ${suggestions.name}`);
    if (suggestions.session_filter?.length) items.push(`Sessions: ${suggestions.session_filter.join(', ')}`);
    if (suggestions.valid_regimes?.length) items.push(`Regimes: ${suggestions.valid_regimes.join(', ')}`);
    if (suggestions.confirmation_rules?.length) items.push(`${suggestions.confirmation_rules.length} confirmation rules`);
    if (suggestions.failure_modes?.length) items.push(`${suggestions.failure_modes.length} failure modes`);
    if (suggestions.checklist_questions?.length) items.push(`${suggestions.checklist_questions.length} checklist items`);
    if (suggestions.max_r_per_trade) items.push(`Max R: ${suggestions.max_r_per_trade}R`);

    return items;
  };

  return (
    <div className="flex flex-col h-full border-l">
      <div className="p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">AI Playbook Builder</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Describe your trading setup and I'll help structure it
        </p>
      </div>

      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        <div className="space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={cn(
              "flex flex-col gap-2",
              msg.role === 'user' ? "items-end" : "items-start"
            )}>
              <div className={cn(
                "max-w-[90%] rounded-lg px-3 py-2 text-sm",
                msg.role === 'user' 
                  ? "bg-primary text-primary-foreground" 
                  : "bg-muted"
              )}>
                {msg.content}
              </div>
              
              {msg.suggestions && Object.keys(msg.suggestions).length > 0 && (
                <div className="max-w-[90%] bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-primary">
                    <CheckCircle2 className="w-3 h-3" />
                    Extracted from your description:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {renderSuggestionPreview(msg.suggestions).map((item, j) => (
                      <Badge key={j} variant="secondary" className="text-xs">
                        {item}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
          
          {isLoading && (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Thinking...
            </div>
          )}
        </div>
      </ScrollArea>

      {pendingSuggestions && Object.keys(pendingSuggestions).length > 0 && (
        <div className="p-3 border-t bg-primary/5">
          <Button 
            onClick={applySuggestions}
            className="w-full gap-2"
            size="sm"
          >
            <Sparkles className="w-4 h-4" />
            Apply AI Suggestions to Form
          </Button>
        </div>
      )}

      <div className="p-3 border-t">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Describe your trading setup..."
            disabled={isLoading}
            className="text-sm"
          />
          <Button 
            size="icon" 
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
