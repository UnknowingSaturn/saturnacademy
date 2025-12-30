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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { 
  Plus, 
  Trash2, 
  ArrowRight, 
  AlertCircle, 
  MoreHorizontal,
  Sparkles,
  Upload,
  Loader2 
} from 'lucide-react';
import { 
  useSymbolMappings, 
  useCreateSymbolMapping, 
  useUpdateSymbolMapping,
  useDeleteSymbolMapping 
} from '@/hooks/useCopier';
import { SYMBOL_MAPPING_PRESETS } from '@/lib/copierConfigGenerator';
import type { Account } from '@/types/trading';

interface SymbolMappingsPanelProps {
  masterAccount?: Account;
  receiverAccounts: Account[];
}

export function SymbolMappingsPanel({ masterAccount, receiverAccounts }: SymbolMappingsPanelProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = React.useState(false);
  const [newMapping, setNewMapping] = React.useState({
    master_symbol: '',
    receiver_symbol: '',
    receiver_account_id: '',
  });
  
  const { data: mappings, isLoading } = useSymbolMappings(masterAccount?.id);
  const createMapping = useCreateSymbolMapping();
  const updateMapping = useUpdateSymbolMapping();
  const deleteMapping = useDeleteSymbolMapping();
  
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
    
    // Apply to first receiver (user can modify later)
    const receiverId = receiverAccounts[0].id;
    
    Object.entries(preset).forEach(([masterSymbol, receiverSymbol]) => {
      createMapping.mutate({
        master_account_id: masterAccount.id,
        receiver_account_id: receiverId,
        master_symbol: masterSymbol,
        receiver_symbol: receiverSymbol,
        is_enabled: true,
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
    <div className="space-y-4">
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
                  Map a symbol from the master account to a receiver account
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
                      {receiverAccounts.map(acc => (
                        <SelectItem key={acc.id} value={acc.id}>
                          {acc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="grid grid-cols-[1fr,auto,1fr] gap-2 items-center">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Master Symbol</label>
                    <Input
                      placeholder="e.g., USTEC.cash"
                      value={newMapping.master_symbol}
                      onChange={(e) => setNewMapping(prev => ({ ...prev, master_symbol: e.target.value }))}
                    />
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground mt-6" />
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Receiver Symbol</label>
                    <Input
                      placeholder="e.g., USTEC"
                      value={newMapping.receiver_symbol}
                      onChange={(e) => setNewMapping(prev => ({ ...prev, receiver_symbol: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={createMapping.isPending}>
                  {createMapping.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Add Mapping
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Sparkles className="h-4 w-4 mr-2" />
                Apply Preset
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
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
