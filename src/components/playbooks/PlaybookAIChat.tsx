import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Send, Sparkles, CheckCircle2, RotateCcw, Lightbulb, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

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
  followUpPrompts?: string[];
}

interface PlaybookAIChatProps {
  onApplySuggestions: (suggestions: PlaybookSuggestion) => void;
  currentPlaybook?: Partial<PlaybookSuggestion>;
}

const QUICK_PROMPTS = [
  { label: "Tokyo Rotation", prompt: "I trade rotation setups during Tokyo session, looking for mean reversion at range extremes" },
  { label: "London Breakout", prompt: "I trade London session breakouts when price breaks out of the Asian range with momentum" },
  { label: "NY Reversal", prompt: "I trade reversals during New York AM session at key levels when price overextends" },
  { label: "Custom Setup", prompt: "" }
];

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content: "Hi! I'm here to help you build your trading playbook. Describe your setup in natural language - tell me about when you trade, what market conditions you look for, your entry criteria, and how you manage trades. You can also click one of the quick start templates below!",
  followUpPrompts: []
};

export function PlaybookAIChat({ onApplySuggestions, currentPlaybook }: PlaybookAIChatProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pendingSuggestions, setPendingSuggestions] = useState<PlaybookSuggestion | null>(null);
  const [showQuickPrompts, setShowQuickPrompts] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Get conversation history for context (exclude system messages and extract only role/content)
  const getConversationHistory = () => {
    return messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }));
  };

  const sendMessage = async (messageText?: string) => {
    const userMessage = messageText || input.trim();
    if (!userMessage || isLoading) return;

    setInput('');
    setShowQuickPrompts(false);
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const conversationHistory = getConversationHistory();
      
      const { data, error } = await supabase.functions.invoke('playbook-assistant', {
        body: { 
          message: userMessage,
          currentPlaybook: currentPlaybook,
          conversationHistory: conversationHistory
        }
      });

      if (error) {
        // Check for rate limit or payment errors
        if (error.message?.includes('429') || error.message?.includes('Rate limit')) {
          toast({
            title: "Rate Limited",
            description: "Too many requests. Please wait a moment and try again.",
            variant: "destructive"
          });
          throw new Error('Rate limit exceeded');
        }
        if (error.message?.includes('402') || error.message?.includes('Payment')) {
          toast({
            title: "Credits Required",
            description: "Please add credits to your workspace to continue using AI.",
            variant: "destructive"
          });
          throw new Error('Payment required');
        }
        throw error;
      }

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message || 'I understood your description. Let me help structure that.',
        suggestions: data.suggestions,
        followUpPrompts: data.followUpPrompts || []
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      if (data.suggestions && Object.keys(data.suggestions).length > 0) {
        setPendingSuggestions(data.suggestions);
        toast({
          title: "Suggestions Ready",
          description: "Click 'Apply' to add these to your playbook form.",
        });
      }
    } catch (error) {
      console.error('Error calling playbook assistant:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try describing your setup again.',
        followUpPrompts: ["Try again", "Start with a simpler description"]
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
        content: '✅ Suggestions applied to the form! You can continue adding more details, or review the form to make adjustments.',
        followUpPrompts: ["Add entry confirmations", "Define failure modes", "Set risk limits"]
      }]);
      toast({
        title: "Applied!",
        description: "AI suggestions have been added to your playbook form.",
      });
    }
  };

  const resetConversation = () => {
    setMessages([INITIAL_MESSAGE]);
    setPendingSuggestions(null);
    setShowQuickPrompts(true);
    setInput('');
    toast({
      title: "Conversation Reset",
      description: "Starting fresh. Your form data is preserved.",
    });
  };

  const handleQuickPrompt = (prompt: string) => {
    if (prompt) {
      sendMessage(prompt);
    } else {
      // Custom - just focus input
      setShowQuickPrompts(false);
    }
  };

  const handleFollowUp = (prompt: string) => {
    sendMessage(prompt);
  };

  const renderSuggestionPreview = (suggestions: PlaybookSuggestion) => {
    const items: string[] = [];
    if (suggestions.name) items.push(`Name: ${suggestions.name}`);
    if (suggestions.session_filter?.length) items.push(`Sessions: ${suggestions.session_filter.join(', ')}`);
    if (suggestions.valid_regimes?.length) items.push(`Regimes: ${suggestions.valid_regimes.join(', ')}`);
    if (suggestions.symbol_filter?.length) items.push(`Symbols: ${suggestions.symbol_filter.join(', ')}`);
    if (suggestions.confirmation_rules?.length) items.push(`${suggestions.confirmation_rules.length} confirmation rules`);
    if (suggestions.invalidation_rules?.length) items.push(`${suggestions.invalidation_rules.length} invalidation rules`);
    if (suggestions.management_rules?.length) items.push(`${suggestions.management_rules.length} management rules`);
    if (suggestions.failure_modes?.length) items.push(`${suggestions.failure_modes.length} failure modes`);
    if (suggestions.checklist_questions?.length) items.push(`${suggestions.checklist_questions.length} checklist items`);
    if (suggestions.max_r_per_trade) items.push(`Max R: ${suggestions.max_r_per_trade}R`);
    if (suggestions.max_daily_loss_r) items.push(`Max daily loss: ${suggestions.max_daily_loss_r}R`);

    return items;
  };

  // Get current form state summary
  const getFormStateSummary = () => {
    if (!currentPlaybook) return [];
    const items: string[] = [];
    if (currentPlaybook.name) items.push(currentPlaybook.name);
    if (currentPlaybook.session_filter?.length) items.push(`${currentPlaybook.session_filter.length} sessions`);
    if (currentPlaybook.confirmation_rules?.length) items.push(`${currentPlaybook.confirmation_rules.length} rules`);
    return items;
  };

  const formState = getFormStateSummary();

  return (
    <div className="flex flex-col h-full border-l">
      {/* Header */}
      <div className="p-3 border-b bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-medium text-sm">AI Playbook Builder</span>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={resetConversation}
            className="h-7 px-2 text-xs"
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Describe your trading setup and I'll help structure it
        </p>
        
        {/* Current form state preview */}
        {formState.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            <span className="text-xs text-muted-foreground">Current:</span>
            {formState.map((item, i) => (
              <Badge key={i} variant="outline" className="text-xs py-0">
                {item}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
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
              
              {/* Suggestions preview */}
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

              {/* Follow-up prompts */}
              {msg.role === 'assistant' && msg.followUpPrompts && msg.followUpPrompts.length > 0 && (
                <div className="flex flex-wrap gap-1 max-w-[90%]">
                  {msg.followUpPrompts.map((prompt, j) => (
                    <Button
                      key={j}
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => handleFollowUp(prompt)}
                      disabled={isLoading}
                    >
                      <Lightbulb className="w-3 h-3 mr-1" />
                      {prompt}
                    </Button>
                  ))}
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

      {/* Quick Start Templates */}
      {showQuickPrompts && messages.length === 1 && (
        <div className="p-3 border-t bg-muted/20">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <Lightbulb className="w-3 h-3" />
            Quick Start Templates
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((qp, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleQuickPrompt(qp.prompt)}
              >
                {qp.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Apply Suggestions Button */}
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

      {/* Input */}
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
            onClick={() => sendMessage()}
            disabled={!input.trim() || isLoading}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}