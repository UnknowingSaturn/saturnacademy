import { useState, useRef, useEffect } from "react";
import { useSessionDefinitions, useCreateSession, useUpdateSession, useDeleteSession, useReorderSessions } from "@/hooks/useUserSettings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Trash2, GripVertical, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionDefinition } from "@/types/settings";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const COLOR_OPTIONS = [
  '#EC4899', '#F43F5E', '#EF4444', '#F97316', '#F59E0B', 
  '#EAB308', '#84CC16', '#22C55E', '#10B981', '#14B8A6',
  '#06B6D4', '#0EA5E9', '#3B82F6', '#6366F1', '#8B5CF6',
  '#A855F7', '#D946EF', '#6B7280'
];

const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Berlin', label: 'Berlin (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
  { value: 'Asia/Hong_Kong', label: 'Hong Kong (HKT)' },
  { value: 'Asia/Singapore', label: 'Singapore (SGT)' },
  { value: 'Australia/Sydney', label: 'Sydney (AEST)' },
  { value: 'UTC', label: 'UTC' },
];

const getTimezoneAbbr = (tz: string) => {
  const option = TIMEZONE_OPTIONS.find(o => o.value === tz);
  if (option) {
    const match = option.label.match(/\(([^)]+)\)/);
    return match ? match[1] : tz;
  }
  return tz;
};

const formatTime = (hour: number, minute: number) => {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
};

interface SortableSessionItemProps {
  session: SessionDefinition;
  onEdit: (session: SessionDefinition) => void;
  onUpdate: (id: string, updates: Partial<SessionDefinition>) => void;
  onDelete: (id: string) => void;
}

function SortableSessionItem({ session, onEdit, onUpdate, onDelete }: SortableSessionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50 transition-colors cursor-pointer hover:border-primary/50 hover:bg-card",
        !session.is_active && "opacity-50",
        isDragging && "opacity-50 shadow-lg"
      )}
      onClick={() => onEdit(session)}
    >
      <button
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-4 h-4 text-muted-foreground" />
      </button>
      
      <div
        className="w-4 h-4 rounded-full flex-shrink-0"
        style={{ backgroundColor: session.color }}
      />
      
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{session.name}</div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTime(session.start_hour, session.start_minute)} - {formatTime(session.end_hour, session.end_minute)} {getTimezoneAbbr(session.timezone)}
        </div>
      </div>

      <Switch
        checked={session.is_active}
        onCheckedChange={(checked) => {
          onUpdate(session.id, { is_active: checked });
        }}
        onClick={(e) => e.stopPropagation()}
      />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={(e) => e.stopPropagation()}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Session</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{session.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => onDelete(session.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SessionConfigPanel() {
  const { data: sessions = [], isLoading } = useSessionDefinitions();
  const createSession = useCreateSession();
  const updateSession = useUpdateSession();
  const deleteSession = useDeleteSession();
  const reorderSessions = useReorderSessions();
  
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

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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
    await updateSession.mutateAsync({ id, ...updates });
  };

  const handleDeleteSession = async (id: string) => {
    await deleteSession.mutateAsync(id);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = sessions.findIndex((s) => s.id === active.id);
      const newIndex = sessions.findIndex((s) => s.id === over.id);
      const newOrder = arrayMove(sessions, oldIndex, newIndex);
      
      // Update sort orders in database
      const updates = newOrder.map((session, index) => ({
        id: session.id,
        sort_order: index,
      }));
      await reorderSessions.mutateAsync(updates);
    }
  };

  if (isLoading) {
    return <div className="p-4 text-center text-muted-foreground">Loading sessions...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium">Trading Sessions</h3>
          <p className="text-sm text-muted-foreground">Define your trading sessions. Click to edit, drag to reorder.</p>
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

          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select
              value={newSession.timezone}
              onValueChange={(value) => setNewSession({ ...newSession, timezone: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time</Label>
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
              <Label>End Time</Label>
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

      {/* Edit Session Form (Modal-like inline) */}
      {editingSession && (
        <div className="border border-primary/50 rounded-lg p-4 space-y-4 bg-card">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Session Name</Label>
              <Input
                value={editingSession.name}
                onChange={(e) => setEditingSession({ ...editingSession, name: e.target.value })}
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
                      editingSession.color === color && "ring-2 ring-offset-2 ring-offset-background ring-primary"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setEditingSession({ ...editingSession, color })}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select
              value={editingSession.timezone}
              onValueChange={(value) => setEditingSession({ ...editingSession, timezone: value })}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={editingSession.start_hour}
                  onChange={(e) => setEditingSession({ ...editingSession, start_hour: parseInt(e.target.value) || 0 })}
                  className="w-20"
                />
                <span className="self-center">:</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={editingSession.start_minute}
                  onChange={(e) => setEditingSession({ ...editingSession, start_minute: parseInt(e.target.value) || 0 })}
                  className="w-20"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={editingSession.end_hour}
                  onChange={(e) => setEditingSession({ ...editingSession, end_hour: parseInt(e.target.value) || 0 })}
                  className="w-20"
                />
                <span className="self-center">:</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={editingSession.end_minute}
                  onChange={(e) => setEditingSession({ ...editingSession, end_minute: parseInt(e.target.value) || 0 })}
                  className="w-20"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingSession(null)}>Cancel</Button>
            <Button 
              onClick={async () => {
                await handleUpdateSession(editingSession.id, {
                  name: editingSession.name,
                  color: editingSession.color,
                  timezone: editingSession.timezone,
                  start_hour: editingSession.start_hour,
                  start_minute: editingSession.start_minute,
                  end_hour: editingSession.end_hour,
                  end_minute: editingSession.end_minute,
                });
                setEditingSession(null);
              }} 
              disabled={!editingSession.name}
            >
              Save Changes
            </Button>
          </div>
        </div>
      )}

      {/* Session List with Drag and Drop */}
      {!editingSession && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={sessions.map(s => s.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {sessions.map((session) => (
                <SortableSessionItem
                  key={session.id}
                  session={session}
                  onEdit={(s) => setEditingSession({ ...s })}
                  onUpdate={handleUpdateSession}
                  onDelete={handleDeleteSession}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {sessions.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          No sessions defined. Add your first session above.
        </div>
      )}
    </div>
  );
}
