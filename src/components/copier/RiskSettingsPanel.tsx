import * as React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { AlertCircle, Shield, Loader2, CheckCircle, Info } from 'lucide-react';
import { 
  useReceiverSettings, 
  useUpsertReceiverSettings,
  DEFAULT_RECEIVER_SETTINGS,
  PROP_FIRM_SAFE_PRESET 
} from '@/hooks/useCopier';
import type { Account } from '@/types/trading';
import type { RiskMode, CopierReceiverSettings } from '@/types/copier';

interface RiskSettingsPanelProps {
  receiverAccounts: Account[];
}

const RISK_MODE_INFO: Record<RiskMode, { label: string; description: string }> = {
  balance_multiplier: {
    label: 'Balance Multiplier',
    description: 'Multiply master lot size by (receiver balance / master balance) × value',
  },
  fixed_lot: {
    label: 'Fixed Lot',
    description: 'Always use this fixed lot size regardless of master size',
  },
  risk_dollar: {
    label: 'Fixed $ Risk',
    description: 'Risk this fixed dollar amount per trade',
  },
  risk_percent: {
    label: 'Risk Percentage',
    description: 'Risk this percentage of account balance per trade',
  },
  intent: {
    label: 'Intent Mode',
    description: 'Calculate lot size from master SL distance and your risk settings',
  },
};

const SESSION_OPTIONS = [
  { value: 'tokyo', label: 'Tokyo' },
  { value: 'london', label: 'London' },
  { value: 'new_york_am', label: 'NY AM' },
  { value: 'new_york_pm', label: 'NY PM' },
  { value: 'overlap_london_ny', label: 'London/NY Overlap' },
];

