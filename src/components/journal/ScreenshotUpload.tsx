import { useState, useRef } from "react";
import { useScreenshots } from "@/hooks/useScreenshots";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Image, Upload, X, Loader2, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScreenshotUploadProps {
  tradeId: string;
  screenshots: string[];
  onScreenshotsChange: (screenshots: string[]) => void;
}

export function ScreenshotUpload({ tradeId, screenshots, onScreenshotsChange }: ScreenshotUploadProps) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { uploadScreenshot, deleteScreenshot, isUploading } = useScreenshots();

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      
      const url = await uploadScreenshot(file, tradeId);
      if (url) {
        onScreenshotsChange([...screenshots, url]);
      }
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (url: string) => {
    const success = await deleteScreenshot(url);
    if (success) {
      onScreenshotsChange(screenshots.filter(s => s !== url));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Image className="w-4 h-4" />
          Screenshots
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="gap-2"
        >
          {isUploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {screenshots.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {screenshots.map((url, index) => (
            <div
              key={index}
              className="relative group aspect-video rounded-lg overflow-hidden border border-border/50 bg-muted/30"
            >
              <img
                src={url}
                alt={`Trade screenshot ${index + 1}`}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setSelectedImage(url)}
                    >
                      <Maximize2 className="w-4 h-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>Screenshot</DialogTitle>
                    </DialogHeader>
                    <img
                      src={url}
                      alt="Trade screenshot"
                      className="w-full rounded-lg"
                    />
                  </DialogContent>
                </Dialog>
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleDelete(url)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {screenshots.length === 0 && (
        <div
          className={cn(
            "border-2 border-dashed border-border/50 rounded-lg p-6 text-center cursor-pointer",
            "hover:border-primary/30 hover:bg-muted/20 transition-colors"
          )}
          onClick={() => fileInputRef.current?.click()}
        >
          <Image className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Click to upload chart screenshots
          </p>
        </div>
      )}
    </div>
  );
}
