import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { 
  Plus, 
  Trash2, 
  ArrowRight, 
  AlertCircle, 
  Sparkles,
  Loader2,
  Wand2,
  TrendingUp,
  CheckCircle2,
  ChevronDown,
  Zap
} from 'lucide-react';
import { 
  useSymbolMappings, 
  useCreateSymbolMapping, 
  useUpdateSymbolMapping,
  useDeleteSymbolMapping,
  useTradedSymbols
} from '@/hooks/useCopier';
import { SYMBOL_MAPPING_PRESETS } from '@/lib/copierConfigGenerator';
import { getSuggestedSymbols, findAliasGroup } from '@/lib/symbolAliases';
import type { Account } from '@/types/trading';

interface SymbolMappingsPanelProps {
  masterAccount?: Account;
  receiverAccounts: Account[];
}

export function SymbolMappingsPanel({ masterAccount, receiverAccounts }: SymbolMappingsPanelProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
  const [showSuggestions, setShowSuggestions] = React.useState(false);
  const [newMapping, setNewMapping] = React.useState({
    master_symbol: '',
    receiver_symbol: '',
    receiver_account_id: '',
  });
  
  const { data: mappings, isLoading } = useSymbolMappings(masterAccount?.id);
  const { data: tradedSymbols, isLoading: isLoadingSymbols } = useTradedSymbols(masterAccount?.id);
  const createMapping = useCreateSymbolMapping();
  const updateMapping = useUpdateSymbolMapping();
  const deleteMapping = useDeleteSymbolMapping();

  // Get suggestions based on master symbol
  const suggestions = React.useMemo(() => {
    if (!newMapping.master_symbol) return [];
    return getSuggestedSymbols(newMapping.master_symbol);
  }, [newMapping.master_symbol]);

  // Get unmapped symbols (symbols traded but not yet mapped)
  const unmappedSymbols = React.useMemo(() => {
    if (!tradedSymbols || !mappings) return [];
    const mappedMasterSymbols = new Set(mappings.map(m => m.master_symbol.toUpperCase()));
    return tradedSymbols.filter(s => !mappedMasterSymbols.has(s.symbol.toUpperCase()));
  }, [tradedSymbols, mappings]);
  
  const handleCreate = () => {
    if (!masterAccount || !newMapping.master_symbol || !newMapping.receiver_symbol || !newMapping.receiver_account_id) {
      return;
    }
    
    createMapping.mutate({
      master_account_id: masterAccount.id,
      receiver_account_id: newMapping.receiver_account_id,
      master_symbol: newMapping.master_symbol.toUpperCase(),
      receiver_symbol: newMapping.receiver_symbol.toUpperCase(),
      is_enabled: true,
    }, {
      onSuccess: () => {
        setIsAddDialogOpen(false);
        setNewMapping({ master_symbol: '', receiver_symbol: '', receiver_account_id: '' });
      },
    });
  };

  const handleQuickMap = (masterSymbol: string) => {
    const suggested = getSuggestedSymbols(masterSymbol);
    setNewMapping({
      master_symbol: masterSymbol,
      receiver_symbol: suggested[0] || masterSymbol,
      receiver_account_id: receiverAccounts[0]?.id || '',
    });
    setIsAddDialogOpen(true);
  };

  const handleQuickMapAll = (masterSymbol: string, receiverSymbol: string) => {
    if (!masterAccount) return;
    
    // Create mapping for ALL receivers
    receiverAccounts.forEach(receiver => {
      createMapping.mutate({
        master_account_id: masterAccount.id,
        receiver_account_id: receiver.id,
        master_symbol: masterSymbol.toUpperCase(),
        receiver_symbol: receiverSymbol.toUpperCase(),
        is_enabled: true,
      });
    });
  };
  
  const handleToggle = (id: string, isEnabled: boolean) => {
    updateMapping.mutate({ id, is_enabled: isEnabled });
  };
  
  const handleDelete = (id: string) => {
    deleteMapping.mutate(id);
  };
  
  const handleApplyPreset = (presetName: string) => {
    if (!masterAccount || receiverAccounts.length === 0) return;
    
    const preset = SYMBOL_MAPPING_PRESETS[presetName];
    if (!preset) return;
    
    // Apply to ALL receivers
    receiverAccounts.forEach(receiver => {
      Object.entries(preset).forEach(([masterSymbol, receiverSymbol]) => {
        createMapping.mutate({
          master_account_id: masterAccount.id,
          receiver_account_id: receiver.id,
          master_symbol: masterSymbol,
          receiver_symbol: receiverSymbol,
          is_enabled: true,
        });
      });
    });
  };
  
  if (!masterAccount) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>Set a master account first</p>
        <p className="text-sm">Go to the Accounts tab and assign a master account</p>
      </div>
    );
  }
  
  if (receiverAccounts.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No receiver accounts</p>
        <p className="text-sm">Add receiver accounts to configure symbol mappings</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Auto-Detect Section */}
      {unmappedSymbols.length > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Symbols You Trade</CardTitle>
            </div>
            <CardDescription>
              These symbols from your trade history don't have mappings yet
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {unmappedSymbols.slice(0, 10).map(({ symbol, count }) => {
                const suggested = getSuggestedSymbols(symbol);
                const hasAlias = findAliasGroup(symbol) !== null;
                
                return (
                  <div key={symbol} className="flex items-center gap-1">
                    <Badge 
                      variant="outline" 
                      className="font-mono cursor-pointer hover:bg-primary/10"
                      onClick={() => handleQuickMap(symbol)}
                    >
                      {symbol}
                      <span className="ml-1 text-muted-foreground">({count})</span>
                    </Badge>
                    {hasAlias && suggested[0] && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => handleQuickMapAll(symbol, suggested[0])}
                        title={`Quick map to ${suggested[0]} for all receivers`}
                      >
                        <Zap className="h-3 w-3 mr-1" />
                        → {suggested[0]}
                      </Button>
                    )}
                  </div>
                );
              })}
              {unmappedSymbols.length > 10 && (
                <Badge variant="secondary">+{unmappedSymbols.length - 10} more</Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Mapping
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Symbol Mapping</DialogTitle>
                <DialogDescription>
                  Map a symbol from the master account to receiver accounts
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Receiver Account</label>
                  <Select 
                    value={newMapping.receiver_account_id}
                    onValueChange={(v) => setNewMapping(prev => ({ ...prev, receiver_account_id: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select receiver" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">
                        <span className="flex items-center gap-2">
                          <Sparkles className="h-3 w-3" />
                          All Receivers
                        </span>
                      </SelectItem>
                      <DropdownMenuSeparator />
                      {receiverAccounts.map(acc => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-end">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Master Symbol</label>
                    <Input
                      placeholder="e.g., USTEC.cash"
                      value={newMapping.master_symbol}
                      onChange={(e) => setNewMapping(prev => ({ ...prev, master_symbol: e.target.value }))}
                    />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground mb-3" />
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Receiver Symbol</label>
                    <Popover open={showSuggestions} onOpenChange={setShowSuggestions}>
                      <PopoverTrigger asChild>
                        <div className="relative">
                          <Input
                            placeholder="e.g., USTEC"
                            value={newMapping.receiver_symbol}
                            onChange={(e) => setNewMapping(prev => ({ ...prev, receiver_symbol: e.target.value }))}
                            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                          />
                          {suggestions.length > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                              onClick={() => setShowSuggestions(true)}
                            >
                              <Wand2 className="h-3 w-3 text-primary" />
                            </Button>
                          )}
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="p-0 w-[200px]" align="start">
                        <Command>
                          <CommandList>
                            <CommandGroup heading="Suggested">
                              {suggestions.slice(0, 6).map((symbol) => (
                                <CommandItem
                                  key={symbol}
                                  value={symbol}
                                  onSelect={() => {
                                    setNewMapping(prev => ({ ...prev, receiver_symbol: symbol }));
                                    setShowSuggestions(false);
                                  }}
                                >
                                  <CheckCircle2 className="h-3 w-3 mr-2 text-muted-foreground" />
                                  <span className="font-mono">{symbol}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {suggestions.length > 0 && !newMapping.receiver_symbol && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Wand2 className="h-3 w-3" />
                    Click the wand or focus the receiver field for suggestions
                  </p>
                )}
              </div>
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  onClick={() => {
                    if (newMapping.receiver_account_id === '__all__') {
                      // Create for all receivers
                      handleQuickMapAll(newMapping.master_symbol, newMapping.receiver_symbol);
                      setIsAddDialogOpen(false);
                      setNewMapping({ master_symbol: '', receiver_symbol: '', receiver_account_id: '' });
                    } else {
                      handleCreate();
                    }
                  }} 
                  disabled={createMapping.isPending}
                >
                  {createMapping.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {newMapping.receiver_account_id === '__all__' ? 'Add to All Receivers' : 'Add Mapping'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Sparkles className="h-4 w-4 mr-2" />
                Apply Preset
                <ChevronDown className="h-4 w-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                Applies to all {receiverAccounts.length} receiver{receiverAccounts.length !== 1 ? 's' : ''}
              </div>
              <DropdownMenuSeparator />
              {Object.keys(SYMBOL_MAPPING_PRESETS).map(preset => (
                <DropdownMenuItem key={preset} onClick={() => handleApplyPreset(preset)}>
                  {preset}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        
        <p className="text-sm text-muted-foreground">
          {mappings?.length || 0} mapping{(mappings?.length || 0) !== 1 ? 's' : ''}
        </p>
      </div>
      
      {/* Mappings Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : mappings && mappings.length > 0 ? (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Master Symbol</TableHead>
                <TableHead></TableHead>
                <TableHead>Receiver Symbol</TableHead>
                <TableHead>Receiver Account</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mappings.map(mapping => {
                const receiver = receiverAccounts.find(a => a.id === mapping.receiver_account_id);
                return (
                  <TableRow key={mapping.id}>
                    <TableCell className="font-mono font-medium">
                      {mapping.master_symbol}
                    </TableCell>
                    <TableCell>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                    <TableCell className="font-mono font-medium">
                      {mapping.receiver_symbol}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{receiver?.name || 'Unknown'}</Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={mapping.is_enabled}
                        onCheckedChange={(checked) => handleToggle(mapping.id, checked)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(mapping.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground border rounded-lg">
          <ArrowRight className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No symbol mappings yet</p>
          <p className="text-sm">Add mappings or apply a preset to get started</p>
        </div>
      )}
    </div>
  );
}