export function RiskSettingsPanel({ receiverAccounts }: RiskSettingsPanelProps) {
  if (receiverAccounts.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>No receiver accounts</p>
        <p className="text-sm">Add receiver accounts to configure risk settings</p>
      </div>
    );
  }
  
  return (
    <Accordion type="single" collapsible className="space-y-4">
      {receiverAccounts.map(account => (
        <AccordionItem key={account.id} value={account.id} className="border rounded-lg">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">{account.name}</span>
              <Badge variant="outline" className="ml-2">
                {account.broker || 'No broker'}
              </Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <ReceiverSettingsForm account={account} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function ReceiverSettingsForm({ account }: { account: Account }) {
  const { data: settingsData, isLoading } = useReceiverSettings(account.id);
  const upsertSettings = useUpsertReceiverSettings();
  
  const existingSettings = settingsData?.[0];
  
  const [settings, setSettings] = React.useState<Partial<CopierReceiverSettings>>({
    ...DEFAULT_RECEIVER_SETTINGS,
    ...existingSettings,
  });
  
  React.useEffect(() => {
    if (existingSettings) {
      setSettings(prev => ({ ...prev, ...existingSettings }));
    }
  }, [existingSettings]);
  
  const handleSave = () => {
    upsertSettings.mutate({
      receiver_account_id: account.id,
      risk_mode: settings.risk_mode || 'balance_multiplier',
      risk_value: settings.risk_value || 1.0,
      max_slippage_pips: settings.max_slippage_pips || 3.0,
      max_daily_loss_r: settings.max_daily_loss_r || 3.0,
      allowed_sessions: settings.allowed_sessions || [],
      manual_confirm_mode: settings.manual_confirm_mode || false,
      prop_firm_safe_mode: settings.prop_firm_safe_mode || false,
      poll_interval_ms: settings.poll_interval_ms || 1000,
    });
  };
  
  const handleApplyPropFirmPreset = () => {
    setSettings(prev => ({ ...prev, ...PROP_FIRM_SAFE_PRESET }));
  };
  
  const toggleSession = (session: string) => {
    const current = settings.allowed_sessions || [];
    const updated = current.includes(session)
      ? current.filter(s => s !== session)
      : [...current, session];
    setSettings(prev => ({ ...prev, allowed_sessions: updated }));
  };
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      {/* Quick Preset */}
      <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Prop Firm Safe Mode</span>
        </div>
        <Button variant="outline" size="sm" onClick={handleApplyPropFirmPreset}>
          Apply Preset
        </Button>
      </div>
      
      {/* Risk Mode */}
      <div className="space-y-3">
        <Label>Risk Calculation Mode</Label>
        <Select
          value={settings.risk_mode}
          onValueChange={(v) => setSettings(prev => ({ ...prev, risk_mode: v as RiskMode }))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(RISK_MODE_INFO).map(([mode, info]) => (
              <SelectItem key={mode} value={mode}>
                <div>
                  <div className="font-medium">{info.label}</div>
                  <div className="text-xs text-muted-foreground">{info.description}</div>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <div className="flex items-center gap-2">
          <Input
            type="number"
            step="0.1"
            min="0.01"
            value={settings.risk_value}
            onChange={(e) => setSettings(prev => ({ ...prev, risk_value: parseFloat(e.target.value) || 1 }))}
            className="w-32"
          />
          <span className="text-sm text-muted-foreground">
            {settings.risk_mode === 'risk_percent' ? '%' : 
             settings.risk_mode === 'risk_dollar' ? '$' : 
             settings.risk_mode === 'fixed_lot' ? 'lots' : 'multiplier'}
          </span>
        </div>
      </div>
      
      {/* Safety Controls */}
      <div className="space-y-4">
        <h4 className="font-medium flex items-center gap-2">
          <Shield className="h-4 w-4" />
          Safety Controls
        </h4>
        
        {/* Max Slippage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Max Slippage</Label>
            <span className="text-sm text-muted-foreground">{settings.max_slippage_pips} pips</span>
          </div>
          <Slider
            value={[settings.max_slippage_pips || 3]}
            min={0.5}
            max={10}
            step={0.5}
            onValueChange={([v]) => setSettings(prev => ({ ...prev, max_slippage_pips: v }))}
          />
        </div>
        
        {/* Max Daily Loss */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Max Daily Loss</Label>
            <span className="text-sm text-muted-foreground">{settings.max_daily_loss_r}R</span>
          </div>
          <Slider
            value={[settings.max_daily_loss_r || 3]}
            min={1}
            max={10}
            step={0.5}
            onValueChange={([v]) => setSettings(prev => ({ ...prev, max_daily_loss_r: v }))}
          />
        </div>
        
        {/* Poll Interval */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Poll Interval</Label>
            <span className="text-sm text-muted-foreground">{settings.poll_interval_ms}ms</span>
          </div>
          <Slider
            value={[settings.poll_interval_ms || 1000]}
            min={500}
            max={5000}
            step={100}
            onValueChange={([v]) => setSettings(prev => ({ ...prev, poll_interval_ms: v }))}
          />
        </div>
        
        {/* Session Filter */}
        <div className="space-y-2">
          <Label>Allowed Sessions</Label>
          <div className="flex flex-wrap gap-2">
            {SESSION_OPTIONS.map(session => {
              const isActive = settings.allowed_sessions?.includes(session.value);
              return (
                <Badge
                  key={session.value}
                  variant={isActive ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleSession(session.value)}
                >
                  {isActive && <CheckCircle className="h-3 w-3 mr-1" />}
                  {session.label}
                </Badge>
              );
            })}
          </div>
        </div>
        
        {/* Toggles */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Manual Confirm Mode</Label>
              <p className="text-xs text-muted-foreground">Show confirmation dialog before each trade</p>
            </div>
            <Switch
              checked={settings.manual_confirm_mode}
              onCheckedChange={(v) => setSettings(prev => ({ ...prev, manual_confirm_mode: v }))}
            />
          </div>
          
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Prop Firm Safe Mode</Label>
              <p className="text-xs text-muted-foreground">Enable conservative defaults for prop accounts</p>
            </div>
            <Switch
              checked={settings.prop_firm_safe_mode}
              onCheckedChange={(v) => setSettings(prev => ({ ...prev, prop_firm_safe_mode: v }))}
            />
          </div>
        </div>
      </div>
      
      {/* Save Button */}
      <Button onClick={handleSave} disabled={upsertSettings.isPending} className="w-full">
        {upsertSettings.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        Save Settings
      </Button>
    </div>
  );
}
