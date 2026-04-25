export interface KnowledgeConcept {
  label: string;
  definition: string;
}

export interface KnowledgeScreenshot {
  url: string;
  caption: string;
  source_url: string;
  /** AI-written explanation grounded in the article text near this image. */
  description?: string;
  /** Raw surrounding article text used to ground the description. */
  nearby_text?: string;
}

export interface KnowledgeEntry {
  id: string;
  user_id: string;
  source_url: string;
  source_title: string | null;
  source_author: string | null;
  source_published_at: string | null;
  status: 'extracting' | 'ready' | 'failed';
  error_message: string | null;
  /**
   * Cleaned inline article markdown. May contain `{{IMG:N}}` placeholders that
   * map to entries in `screenshots[N]` — the renderer splits on these tokens
   * and inlines a `<figure>` for each one. May also start with a TL;DR
   * blockquote. Older entries (pre-inline format) contain plain markdown
   * without placeholders; the renderer falls back to appending screenshots
   * after the body in that case.
   */
  summary: string | null;
  key_takeaways: string[];
  concepts: KnowledgeConcept[];
  tags: string[];
  screenshots: KnowledgeScreenshot[];
  raw_markdown: string | null;
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChatMessage {
  id: string;
  knowledge_entry_id: string;
  user_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}
