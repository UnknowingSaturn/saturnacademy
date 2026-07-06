import * as React from "react";
import { useState, useImperativeHandle, forwardRef } from "react";
import { ImagePlus, ArrowUp, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { uploadCoachImage, validateImage } from "@/lib/coachUpload";
import { cn } from "@/lib/utils";

interface Attachment {
  storage_path: string;
  preview_url: string;
  file_name: string;
}

interface Props {
  threadId: string;
  disabled?: boolean;
  contextChip?: React.ReactNode;
  onSend: (text: string, attachments: { storage_path: string }[]) => Promise<void> | void;
}

export interface CoachComposerHandle {
  setText: (t: string) => void;
  focus: () => void;
}

const MAX_ATTACHMENTS = 3;

export const CoachComposer = forwardRef<CoachComposerHandle, Props>(function CoachComposer(
  { threadId, disabled, contextChip, onSend },
  ref,
) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const taRef = React.useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    setText: (t) => { setText(t); requestAnimationFrame(() => taRef.current?.focus()); },
    focus: () => taRef.current?.focus(),
  }));

  React.useEffect(() => { taRef.current?.focus(); }, [threadId]);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !sending && !uploading && !disabled;

  const handleFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files as any as File[]);
    if (arr.length === 0) return;
    const remaining = MAX_ATTACHMENTS - attachments.length;
    const list = arr.slice(0, remaining);
    setUploading(true);
    try {
      for (const f of list) {
        const err = validateImage(f);
        if (err) { toast.error(err); continue; }
        const { storage_path, preview_url } = await uploadCoachImage(f, threadId);
        setAttachments((prev) => [...prev, { storage_path, preview_url, file_name: f.name }]);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => {
      const copy = [...prev];
      const [gone] = copy.splice(idx, 1);
      if (gone) URL.revokeObjectURL(gone.preview_url);
      return copy;
    });
  };

  const handleSend = async () => {
    if (!canSend) return;
    const payload = text.trim();
    const atts = attachments.map((a) => ({ storage_path: a.storage_path }));
    setSending(true);
    try {
      await onSend(payload, atts);
      setText("");
      attachments.forEach((a) => URL.revokeObjectURL(a.preview_url));
      setAttachments([]);
      requestAnimationFrame(() => taRef.current?.focus());
    } finally {
      setSending(false);
    }
  };

  const onPaste: React.ClipboardEventHandler<HTMLTextAreaElement> = (e) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) { e.preventDefault(); handleFiles(files); }
  };

  return (
    <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-2">
      <div
        className={cn(
          "max-w-3xl mx-auto rounded-2xl border border-border bg-card/60 backdrop-blur shadow-sm",
          "focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition",
          dragOver && "border-primary ring-2 ring-primary/25",
        )}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
          if (imgs.length) handleFiles(imgs);
        }}
      >
        {(contextChip || attachments.length > 0) && (
          <div className="flex items-center gap-2 flex-wrap px-3 pt-2.5">
            {contextChip}
            {attachments.map((a, i) => (
              <div key={i} className="relative group">
                <img src={a.preview_url} alt={a.file_name} className="h-14 w-14 object-cover rounded-lg border border-border" />
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  aria-label="Remove attachment"
                  className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5 hover:bg-accent transition"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <Textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
          }}
          placeholder="Ask about a trade, paste a chart, or say what happened…"
          rows={1}
          className="min-h-[52px] max-h-56 resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none px-3.5 py-3 text-sm placeholder:text-muted-foreground/70"
          disabled={disabled}
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || uploading || attachments.length >= MAX_ATTACHMENTS}
              aria-label="Attach image"
              title="Attach image"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
            </Button>
            <span className="text-[10px] text-muted-foreground/70 hidden sm:inline">
              {attachments.length}/{MAX_ATTACHMENTS} · drop or paste images
            </span>
          </div>
          <Button
            type="button"
            size="icon"
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="h-8 w-8 rounded-full"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
});
