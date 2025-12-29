import { useState } from "react";
import { useSessionDefinitions, useCreateSession, useUpdateSession, useDeleteSession } from "@/hooks/useUserSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, GripVertical, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionDefinition } from "@/types/settings";

const COLOR_OPTIONS = [
  '#EC4899', '#F43F5E', '#EF4444', '#F97316', '#F59E0B', 
  '#EAB308', '#84CC16', '#22C55E', '#10B981', '#14B8A6',
  '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#D946EF', '#6B7280'
];

export function SessionConfigPanel() {
  const { data: sessions = [], isLoading } = useSessionDefinitions();
  const createSession = useCreateSession();
  const updateSession = useUpdateSession();
  const deleteSession = useDeleteSession();
  
  const [editingSession, setEditingSession] = useState<SessionDefinition | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSession, setNewSession] = useState({
    name: '',
    key: '',
    start_hour: 8,
    start_minute: 0,
    end_hour: 12,
    end_minute: 0,
    color: '#3B82F6',
    timezone: 'America/New_York',
    sort_order: 0,
    is_active: true,
  });

  const handleAddSession = async () => {
    const key = newSession.name.toLowerCase().replace(/\s+/g, '_');
    await createSession.mutateAsync({
      ...newSession,
      key,
      sort_order: sessions.length,
    });
    setShowAddForm(false);
    setNewSession({
      name: '',
      key: '',
      start_hour: 8,
      start_minute: 0,
      end_hour: 12,
      end_minute: 0,
      color: '#3B82F6',
      timezone: 'America/New_York',
      sort_order: 0,
      is_active: true,
    });
  };

  const handleUpdateSession = async (id: string, updates: Partial<SessionDefinition>) => {
    if (id.startsWith('default-')) {
      // For default sessions, we need to create a new one
      const session = sessions.find(s => s.id === id);
      if (session) {
        await createSession.mutateAsync({
          ...session,
          ...updates,
          id: undefined,
        } as any);
      }
    } else {
      await updateSession.mutateAsync({ id, ...updates });
    }
  };

  const handleDeleteSession = async (id: string) => {
    if (!id.startsWith('default-')) {
      await deleteSession.mutateAsync(id);
    }
  };

  const formatTime = (hour: number, minute: number) => {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return <div className="p-4 text-center text-muted-foreground">Loading sessions...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Trading Sessions</h3>
          <p className="text-sm text-muted-foreground">Define your trading sessions and their time ranges</p>
        </div>
        <Button size="sm" onClick={() => setShowAddForm(true)}>
          <Plus className="w-4 h-4 mr-1" />
          Add Session
        </Button>
      </div>

      {/* Add Session Form */}
      {showAddForm && (
        <div className="border border-border rounded-lg p-4 space-y-4 bg-card">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Session Name</Label>
              <Input
                value={newSession.name}
                onChange={(e) => setNewSession({ ...newSession, name: e.target.value })}
                placeholder="e.g. London Open"
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-1 flex-wrap">
                {COLOR_OPTIONS.map((color) => (
                  <button
                    key={color}
                    className={cn(
                      "w-6 h-6 rounded-full transition-all",
                      newSession.color === color && "ring-2 ring-offset-2 ring-offset-background ring-primary"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewSession({ ...newSession, color })}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time (ET)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={newSession.start_hour}
                  onChange={(e) => setNewSession({ ...newSession, start_hour: parseInt(e.target.value) || 0 })}
                  className="w-20"
                />
                <span className="self-center">:</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={newSession.start_minute}
                  onChange={(e) => setNewSession({ ...newSession, start_minute: parseInt(e.target.value) || 0 })}
                  className="w-20"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>End Time (ET)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={newSession.end_hour}
                  onChange={(e) => setNewSession({ ...newSession, end_hour: parseInt(e.target.value) || 0 })}
                  className="w-20"
                />
                <span className="self-center">:</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={newSession.end_minute}
                  onChange={(e) => setNewSession({ ...newSession, end_minute: parseInt(e.target.value) || 0 })}
                  className="w-20"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowAddForm(false)}>Cancel</Button>
            <Button onClick={handleAddSession} disabled={!newSession.name}>Save Session</Button>
          </div>
        </div>
      )}

      {/* Session List */}
      <div className="space-y-2">
        {sessions.map((session) => (
          <div
            key={session.id}
            className={cn(
              "flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 transition-colors",
              !session.is_active && "opacity-50"
            )}
          >
            <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />
            
            <div
              className="w-4 h-4 rounded-full flex-shrink-0"
              style={{ backgroundColor: session.color }}
            />
            
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate">{session.name}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTime(session.start_hour, session.start_minute)} - {formatTime(session.end_hour, session.end_minute)} ET
              </div>
            </div>

            <Switch
              checked={session.is_active}
              onCheckedChange={(checked) => handleUpdateSession(session.id, { is_active: checked })}
            />

            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => handleDeleteSession(session.id)}
              disabled={session.id.startsWith('default-')}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        ))}
      </div>

      {sessions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No sessions defined. Add your first session above.
        </div>
      )}
    </div>
  );
}
