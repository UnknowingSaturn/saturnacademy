import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from "sonner";

export function useScreenshots() {
  const [isUploading, setIsUploading] = useState(false);
  const uploadScreenshot = async (
    file: File, 
    contextId: string, 
    contextType: 'trade' | 'playbook' = 'trade'
  ): Promise<string | null> => {
    setIsUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}/${contextType}/${contextId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('trade-screenshots')
        .upload(fileName, file, { upsert: false });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from('trade-screenshots')
        .getPublicUrl(fileName);

      return data.publicUrl;
    } catch (error) {
      console.error('Screenshot upload error:', error);
      toast.error('Upload failed', { description: error instanceof Error ? error.message : 'Could not upload screenshot' });
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  const deleteScreenshot = async (url: string): Promise<boolean> => {
    try {
      // Extract path from URL
      const urlParts = url.split('/trade-screenshots/');
      if (urlParts.length < 2) return false;
      
      const path = urlParts[1];
      const { error } = await supabase.storage
        .from('trade-screenshots')
        .remove([path]);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Screenshot delete error:', error);
      toast.error('Delete failed', { description: error instanceof Error ? error.message : 'Could not delete screenshot' });
      return false;
    }
  };

  return { uploadScreenshot, deleteScreenshot, isUploading };
}
