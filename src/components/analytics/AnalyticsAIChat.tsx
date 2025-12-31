import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { 
  Loader2, 
  Send, 
  Bot, 
  RotateCcw, 
  Lightbulb, 
  TrendingUp,
  Search,
  BookOpen,
  Target,
  AlertTriangle,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface AnalyticsAIChatProps {
  accountId?: string;
  totalTrades?: number;
}

const ANALYTICS_PROMPTS = [
  { 
    label: "Playbook Validity", 
    icon: BookOpen,
    prompt: "Analyze my playbook performance. For each playbook with enough data, tell me if it has a statistical edge and what the key execution patterns are. Be honest about sample sizes." 
  },
  { 
    label: "Execution Mistakes", 
    icon: AlertTriangle,
    prompt: "Look through my trade reviews and journal entries. What recurring execution mistakes do you see? Cite specific trades and be honest if data is limited." 
  },
  { 
    label: "Winners vs Losers", 
    icon: TrendingUp,
    prompt: "For my main playbook, compare my winning trades to losing trades. What are the key differences in execution, timing, or risk sizing?" 
  },
  { 
    label: "Rule Compliance", 
    icon: Target,
    prompt: "Check my recent trades against their playbook rules. Are there trades where I didn't follow my own checklist or rules? Look at the checklist_answers data." 
  },
  { 
    label: "Risk Patterns", 
    icon: Zap,
    prompt: "Analyze my position sizing and risk management. Do I risk more after wins or losses? Are my losses larger than they should be based on my stop placement?" 
  },
  { 
    label: "Data Gaps", 
    icon: Search,
    prompt: "What journal data am I missing that would help you give better analysis? What should I be tracking more consistently?" 
  },
];

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content: `👋 I'm TradeGPT - your personal trading analyst. I have access to your complete trade history, playbook rules, and journal entries.

**I can help you:**
- Analyze playbook performance with honest sample size awareness
- Compare winners vs losers to find execution differences
- Check if you're following your own rules
- Find patterns in your journal entries
- Identify risk sizing issues

What would you like to explore? Click a quick prompt below or ask me anything about your trading.`
};

export function AnalyticsAIChat({ accountId, totalTrades }: AnalyticsAIChatProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [contextLoaded, setContextLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const getConversationHistory = () => {
    return messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(1) // Exclude initial message
      .map(m => ({ role: m.role, content: m.content }));
  };

  const sendMessage = async (messageText?: string) => {
    const userMessage = messageText || input.trim();
    if (!userMessage || isLoading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const conversationHistory = getConversationHistory();
      
      const { data, error } = await supabase.functions.invoke('analytics-chat', {
        body: { 
          message: userMessage,
          conversationHistory,
          account_id: accountId,
          includeContext: !contextLoaded // Only load full context on first message
        }
      });

      if (error) {
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

      setContextLoaded(true);
      
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message || 'I encountered an issue. Please try again.',
      };

      setMessages(prev => [...prev, assistantMessage]);
      
    } catch (error) {
      console.error('Error calling analytics chat:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const resetConversation = () => {
    setMessages([INITIAL_MESSAGE]);
    setContextLoaded(false);
    setInput('');
    toast({
      title: "Conversation Reset",
      description: "Starting fresh analysis session.",
    });
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex-shrink-0 pb-3 border-b mb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            <span className="font-semibold">TradeGPT</span>
            {totalTrades !== undefined && (
              <Badge variant="outline" className="text-xs">
                {totalTrades} trades loaded
              </Badge>
            )}
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={resetConversation}
            className="h-8 px-2 text-xs"
          >
            <RotateCcw className="w-3 h-3 mr-1" />
            Reset
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full pr-4">
          <div className="space-y-4" ref={scrollRef}>
            {messages.map((msg, i) => (
              <div key={i} className={cn(
                "flex flex-col gap-2",
                msg.role === 'user' ? "items-end" : "items-start"
              )}>
                <div className={cn(
                  "max-w-[85%] rounded-lg px-4 py-3 text-sm",
                  msg.role === 'user' 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-muted/50 border"
                )}>
                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <FormattedMessage content={msg.content} />
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}
            
            {isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm p-3 bg-muted/30 rounded-lg">
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing your data...
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Quick Prompts */}
      {messages.length === 1 && (
        <div className="flex-shrink-0 py-3 border-t mt-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <Lightbulb className="w-3 h-3" />
            Quick Analysis
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {ANALYTICS_PROMPTS.map((qp, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                className="h-auto py-2 px-3 justify-start text-left"
                onClick={() => sendMessage(qp.prompt)}
                disabled={isLoading}
              >
                <qp.icon className="w-3 h-3 mr-2 flex-shrink-0" />
                <span className="text-xs">{qp.label}</span>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 pt-3 border-t mt-auto">
        <div className="flex gap-2 items-end">
          <Textarea
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 150)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Ask about your trading performance..."
            disabled={isLoading}
            className="text-sm min-h-[60px] max-h-[150px] resize-none"
            rows={2}
          />
          <Button 
            size="icon" 
            onClick={() => sendMessage()}
            disabled={!input.trim() || isLoading}
            className="flex-shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// Simple markdown-like formatter
function FormattedMessage({ content }: { content: string }) {
  // Process the content line by line
  const lines = content.split('\n');
  
  return (
    <>
      {lines.map((line, i) => {
        // Headers
        if (line.startsWith('### ')) {
          return <h4 key={i} className="font-semibold mt-3 mb-1">{line.slice(4)}</h4>;
        }
        if (line.startsWith('## ')) {
          return <h3 key={i} className="font-semibold text-base mt-3 mb-1">{line.slice(3)}</h3>;
        }
        if (line.startsWith('# ')) {
          return <h2 key={i} className="font-bold text-lg mt-3 mb-2">{line.slice(2)}</h2>;
        }
        
        // Bullet points
        if (line.startsWith('- ') || line.startsWith('* ')) {
          return (
            <div key={i} className="flex gap-2 my-1">
              <span className="text-muted-foreground">•</span>
              <span>{formatInlineStyles(line.slice(2))}</span>
            </div>
          );
        }
        
        // Numbered lists
        const numberedMatch = line.match(/^\d+\.\s/);
        if (numberedMatch) {
          return (
            <div key={i} className="flex gap-2 my-1">
              <span className="text-muted-foreground min-w-[1.5em]">{numberedMatch[0]}</span>
              <span>{formatInlineStyles(line.slice(numberedMatch[0].length))}</span>
            </div>
          );
        }
        
        // Empty lines
        if (line.trim() === '') {
          return <div key={i} className="h-2" />;
        }
        
        // Regular paragraph
        return <p key={i} className="my-1">{formatInlineStyles(line)}</p>;
      })}
    </>
  );
}

function formatInlineStyles(text: string): React.ReactNode {
  // Handle bold **text**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    // Handle inline code `text`
    const codeParts = part.split(/(`[^`]+`)/g);
    return codeParts.map((codePart, j) => {
      if (codePart.startsWith('`') && codePart.endsWith('`')) {
        return (
          <code key={`${i}-${j}`} className="bg-muted px-1 py-0.5 rounded text-xs">
            {codePart.slice(1, -1)}
          </code>
        );
      }
      return codePart;
    });
  });
}
