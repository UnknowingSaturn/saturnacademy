import { useState } from "react";
import { NotebookEditor } from "@/components/notebook/NotebookEditor";

export default function Notebook() {
  const [selectedDate, setSelectedDate] = useState(new Date());

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Daily Notebook</h1>
        <p className="text-muted-foreground">Track your mindset, goals, and reflections</p>
      </div>

      <NotebookEditor 
        date={selectedDate} 
        onDateChange={setSelectedDate} 
      />
    </div>
  );
}
