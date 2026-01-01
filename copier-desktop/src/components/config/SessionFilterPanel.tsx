import { useState, useEffect } from "react";
import { Clock, Sun, Moon, Globe } from "lucide-react";

interface SessionConfig {
  allowed_sessions: string[];
  custom_start_hour?: number;
  custom_end_hour?: number;
  timezone: string;
}

interface SessionFilterPanelProps {
  config: SessionConfig;
  onChange: (config: SessionConfig) => void;
  onUseGlobal?: () => void;
  isUsingGlobal?: boolean;
}

const TRADING_SESSIONS = [
  { 
    key: "asian", 
    label: "Asian Session", 
    description: "Tokyo/Sydney (00:00-09:00 UTC)",
    icon: <Moon className="w-4 h-4" />,
    hours: "00:00 - 09:00"
  },
  { 
    key: "london", 
    label: "London Session", 
    description: "European markets (07:00-16:00 UTC)",
    icon: <Globe className="w-4 h-4" />,
    hours: "07:00 - 16:00"
  },
  { 
    key: "new_york", 
    label: "New York Session", 
    description: "US markets (12:00-21:00 UTC)",
    icon: <Sun className="w-4 h-4" />,
    hours: "12:00 - 21:00"
  },
  { 
    key: "overlap", 
    label: "London/NY Overlap", 
    description: "Highest volatility (12:00-16:00 UTC)",
    icon: <Globe className="w-4 h-4" />,
    hours: "12:00 - 16:00"
  },
];

const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "New York (EST)" },
  { value: "Europe/London", label: "London (GMT)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Singapore", label: "Singapore (SGT)" },
  { value: "Australia/Sydney", label: "Sydney (AEST)" },
];

export function SessionFilterPanel({ config, onChange, onUseGlobal, isUsingGlobal }: SessionFilterPanelProps) {
  const [localConfig, setLocalConfig] = useState<SessionConfig>(config);
  const [useCustomHours, setUseCustomHours] = useState(
    config.custom_start_hour !== undefined && config.custom_end_hour !== undefined
  );

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleToggleSession = (sessionKey: string) => {
    const sessions = localConfig.allowed_sessions.includes(sessionKey)
      ? localConfig.allowed_sessions.filter(s => s !== sessionKey)
      : [...localConfig.allowed_sessions, sessionKey];
    
    const newConfig = { ...localConfig, allowed_sessions: sessions };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  const handleSelectAll = () => {
    const newConfig = { 
      ...localConfig, 
      allowed_sessions: TRADING_SESSIONS.map(s => s.key) 
    };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  const handleClearAll = () => {
    const newConfig = { ...localConfig, allowed_sessions: [] };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  const handleCustomHoursChange = (field: 'custom_start_hour' | 'custom_end_hour', value: number) => {
    const newConfig = { ...localConfig, [field]: value };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  const handleTimezoneChange = (timezone: string) => {
    const newConfig = { ...localConfig, timezone };
    setLocalConfig(newConfig);
    onChange(newConfig);
  };

  const toggleCustomHours = () => {
    if (useCustomHours) {
      // Disable custom hours
      const newConfig = { 
        ...localConfig, 
        custom_start_hour: undefined, 
        custom_end_hour: undefined 
      };
      setLocalConfig(newConfig);
      onChange(newConfig);
    } else {
      // Enable custom hours with defaults
      const newConfig = { 
        ...localConfig, 
        custom_start_hour: 8, 
        custom_end_hour: 17 
      };
      setLocalConfig(newConfig);
      onChange(newConfig);
    }
    setUseCustomHours(!useCustomHours);
  };

  return (
    <div className="space-y-6">
      {/* Global toggle */}
      {onUseGlobal && (
        <div className="glass-card p-4 flex items-center justify-between">
          <div>
            <span className="text-sm font-medium">Use Global Settings</span>
            <p className="text-xs text-muted-foreground mt-0.5">
              Inherit session settings from global defaults
            </p>
          </div>
          <button
            onClick={onUseGlobal}
            className={`relative w-12 h-6 rounded-full transition-colors ${
              isUsingGlobal ? "bg-primary" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                isUsingGlobal ? "left-7" : "left-1"
              }`}
            />
          </button>
        </div>
      )}

      {/* Timezone Selection */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Timezone</h3>
        </div>
        <div className="glass-card p-4">
          <select
            value={localConfig.timezone}
            onChange={(e) => handleTimezoneChange(e.target.value)}
            disabled={isUsingGlobal}
            className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          >
            {TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value}>{tz.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Session Selection */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Trading Sessions</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSelectAll}
              disabled={isUsingGlobal}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              Select All
            </button>
            <span className="text-muted-foreground">|</span>
            <button
              onClick={handleClearAll}
              disabled={isUsingGlobal}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Clear
            </button>
          </div>
        </div>
        
        <div className="grid gap-2">
          {TRADING_SESSIONS.map(session => {
            const isActive = localConfig.allowed_sessions.includes(session.key);
            return (
              <button
                key={session.key}
                onClick={() => handleToggleSession(session.key)}
                disabled={isUsingGlobal}
                className={`glass-card p-4 text-left transition-all ${
                  isActive ? "border-primary/50 bg-primary/5" : ""
                } ${isUsingGlobal ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                  }`}>
                    {session.icon}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{session.label}</span>
                      <span className="text-xs text-muted-foreground">{session.hours}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{session.description}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isActive ? "border-primary bg-primary" : "border-muted-foreground"
                  }`}>
                    {isActive && <span className="text-primary-foreground text-xs">✓</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom Hours */}
      <div className="space-y-3">
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <span className="text-sm font-medium">Custom Trading Hours</span>
              <p className="text-xs text-muted-foreground">
                Override session presets with specific hours
              </p>
            </div>
            <button
              onClick={toggleCustomHours}
              disabled={isUsingGlobal}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                useCustomHours ? "bg-primary" : "bg-muted"
              } disabled:opacity-50`}
            >
              <span
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                  useCustomHours ? "left-7" : "left-1"
                }`}
              />
            </button>
          </div>
          
          {useCustomHours && (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Start Hour</label>
                <select
                  value={localConfig.custom_start_hour ?? 8}
                  onChange={(e) => handleCustomHoursChange('custom_start_hour', parseInt(e.target.value))}
                  disabled={isUsingGlobal}
                  className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
              <span className="text-muted-foreground mt-5">to</span>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">End Hour</label>
                <select
                  value={localConfig.custom_end_hour ?? 17}
                  onChange={(e) => handleCustomHoursChange('custom_end_hour', parseInt(e.target.value))}
                  disabled={isUsingGlobal}
                  className="w-full bg-background/50 border border-border rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{i.toString().padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="glass-card p-4 bg-muted/30">
        <h4 className="text-xs font-medium text-muted-foreground mb-2">Note</h4>
        <p className="text-xs text-muted-foreground">
          When no sessions are selected, trades will be copied 24/7. Session filters help avoid low-liquidity periods and can protect against news-related volatility.
        </p>
      </div>
    </div>
  );
}
