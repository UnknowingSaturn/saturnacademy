import { useState } from "react";
import { usePlaybooks, useCreatePlaybook, useUpdatePlaybook, useDeletePlaybook } from "@/hooks/usePlaybooks";
import { Playbook, ChecklistQuestion, SessionType } from "@/types/trading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, GripVertical, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Playbooks() {
  const { data: playbooks, isLoading } = usePlaybooks();
  const createPlaybook = useCreatePlaybook();
  const updatePlaybook = useUpdatePlaybook();
  const deletePlaybook = useDeletePlaybook();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<Playbook | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [questions, setQuestions] = useState<ChecklistQuestion[]>([]);
  const [newQuestion, setNewQuestion] = useState("");

  const resetForm = () => {
    setName("");
    setDescription("");
    setQuestions([]);
    setNewQuestion("");
    setEditingPlaybook(null);
  };

  const openEditDialog = (playbook: Playbook) => {
    setEditingPlaybook(playbook);
    setName(playbook.name);
    setDescription(playbook.description || "");
    setQuestions(playbook.checklist_questions);
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

  const handleSave = async () => {
    if (!name.trim()) return;

    const playbookData = {
      name: name.trim(),
      description: description.trim() || null,
      checklist_questions: questions,
      is_active: true,
      session_filter: null,
      symbol_filter: null,
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Playbooks</h1>
          <p className="text-muted-foreground">Define your trading strategies and checklists</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNewDialog} className="gap-2">
              <Plus className="w-4 h-4" />
              New Playbook
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingPlaybook ? "Edit Playbook" : "Create Playbook"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
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
              <div className="flex justify-end gap-3 pt-4">
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
          </DialogContent>
        </Dialog>
      </div>

      {/* Playbooks Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[200px] rounded-lg" />
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
              <CardHeader>
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
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {playbook.checklist_questions.length} questions
                    </Badge>
                  </div>
                  {playbook.checklist_questions.length > 0 && (
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      {playbook.checklist_questions.slice(0, 3).map((q) => (
                        <li key={q.id} className="truncate">• {q.question}</li>
                      ))}
                      {playbook.checklist_questions.length > 3 && (
                        <li className="text-xs">+{playbook.checklist_questions.length - 3} more</li>
                      )}
                    </ul>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}