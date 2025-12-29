import { useState } from "react";
import { usePlaybooks, useCreatePlaybook, useUpdatePlaybook, useDeletePlaybook } from "@/hooks/usePlaybooks";
import { usePlaybookStats } from "@/hooks/usePlaybookStats";
import { Playbook, ChecklistQuestion, SessionType, RegimeType, EntryZoneRules } from "@/types/trading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Plus, Edit, Trash2, GripVertical, Loader2, X, BookOpen, Target, AlertTriangle, Cog, Sparkles, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlaybookAIChat } from "@/components/playbooks/PlaybookAIChat";
import { PlaybookStatsCard } from "@/components/playbooks/PlaybookStatsCard";

const SESSIONS: { value: SessionType; label: string }[] = [
  { value: "new_york_am", label: "New York AM" },
  { value: "london", label: "London" },
  { value: "tokyo", label: "Tokyo" },
  { value: "new_york_pm", label: "New York PM" },
  { value: "off_hours", label: "Off Hours" },
];

const REGIMES: { value: RegimeType; label: string }[] = [
  { value: "rotational", label: "Rotational" },
  { value: "transitional", label: "Transitional" },
];

export default function Playbooks() {
  const { data: playbooks, isLoading } = usePlaybooks();
  const { data: allStats, isLoading: statsLoading } = usePlaybookStats();
  const createPlaybook = useCreatePlaybook();
  const updatePlaybook = useUpdatePlaybook();
  const deletePlaybook = useDeletePlaybook();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<Playbook | null>(null);
  const [showAIChat, setShowAIChat] = useState(false);

  // Basic info state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  
  // Checklist state
  const [questions, setQuestions] = useState<ChecklistQuestion[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  
  // Filter state
  const [sessionFilter, setSessionFilter] = useState<SessionType[]>([]);
  const [symbolFilter, setSymbolFilter] = useState<string[]>([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [validRegimes, setValidRegimes] = useState<RegimeType[]>([]);
  
  // Entry zone rules
  const [entryZoneEnabled, setEntryZoneEnabled] = useState(false);
  const [minPercentile, setMinPercentile] = useState(25);
  const [maxPercentile, setMaxPercentile] = useState(75);
  const [requireHtfAlignment, setRequireHtfAlignment] = useState(false);
  
  // Rule lists
  const [confirmationRules, setConfirmationRules] = useState<string[]>([]);
  const [invalidationRules, setInvalidationRules] = useState<string[]>([]);
  const [managementRules, setManagementRules] = useState<string[]>([]);
  const [failureModes, setFailureModes] = useState<string[]>([]);
  const [newRule, setNewRule] = useState({ confirmation: "", invalidation: "", management: "", failure: "" });

  // Risk limit state
  const [maxRPerTrade, setMaxRPerTrade] = useState<number | null>(null);
  const [maxDailyLossR, setMaxDailyLossR] = useState<number | null>(null);
  const [maxTradesPerSession, setMaxTradesPerSession] = useState<number | null>(null);

  const resetForm = () => {
    setName("");
    setDescription("");
    setQuestions([]);
    setNewQuestion("");
    setSessionFilter([]);
    setSymbolFilter([]);
    setNewSymbol("");
    setValidRegimes([]);
    setEntryZoneEnabled(false);
    setMinPercentile(25);
    setMaxPercentile(75);
    setRequireHtfAlignment(false);
    setConfirmationRules([]);
    setInvalidationRules([]);
    setManagementRules([]);
    setFailureModes([]);
    setNewRule({ confirmation: "", invalidation: "", management: "", failure: "" });
    setMaxRPerTrade(null);
    setMaxDailyLossR(null);
    setMaxTradesPerSession(null);
    setEditingPlaybook(null);
    setShowAIChat(false);
  };

  const openEditDialog = (playbook: Playbook) => {
    setEditingPlaybook(playbook);
    setName(playbook.name);
    setDescription(playbook.description || "");
    setQuestions(playbook.checklist_questions);
    setSessionFilter(playbook.session_filter || []);
    setSymbolFilter(playbook.symbol_filter || []);
    setValidRegimes(playbook.valid_regimes || []);
    
    const ezr = playbook.entry_zone_rules || {};
    setEntryZoneEnabled(ezr.min_percentile != null || ezr.max_percentile != null);
    setMinPercentile(ezr.min_percentile ?? 25);
    setMaxPercentile(ezr.max_percentile ?? 75);
    setRequireHtfAlignment(ezr.require_htf_alignment ?? false);
    
    setConfirmationRules(playbook.confirmation_rules || []);
    setInvalidationRules(playbook.invalidation_rules || []);
    setManagementRules(playbook.management_rules || []);
    setFailureModes(playbook.failure_modes || []);
    
    setMaxRPerTrade(playbook.max_r_per_trade);
    setMaxDailyLossR(playbook.max_daily_loss_r);
    setMaxTradesPerSession(playbook.max_trades_per_session);
    
    setIsDialogOpen(true);
  };

  const openNewDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const addQuestion = () => {
    if (!newQuestion.trim()) return;
    const question: ChecklistQuestion = {
      id: crypto.randomUUID(),
      question: newQuestion.trim(),
      order: questions.length,
    };
    setQuestions([...questions, question]);
    setNewQuestion("");
  };

  const removeQuestion = (id: string) => {
    setQuestions(questions.filter(q => q.id !== id).map((q, i) => ({ ...q, order: i })));
  };

  const addSymbol = () => {
    if (!newSymbol.trim()) return;
    setSymbolFilter([...symbolFilter, newSymbol.trim().toUpperCase()]);
    setNewSymbol("");
  };

  const addRule = (type: "confirmation" | "invalidation" | "management" | "failure") => {
    const value = newRule[type].trim();
    if (!value) return;
    
    if (type === "confirmation") setConfirmationRules([...confirmationRules, value]);
    else if (type === "invalidation") setInvalidationRules([...invalidationRules, value]);
    else if (type === "management") setManagementRules([...managementRules, value]);
    else setFailureModes([...failureModes, value]);
    
    setNewRule({ ...newRule, [type]: "" });
  };

  const removeRule = (type: "confirmation" | "invalidation" | "management" | "failure", index: number) => {
    if (type === "confirmation") setConfirmationRules(confirmationRules.filter((_, i) => i !== index));
    else if (type === "invalidation") setInvalidationRules(invalidationRules.filter((_, i) => i !== index));
    else if (type === "management") setManagementRules(managementRules.filter((_, i) => i !== index));
    else setFailureModes(failureModes.filter((_, i) => i !== index));
  };

  const handleApplyAISuggestions = (suggestions: any) => {
    if (suggestions.name && !name) setName(suggestions.name);
    if (suggestions.description && !description) setDescription(suggestions.description);
    if (suggestions.session_filter?.length) {
      setSessionFilter(suggestions.session_filter.filter((s: string) => 
        SESSIONS.some(sess => sess.value === s)
      ) as SessionType[]);
    }
    if (suggestions.symbol_filter?.length) setSymbolFilter(suggestions.symbol_filter);
    if (suggestions.valid_regimes?.length) {
      setValidRegimes(suggestions.valid_regimes.filter((r: string) => 
        REGIMES.some(reg => reg.value === r)
      ) as RegimeType[]);
    }
    if (suggestions.entry_zone_rules) {
      const ezr = suggestions.entry_zone_rules;
      if (ezr.min_percentile != null || ezr.max_percentile != null) {
        setEntryZoneEnabled(true);
        if (ezr.min_percentile != null) setMinPercentile(ezr.min_percentile);
        if (ezr.max_percentile != null) setMaxPercentile(ezr.max_percentile);
        if (ezr.require_htf_alignment != null) setRequireHtfAlignment(ezr.require_htf_alignment);
      }
    }
    if (suggestions.confirmation_rules?.length) {
      setConfirmationRules(prev => [...new Set([...prev, ...suggestions.confirmation_rules])]);
    }
    if (suggestions.invalidation_rules?.length) {
      setInvalidationRules(prev => [...new Set([...prev, ...suggestions.invalidation_rules])]);
    }
    if (suggestions.management_rules?.length) {
      setManagementRules(prev => [...new Set([...prev, ...suggestions.management_rules])]);
    }
    if (suggestions.failure_modes?.length) {
      setFailureModes(prev => [...new Set([...prev, ...suggestions.failure_modes])]);
    }
    if (suggestions.checklist_questions?.length) {
      const newQuestions = suggestions.checklist_questions.map((q: string, i: number) => ({
        id: crypto.randomUUID(),
        question: q,
        order: questions.length + i,
      }));
      setQuestions(prev => [...prev, ...newQuestions].slice(0, 5));
    }
    if (suggestions.max_r_per_trade != null) setMaxRPerTrade(suggestions.max_r_per_trade);
    if (suggestions.max_daily_loss_r != null) setMaxDailyLossR(suggestions.max_daily_loss_r);
    if (suggestions.max_trades_per_session != null) setMaxTradesPerSession(suggestions.max_trades_per_session);
  };

  const handleSave = async () => {
    if (!name.trim()) return;

    const entryZoneRules: EntryZoneRules = entryZoneEnabled
      ? { min_percentile: minPercentile, max_percentile: maxPercentile, require_htf_alignment: requireHtfAlignment }
      : {};

    const playbookData = {
      name: name.trim(),
      description: description.trim() || null,
      checklist_questions: questions,
      is_active: true,
      session_filter: sessionFilter.length > 0 ? sessionFilter : null,
      symbol_filter: symbolFilter.length > 0 ? symbolFilter : null,
      valid_regimes: validRegimes,
      entry_zone_rules: entryZoneRules,
      confirmation_rules: confirmationRules,
      invalidation_rules: invalidationRules,
      management_rules: managementRules,
      failure_modes: failureModes,
      max_r_per_trade: maxRPerTrade,
      max_daily_loss_r: maxDailyLossR,
      max_trades_per_session: maxTradesPerSession,
    };

    if (editingPlaybook) {
      await updatePlaybook.mutateAsync({ id: editingPlaybook.id, ...playbookData });
    } else {
      await createPlaybook.mutateAsync(playbookData);
    }

    setIsDialogOpen(false);
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (confirm("Are you sure you want to delete this playbook?")) {
      await deletePlaybook.mutateAsync(id);
    }
  };

  const toggleSession = (session: SessionType) => {
    setSessionFilter(prev => 
      prev.includes(session) ? prev.filter(s => s !== session) : [...prev, session]
    );
  };

  const toggleRegime = (regime: RegimeType) => {
    setValidRegimes(prev => 
      prev.includes(regime) ? prev.filter(r => r !== regime) : [...prev, regime]
    );
  };

  const currentPlaybook = {
    name, description, session_filter: sessionFilter, symbol_filter: symbolFilter,
    valid_regimes: validRegimes, entry_zone_rules: entryZoneEnabled ? { min_percentile: minPercentile, max_percentile: maxPercentile } : {},
    confirmation_rules: confirmationRules, invalidation_rules: invalidationRules,
    management_rules: managementRules, failure_modes: failureModes,
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Playbooks</h1>
          <p className="text-muted-foreground">Define your trading strategies and rules for AI analysis</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNewDialog} className="gap-2">
              <Plus className="w-4 h-4" />
              New Playbook
            </Button>
          </DialogTrigger>
          <DialogContent className={cn(
            "max-h-[85vh] overflow-hidden flex flex-col",
            showAIChat ? "max-w-4xl" : "max-w-2xl"
          )}>
            <DialogHeader className="flex-shrink-0">
              <div className="flex items-center justify-between">
                <DialogTitle>{editingPlaybook ? "Edit Playbook" : "Create Playbook"}</DialogTitle>
                <Button
                  variant={showAIChat ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowAIChat(!showAIChat)}
                  className="gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  AI Assistant
                </Button>
              </div>
            </DialogHeader>
            
            <div className={cn(
              "flex-1 min-h-0 overflow-hidden",
              showAIChat ? "grid grid-cols-2 gap-4" : ""
            )}>
              <div className="overflow-y-auto pr-2 min-h-0">
                <Tabs defaultValue="basic" className="w-full">
                  <TabsList className="grid w-full grid-cols-5">
                    <TabsTrigger value="basic" className="text-xs">
                      <BookOpen className="w-3 h-3 mr-1" />
                      Basic
                    </TabsTrigger>
                    <TabsTrigger value="filters" className="text-xs">
                      <Target className="w-3 h-3 mr-1" />
                      Filters
                    </TabsTrigger>
                    <TabsTrigger value="rules" className="text-xs">
                      <Cog className="w-3 h-3 mr-1" />
                      Rules
                    </TabsTrigger>
                    <TabsTrigger value="failures" className="text-xs">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Failures
                    </TabsTrigger>
                    <TabsTrigger value="limits" className="text-xs">
                      <ShieldCheck className="w-3 h-3 mr-1" />
                      Limits
                    </TabsTrigger>
                  </TabsList>

                  {/* Basic Tab */}
                  <TabsContent value="basic" className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name</Label>
                      <Input 
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g., London Rotation Trade"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description</Label>
                      <Textarea 
                        id="description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe when to use this playbook..."
                        rows={2}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Checklist Questions (max 5)</Label>
                      <div className="space-y-2">
                        {questions.map((q, i) => (
                          <div key={q.id} className="flex items-center gap-2 p-2 bg-muted rounded-md">
                            <GripVertical className="w-4 h-4 text-muted-foreground" />
                            <span className="flex-1 text-sm">{q.question}</span>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-6 w-6"
                              onClick={() => removeQuestion(q.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      {questions.length < 5 && (
                        <div className="flex gap-2">
                          <Input 
                            value={newQuestion}
                            onChange={(e) => setNewQuestion(e.target.value)}
                            placeholder="Add a yes/no question..."
                            onKeyDown={(e) => e.key === "Enter" && addQuestion()}
                          />
                          <Button variant="outline" onClick={addQuestion}>
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </TabsContent>

                  {/* Filters Tab */}
                  <TabsContent value="filters" className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label>Valid Sessions</Label>
                      <div className="flex flex-wrap gap-2">
                        {SESSIONS.map(s => (
                          <Badge
                            key={s.value}
                            variant={sessionFilter.includes(s.value) ? "default" : "outline"}
                            className="cursor-pointer"
                            onClick={() => toggleSession(s.value)}
                          >
                            {s.label}
                          </Badge>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">Leave empty for any session</p>
                    </div>

                    <div className="space-y-2">
                      <Label>Valid Regimes</Label>
                      <div className="flex flex-wrap gap-2">
                        {REGIMES.map(r => (
                          <Badge
                            key={r.value}
                            variant={validRegimes.includes(r.value) ? "default" : "outline"}
                            className="cursor-pointer"
                            onClick={() => toggleRegime(r.value)}
                          >
                            {r.label}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Symbol Filter</Label>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {symbolFilter.map((sym, i) => (
                          <Badge key={i} variant="secondary" className="gap-1">
                            {sym}
                            <X className="w-3 h-3 cursor-pointer" onClick={() => setSymbolFilter(symbolFilter.filter((_, idx) => idx !== i))} />
                          </Badge>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input 
                          value={newSymbol}
                          onChange={(e) => setNewSymbol(e.target.value)}
                          placeholder="e.g., EURUSD"
                          onKeyDown={(e) => e.key === "Enter" && addSymbol()}
                        />
                        <Button variant="outline" onClick={addSymbol}>
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-4 p-4 border rounded-lg">
                      <div className="flex items-center justify-between">
                        <Label>Entry Zone Rules</Label>
                        <Switch checked={entryZoneEnabled} onCheckedChange={setEntryZoneEnabled} />
                      </div>
                      {entryZoneEnabled && (
                        <>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span>Entry Percentile Range</span>
                              <span className="font-mono">{minPercentile}% - {maxPercentile}%</span>
                            </div>
                            <div className="px-2">
                              <Slider
                                value={[minPercentile, maxPercentile]}
                                onValueChange={([min, max]) => { setMinPercentile(min); setMaxPercentile(max); }}
                                min={0}
                                max={100}
                                step={5}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground">Entry should be within this range of the SL-TP distance</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Checkbox 
                              id="htf" 
                              checked={requireHtfAlignment} 
                              onCheckedChange={(c) => setRequireHtfAlignment(!!c)} 
                            />
                            <Label htmlFor="htf" className="text-sm">Require HTF bias alignment</Label>
                          </div>
                        </>
                      )}
                    </div>
                  </TabsContent>

                  {/* Rules Tab */}
                  <TabsContent value="rules" className="space-y-4 pt-4">
                    {/* Confirmation Rules */}
                    <div className="space-y-2">
                      <Label className="text-profit">Confirmation Requirements</Label>
                      <div className="space-y-1">
                        {confirmationRules.map((rule, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm bg-profit/5 px-3 py-1.5 rounded border border-profit/20">
                            <span className="flex-1">{rule}</span>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeRule("confirmation", i)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input 
                          value={newRule.confirmation}
                          onChange={(e) => setNewRule({ ...newRule, confirmation: e.target.value })}
                          placeholder="e.g., Wait for candle close above level"
                          onKeyDown={(e) => e.key === "Enter" && addRule("confirmation")}
                        />
                        <Button variant="outline" size="icon" onClick={() => addRule("confirmation")}>
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Invalidation Rules */}
                    <div className="space-y-2">
                      <Label className="text-loss">Invalidation Conditions</Label>
                      <div className="space-y-1">
                        {invalidationRules.map((rule, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm bg-loss/5 px-3 py-1.5 rounded border border-loss/20">
                            <span className="flex-1">{rule}</span>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeRule("invalidation", i)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input 
                          value={newRule.invalidation}
                          onChange={(e) => setNewRule({ ...newRule, invalidation: e.target.value })}
                          placeholder="e.g., Close below support invalidates setup"
                          onKeyDown={(e) => e.key === "Enter" && addRule("invalidation")}
                        />
                        <Button variant="outline" size="icon" onClick={() => addRule("invalidation")}>
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    {/* Management Rules */}
                    <div className="space-y-2">
                      <Label>Trade Management</Label>
                      <div className="space-y-1">
                        {managementRules.map((rule, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm bg-muted px-3 py-1.5 rounded">
                            <span className="flex-1">{rule}</span>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeRule("management", i)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input 
                          value={newRule.management}
                          onChange={(e) => setNewRule({ ...newRule, management: e.target.value })}
                          placeholder="e.g., Move SL to BE after 1R"
                          onKeyDown={(e) => e.key === "Enter" && addRule("management")}
                        />
                        <Button variant="outline" size="icon" onClick={() => addRule("management")}>
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Failure Modes Tab */}
                  <TabsContent value="failures" className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label>Known Failure Modes</Label>
                      <p className="text-xs text-muted-foreground">Document common ways this setup fails so AI can identify patterns</p>
                      <div className="space-y-1">
                        {failureModes.map((mode, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm bg-destructive/5 px-3 py-1.5 rounded border border-destructive/20">
                            <AlertTriangle className="w-3 h-3 text-destructive flex-shrink-0" />
                            <span className="flex-1">{mode}</span>
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeRule("failure", i)}>
                              <X className="w-3 h-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input 
                          value={newRule.failure}
                          onChange={(e) => setNewRule({ ...newRule, failure: e.target.value })}
                          placeholder="e.g., Entering on extended moves without retracement"
                          onKeyDown={(e) => e.key === "Enter" && addRule("failure")}
                        />
                        <Button variant="outline" size="icon" onClick={() => addRule("failure")}>
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </TabsContent>

                  {/* Risk Limits Tab */}
                  <TabsContent value="limits" className="space-y-4 pt-4">
                    <p className="text-sm text-muted-foreground">
                      Set risk limits to receive alerts when you're approaching or exceeding your trading rules.
                    </p>
                    
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="maxR">Max R per Trade</Label>
                        <div className="flex items-center gap-2">
                          <Input 
                            id="maxR"
                            type="number"
                            step="0.5"
                            min="0"
                            value={maxRPerTrade ?? ""}
                            onChange={(e) => setMaxRPerTrade(e.target.value ? Number(e.target.value) : null)}
                            placeholder="e.g., 2"
                            className="w-32"
                          />
                          <span className="text-sm text-muted-foreground">R</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Alert if a trade exceeds this R-multiple</p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="maxDailyLoss">Max Daily Loss</Label>
                        <div className="flex items-center gap-2">
                          <Input 
                            id="maxDailyLoss"
                            type="number"
                            step="0.5"
                            min="0"
                            value={maxDailyLossR ?? ""}
                            onChange={(e) => setMaxDailyLossR(e.target.value ? Number(e.target.value) : null)}
                            placeholder="e.g., 3"
                            className="w-32"
                          />
                          <span className="text-sm text-muted-foreground">R</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Alert when daily loss approaches this limit</p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="maxTrades">Max Trades per Session</Label>
                        <div className="flex items-center gap-2">
                          <Input 
                            id="maxTrades"
                            type="number"
                            step="1"
                            min="1"
                            value={maxTradesPerSession ?? ""}
                            onChange={(e) => setMaxTradesPerSession(e.target.value ? Number(e.target.value) : null)}
                            placeholder="e.g., 3"
                            className="w-32"
                          />
                          <span className="text-sm text-muted-foreground">trades</span>
                        </div>
                        <p className="text-xs text-muted-foreground">Alert when you reach this trade count for the day</p>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>

                <div className="flex justify-end gap-3 pt-4 border-t mt-4">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                  <Button 
                    onClick={handleSave}
                    disabled={!name.trim() || createPlaybook.isPending || updatePlaybook.isPending}
                  >
                    {(createPlaybook.isPending || updatePlaybook.isPending) && (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    {editingPlaybook ? "Update" : "Create"}
                  </Button>
                </div>
              </div>

              {showAIChat && (
                <div className="h-full min-h-0 overflow-hidden">
                  <PlaybookAIChat 
                    onApplySuggestions={handleApplyAISuggestions}
                    currentPlaybook={currentPlaybook}
                  />
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Playbooks Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[280px] rounded-lg" />
          ))}
        </div>
      ) : playbooks?.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground mb-4">No playbooks yet</p>
          <Button onClick={openNewDialog} className="gap-2">
            <Plus className="w-4 h-4" />
            Create Your First Playbook
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {playbooks?.map((playbook) => (
            <Card key={playbook.id} className="group">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{playbook.name}</CardTitle>
                    {playbook.description && (
                      <CardDescription className="mt-1">{playbook.description}</CardDescription>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8"
                      onClick={() => openEditDialog(playbook)}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDelete(playbook.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Real-time stats */}
                <PlaybookStatsCard 
                  stats={allStats?.[playbook.id]} 
                  isLoading={statsLoading} 
                />

                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary">
                    {playbook.checklist_questions.length} questions
                  </Badge>
                  {playbook.confirmation_rules?.length > 0 && (
                    <Badge variant="outline" className="text-profit border-profit/30">
                      {playbook.confirmation_rules.length} confirmations
                    </Badge>
                  )}
                  {playbook.failure_modes?.length > 0 && (
                    <Badge variant="outline" className="text-loss border-loss/30">
                      {playbook.failure_modes.length} failure modes
                    </Badge>
                  )}
                </div>

                {/* Risk limits badges */}
                {(playbook.max_r_per_trade || playbook.max_daily_loss_r || playbook.max_trades_per_session) && (
                  <div className="flex flex-wrap gap-1">
                    {playbook.max_r_per_trade && (
                      <Badge variant="outline" className="text-xs">
                        Max {playbook.max_r_per_trade}R/trade
                      </Badge>
                    )}
                    {playbook.max_daily_loss_r && (
                      <Badge variant="outline" className="text-xs">
                        Max {playbook.max_daily_loss_r}R/day
                      </Badge>
                    )}
                    {playbook.max_trades_per_session && (
                      <Badge variant="outline" className="text-xs">
                        Max {playbook.max_trades_per_session} trades
                      </Badge>
                    )}
                  </div>
                )}
                
                {playbook.session_filter && playbook.session_filter.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {playbook.session_filter.map(s => (
                      <Badge key={s} variant="outline" className="text-xs capitalize">{s.replace('_', ' ')}</Badge>
                    ))}
                  </div>
                )}

                {playbook.checklist_questions.length > 0 && (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {playbook.checklist_questions.slice(0, 2).map((q) => (
                      <li key={q.id} className="truncate">• {q.question}</li>
                    ))}
                    {playbook.checklist_questions.length > 2 && (
                      <li className="text-xs">+{playbook.checklist_questions.length - 2} more</li>
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
