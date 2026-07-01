import * as React from "react";
import { useState } from "react";
import { ImagePlus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { uploadCoachImage, validateImage } from "@/lib/coachUpload";

interface Attachment {
  storage_path: string;
  preview_url: string;
  file_name: string;
}

interface Props {
  threadId: string;
  disabled?: boolean;
  onSend: (text: string, attachments: { storage_path: string }[]) => Promise<void> | void;
}

const MAX_ATTACHMENTS = 3;

export function CoachComposer({ threadId, disabled, onSend }: Props) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !sending && !uploading && !disabled;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const remaining = MAX_ATTACHMENTS - attachments.length;
    const list = Array.from(files).slice(0, remaining);
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
    if (files.length > 0) {
      e.preventDefault();
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      handleFiles(dt.files);
    }
  };

  return (
    <div className="border-t border-border p-2 space-y-2">
      {attachments.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {attachments.map((a, i) => (
            <div key={i} className="relative group">
              <img src={a.preview_url} alt={a.file_name} className="h-16 w-16 object-cover rounded border border-border" />
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                aria-label="Remove attachment"
                className="absolute -top-1.5 -right-1.5 bg-background border border-border rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1">
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
          className="shrink-0"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || uploading || attachments.length >= MAX_ATTACHMENTS}
          aria-label="Attach image"
        >
          <ImagePlus className="w-4 h-4" />
        </Button>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Ask about a trade, paste a chart, or say what happened…"
          rows={1}
          className="min-h-[40px] max-h-40 resize-none"
          disabled={disabled}
        />
        <Button
          type="button"
          size="icon"
          onClick={handleSend}
          disabled={!canSend}
          aria-label="Send message"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
