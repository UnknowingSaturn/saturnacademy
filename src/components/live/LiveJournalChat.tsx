import { useState, useRef, useEffect, useCallback } from "react";
import { Trade, Playbook } from "@/types/trading";
import { supabase } from "@/integrations/supabase/client";
import { useUpsertTradeReview } from "@/hooks/useTrades";
import { useScreenshots } from "@/hooks/useScreenshots";
import { useLiveTrades } from "@/contexts/LiveTradesContext";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { 
  Bot, 
  Send, 
  Mic, 
  MicOff, 
  Loader2, 
  Image as ImageIcon,
  CheckCircle2,
  RotateCcw
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface LiveJournalChatProps {
  trade: Trade;
  playbook: Playbook;
}

const INITIAL_MESSAGE = `Hey! You're in a {{symbol}} {{direction}} using your **{{playbook}}** setup. Let's document this trade while it's fresh.

How are you feeling going into this position?`;

export function LiveJournalChat({ trade, playbook }: LiveJournalChatProps) {
  const { 
    getChatState, 
    setChatState, 
    updateChatMessages, 
    updateQuickResponses,
    updateSavedData,
    registerPendingSave,
    unregisterPendingSave 
  } = useLiveTrades();
  
  // Get cached state from context
  const cachedState = getChatState(trade.id);
  
  const [messages, setMessages] = useState<Message[]>(cachedState?.messages || []);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [quickResponses, setQuickResponses] = useState<string[]>(
    cachedState?.quickResponses || ['Focused', 'Calm', 'Confident', 'Anxious', 'FOMO']
  );
  const [shouldUploadScreenshot, setShouldUploadScreenshot] = useState(false);
  const [savedData, setSavedData] = useState<Record<string, any>>(cachedState?.savedData || {});
  const [hasLoadedConversation, setHasLoadedConversation] = useState(false);
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const pendingSaveRef = useRef<NodeJS.Timeout | null>(null);
  
  const upsertReview = useUpsertTradeReview();
  const { uploadScreenshot, isUploading } = useScreenshots();

  // Load existing conversation or initialize with first message
  useEffect(() => {
    // If we have cached state from context, use it
    if (cachedState?.messages && cachedState.messages.length > 0) {
      setMessages(cachedState.messages);
      setQuickResponses(cachedState.quickResponses || []);
      setSavedData(cachedState.savedData || {});
      setHasLoadedConversation(true);
      return;
    }
    
    // Otherwise, try loading from trade.review
    const existingConversation = trade.review?.journal_conversation as Message[] | undefined;
    
    if (existingConversation && Array.isArray(existingConversation) && existingConversation.length > 0) {
      setMessages(existingConversation);
      setQuickResponses([]); // Clear quick responses when loading existing conversation
    } else {
      const initialContent = INITIAL_MESSAGE
        .replace('{{symbol}}', trade.symbol)
        .replace('{{direction}}', trade.direction.toUpperCase())
        .replace('{{playbook}}', playbook.name);
      
      setMessages([{ role: 'assistant', content: initialContent }]);
    }
    setHasLoadedConversation(true);
  }, [trade.id, playbook.id, cachedState]);

  // Sync messages to context when they change
  useEffect(() => {
    if (hasLoadedConversation && messages.length > 0) {
      updateChatMessages(trade.id, messages);
    }
  }, [messages, trade.id, hasLoadedConversation, updateChatMessages]);

  // Sync quick responses to context
  useEffect(() => {
    if (hasLoadedConversation) {
      updateQuickResponses(trade.id, quickResponses);
    }
  }, [quickResponses, trade.id, hasLoadedConversation, updateQuickResponses]);

  // Sync saved data to context
  useEffect(() => {
    if (hasLoadedConversation && Object.keys(savedData).length > 0) {
      updateSavedData(trade.id, savedData);
    }
  }, [savedData, trade.id, hasLoadedConversation, updateSavedData]);

  // Save conversation when messages change (debounced) with immediate flush on unmount
  useEffect(() => {
    if (!hasLoadedConversation || messages.length <= 1) return;
    
    registerPendingSave(trade.id, 'chat');
    
    pendingSaveRef.current = setTimeout(async () => {
      try {
        await upsertReview.mutateAsync({
          review: {
            trade_id: trade.id,
            playbook_id: playbook.id,
            journal_conversation: messages as any,
          },
          silent: true,
        });
        unregisterPendingSave(trade.id, 'chat');
      } catch (error) {
        console.error('Failed to save conversation:', error);
        unregisterPendingSave(trade.id, 'chat');
      }
    }, 1000); // Debounce for 1 second
    
    return () => {
      if (pendingSaveRef.current) {
        clearTimeout(pendingSaveRef.current);
      }
    };
  }, [messages, hasLoadedConversation, trade.id, playbook.id, registerPendingSave, unregisterPendingSave]);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      if (pendingSaveRef.current) {
        clearTimeout(pendingSaveRef.current);
        // Synchronously save before unmount
        if (messages.length > 1) {
          upsertReview.mutate({
            review: {
              trade_id: trade.id,
              playbook_id: playbook.id,
              journal_conversation: messages as any,
            },
            silent: true,
          });
        }
        unregisterPendingSave(trade.id, 'chat');
      }
    };
  }, [messages, trade.id, playbook.id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Setup speech recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0].transcript)
          .join('');
        setInput(transcript);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current.onerror = () => {
        setIsListening(false);
      };
    }
  }, []);

  const toggleVoiceInput = useCallback(() => {
    if (!recognitionRef.current) {
      toast.error("Voice input not supported in this browser");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      recognitionRef.current.start();
      setIsListening(true);
    }
  }, [isListening]);

  const saveExtractedData = useCallback(async (data: Record<string, any>) => {
    if (!data || Object.keys(data).length === 0) return;

    const newSavedData = { ...savedData, ...data };
    setSavedData(newSavedData);

    try {
      const reviewData: any = {
        trade_id: trade.id,
        playbook_id: playbook.id,
      };

      if (newSavedData.emotional_state_before) {
        reviewData.emotional_state_before = newSavedData.emotional_state_before;
      }
      if (newSavedData.regime) {
        reviewData.regime = newSavedData.regime;
      }
      if (newSavedData.psychology_notes) {
        reviewData.psychology_notes = newSavedData.psychology_notes;
      }
      if (newSavedData.thoughts) {
        reviewData.thoughts = newSavedData.thoughts;
      }

      await upsertReview.mutateAsync({ review: reviewData, silent: true });
    } catch (error) {
      console.error('Failed to save journal data:', error);
    }
  }, [savedData, trade.id, playbook.id, upsertReview]);

  const sendMessage = useCallback(async (messageText: string) => {
    if (!messageText.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: messageText };
    
    // Build full history including the new user message
    const fullHistory = [...messages, userMessage];
    
    setMessages(fullHistory);
    setInput("");
    setIsLoading(true);
    setQuickResponses([]);
    setShouldUploadScreenshot(false);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/live-journal-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            message: messageText,
            conversationHistory: fullHistory, // Send full history including current message
            trade: {
              id: trade.id,
              symbol: trade.symbol,
              direction: trade.direction,
              entry_price: trade.entry_price,
              total_lots: trade.total_lots,
              sl_initial: trade.sl_initial,
              tp_initial: trade.tp_initial,
              entry_time: trade.entry_time,
              playbook_name: playbook.name,
              playbook_id: playbook.id,
            },
            playbook: {
              name: playbook.name,
              confirmation_rules: playbook.confirmation_rules,
              invalidation_rules: playbook.invalidation_rules,
              management_rules: playbook.management_rules,
              failure_modes: playbook.failure_modes,
              session_filter: playbook.session_filter,
            },
            isFirstMessage: messages.length <= 1,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to get response');
      }

      const data = await response.json();
      
      // Add assistant response to messages
      const assistantMessage: Message = { role: 'assistant', content: data.message };
      setMessages(prev => [...prev, assistantMessage]);
      
      if (data.quickResponses?.length) {
        setQuickResponses(data.quickResponses);
      }
      
      if (data.shouldUploadScreenshot) {
        setShouldUploadScreenshot(true);
      }

      if (data.extractedData) {
        await saveExtractedData(data.extractedData);
      }

    } catch (error) {
      console.error('Chat error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to send message');
      // Remove the failed user message
      setMessages(messages);
    } finally {
      setIsLoading(false);
    }
  }, [messages, trade, playbook, isLoading, saveExtractedData]);

  const handleScreenshotUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const url = await uploadScreenshot(file, trade.id, 'trade');
      if (url) {
        // Get existing screenshots from review and append as simple URL strings
        const existingScreenshots = trade.review?.screenshots || [];
        // Normalize to string array - extract URLs from objects if needed
        const normalizedExisting = existingScreenshots.map((s: any) => 
          typeof s === 'string' ? s : s.url || s
        ).filter(Boolean) as string[];
        const updatedScreenshots = [...normalizedExisting, url];

        await upsertReview.mutateAsync({
          review: {
            trade_id: trade.id,
            playbook_id: playbook.id,
            screenshots: updatedScreenshots,
          },
          silent: true,
        });

        toast.success("Screenshot uploaded!");
        sendMessage("I've uploaded a screenshot of my setup");
      }
    } catch (error) {
      toast.error("Failed to upload screenshot");
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const resetChat = () => {
    const initialContent = INITIAL_MESSAGE
      .replace('{{symbol}}', trade.symbol)
      .replace('{{direction}}', trade.direction.toUpperCase())
      .replace('{{playbook}}', playbook.name);
    
    setMessages([{ role: 'assistant', content: initialContent }]);
    setQuickResponses(['Focused', 'Calm', 'Confident', 'Anxious', 'FOMO']);
    setShouldUploadScreenshot(false);
    setSavedData({});
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <span className="text-sm font-medium">Journal Assistant</span>
        </div>
        <div className="flex items-center gap-2">
          {Object.keys(savedData).length > 0 && (
            <Badge variant="outline" className="text-xs bg-profit/10 text-profit border-profit/30">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Saving
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={resetChat}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 py-3" ref={scrollRef}>
        <div className="space-y-3 pr-2">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                msg.role === 'user' ? "justify-end" : "justify-start"
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                  msg.role === 'user'
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50"
                )}
              >
                <FormattedMessage content={msg.content} />
              </div>
            </div>
          ))}
          
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted/50 rounded-xl px-3 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Quick Responses */}
      {quickResponses.length > 0 && !isLoading && (
        <div className="flex flex-wrap gap-1.5 py-2 border-t border-border/50">
          {quickResponses.map((response) => (
            <Button
              key={response}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => sendMessage(response)}
            >
              {response}
            </Button>
          ))}
        </div>
      )}

      {/* Screenshot Upload Prompt (shows when AI requests) */}
      {shouldUploadScreenshot && !isLoading && (
        <div className="py-2 border-t border-border/50">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
            Upload Screenshot
          </Button>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleScreenshotUpload}
      />

      {/* Input */}
      <div className="flex gap-2 pt-3 border-t border-border/50">
        {/* Persistent screenshot button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          title="Upload screenshot"
        >
          {isUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImageIcon className="h-4 w-4" />
          )}
        </Button>
        
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-9 w-9 shrink-0",
            isListening && "bg-loss/10 text-loss"
          )}
          onClick={toggleVoiceInput}
        >
          {isListening ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </Button>
        
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type or speak..."
          className="min-h-[36px] max-h-[100px] resize-none text-sm"
          rows={1}
        />
        
        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || isLoading}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// Simple markdown-like formatting
function FormattedMessage({ content }: { content: string }) {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </span>
  );
}
