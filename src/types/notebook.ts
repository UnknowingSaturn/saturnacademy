// Notebook types

export interface NotebookEntry {
  id: string;
  user_id: string;
  entry_date: string;
  content: string | null;
  market_conditions: string | null;
  mood_rating: number | null;
  energy_level: number | null;
  goals: NotebookGoal[];
  reflection: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface NotebookGoal {
  id: string;
  text: string;
  completed: boolean;
}
