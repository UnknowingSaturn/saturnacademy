export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_number: string | null
          account_type: Database["public"]["Enums"]["account_type"] | null
          api_key: string | null
          balance_start: number | null
          broker: string | null
          created_at: string
          equity_current: number | null
          id: string
          is_active: boolean | null
          name: string
          prop_firm: Database["public"]["Enums"]["prop_firm"] | null
          terminal_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_number?: string | null
          account_type?: Database["public"]["Enums"]["account_type"] | null
          api_key?: string | null
          balance_start?: number | null
          broker?: string | null
          created_at?: string
          equity_current?: number | null
          id?: string
          is_active?: boolean | null
          name: string
          prop_firm?: Database["public"]["Enums"]["prop_firm"] | null
          terminal_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_number?: string | null
          account_type?: Database["public"]["Enums"]["account_type"] | null
          api_key?: string | null
          balance_start?: number | null
          broker?: string | null
          created_at?: string
          equity_current?: number | null
          id?: string
          is_active?: boolean | null
          name?: string
          prop_firm?: Database["public"]["Enums"]["prop_firm"] | null
          terminal_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_prompts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
          max_tokens: number | null
          name: string
          prompt_type: string
          provider: Database["public"]["Enums"]["ai_provider"] | null
          system_prompt: string
          temperature: number | null
          updated_at: string
          user_id: string | null
          user_prompt_template: string | null
          version: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          max_tokens?: number | null
          name: string
          prompt_type: string
          provider?: Database["public"]["Enums"]["ai_provider"] | null
          system_prompt: string
          temperature?: number | null
          updated_at?: string
          user_id?: string | null
          user_prompt_template?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          max_tokens?: number | null
          name?: string
          prompt_type?: string
          provider?: Database["public"]["Enums"]["ai_provider"] | null
          system_prompt?: string
          temperature?: number | null
          updated_at?: string
          user_id?: string | null
          user_prompt_template?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_prompts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          account_id: string | null
          commission: number | null
          direction: Database["public"]["Enums"]["trade_direction"]
          event_timestamp: string
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          idempotency_key: string
          ingested_at: string
          lot_size: number
          price: number
          processed: boolean | null
          profit: number | null
          raw_payload: Json | null
          sl: number | null
          swap: number | null
          symbol: string
          terminal_id: string | null
          ticket: number
          tp: number | null
        }
        Insert: {
          account_id?: string | null
          commission?: number | null
          direction: Database["public"]["Enums"]["trade_direction"]
          event_timestamp: string
          event_type: Database["public"]["Enums"]["event_type"]
          id?: string
          idempotency_key: string
          ingested_at?: string
          lot_size: number
          price: number
          processed?: boolean | null
          profit?: number | null
          raw_payload?: Json | null
          sl?: number | null
          swap?: number | null
          symbol: string
          terminal_id?: string | null
          ticket: number
          tp?: number | null
        }
        Update: {
          account_id?: string | null
          commission?: number | null
          direction?: Database["public"]["Enums"]["trade_direction"]
          event_timestamp?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          idempotency_key?: string
          ingested_at?: string
          lot_size?: number
          price?: number
          processed?: boolean | null
          profit?: number | null
          raw_payload?: Json | null
          sl?: number | null
          swap?: number | null
          symbol?: string
          terminal_id?: string | null
          ticket?: number
          tp?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      notebook_entries: {
        Row: {
          content: string | null
          created_at: string
          energy_level: number | null
          entry_date: string
          goals: Json | null
          id: string
          market_conditions: string | null
          mood_rating: number | null
          reflection: string | null
          tags: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          energy_level?: number | null
          entry_date: string
          goals?: Json | null
          id?: string
          market_conditions?: string | null
          mood_rating?: number | null
          reflection?: string | null
          tags?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string
          energy_level?: number | null
          entry_date?: string
          goals?: Json | null
          id?: string
          market_conditions?: string | null
          mood_rating?: number | null
          reflection?: string | null
          tags?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notebook_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      playbooks: {
        Row: {
          checklist_questions: Json
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          session_filter: Database["public"]["Enums"]["session_type"][] | null
          symbol_filter: string[] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          checklist_questions?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          session_filter?: Database["public"]["Enums"]["session_type"][] | null
          symbol_filter?: string[] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          checklist_questions?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          session_filter?: Database["public"]["Enums"]["session_type"][] | null
          symbol_filter?: string[] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playbooks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      prop_firm_rules: {
        Row: {
          created_at: string
          description: string | null
          firm: Database["public"]["Enums"]["prop_firm"]
          id: string
          is_percentage: boolean | null
          rule_name: string
          rule_type: string
          value: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          firm: Database["public"]["Enums"]["prop_firm"]
          id?: string
          is_percentage?: boolean | null
          rule_name: string
          rule_type: string
          value: number
        }
        Update: {
          created_at?: string
          description?: string | null
          firm?: Database["public"]["Enums"]["prop_firm"]
          id?: string
          is_percentage?: boolean | null
          rule_name?: string
          rule_type?: string
          value?: number
        }
        Relationships: []
      }
      trade_comments: {
        Row: {
          content: string
          created_at: string
          id: string
          screenshot_url: string | null
          trade_id: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          screenshot_url?: string | null
          trade_id: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          screenshot_url?: string | null
          trade_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_comments_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_reviews: {
        Row: {
          actionable_steps: Json | null
          checklist_answers: Json | null
          created_at: string
          did_well: Json | null
          emotional_state_after:
            | Database["public"]["Enums"]["emotional_state"]
            | null
          emotional_state_before:
            | Database["public"]["Enums"]["emotional_state"]
            | null
          id: string
          mistakes: Json | null
          news_risk: Database["public"]["Enums"]["news_risk"] | null
          playbook_id: string | null
          psychology_notes: string | null
          regime: Database["public"]["Enums"]["regime_type"] | null
          reviewed_at: string | null
          score: number | null
          screenshots: Json | null
          thoughts: string | null
          to_improve: Json | null
          trade_id: string
          updated_at: string
        }
        Insert: {
          actionable_steps?: Json | null
          checklist_answers?: Json | null
          created_at?: string
          did_well?: Json | null
          emotional_state_after?:
            | Database["public"]["Enums"]["emotional_state"]
            | null
          emotional_state_before?:
            | Database["public"]["Enums"]["emotional_state"]
            | null
          id?: string
          mistakes?: Json | null
          news_risk?: Database["public"]["Enums"]["news_risk"] | null
          playbook_id?: string | null
          psychology_notes?: string | null
          regime?: Database["public"]["Enums"]["regime_type"] | null
          reviewed_at?: string | null
          score?: number | null
          screenshots?: Json | null
          thoughts?: string | null
          to_improve?: Json | null
          trade_id: string
          updated_at?: string
        }
        Update: {
          actionable_steps?: Json | null
          checklist_answers?: Json | null
          created_at?: string
          did_well?: Json | null
          emotional_state_after?:
            | Database["public"]["Enums"]["emotional_state"]
            | null
          emotional_state_before?:
            | Database["public"]["Enums"]["emotional_state"]
            | null
          id?: string
          mistakes?: Json | null
          news_risk?: Database["public"]["Enums"]["news_risk"] | null
          playbook_id?: string | null
          psychology_notes?: string | null
          regime?: Database["public"]["Enums"]["regime_type"] | null
          reviewed_at?: string | null
          score?: number | null
          screenshots?: Json | null
          thoughts?: string | null
          to_improve?: Json | null
          trade_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_reviews_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_reviews_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          account_id: string | null
          commission: number | null
          created_at: string
          direction: Database["public"]["Enums"]["trade_direction"]
          duration_seconds: number | null
          entry_price: number
          entry_time: string
          exit_price: number | null
          exit_time: string | null
          gross_pnl: number | null
          id: string
          is_open: boolean | null
          net_pnl: number | null
          partial_closes: Json | null
          r_multiple_actual: number | null
          r_multiple_planned: number | null
          session: Database["public"]["Enums"]["session_type"] | null
          sl_final: number | null
          sl_initial: number | null
          swap: number | null
          symbol: string
          terminal_id: string | null
          ticket: number | null
          total_lots: number
          tp_final: number | null
          tp_initial: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          commission?: number | null
          created_at?: string
          direction: Database["public"]["Enums"]["trade_direction"]
          duration_seconds?: number | null
          entry_price: number
          entry_time: string
          exit_price?: number | null
          exit_time?: string | null
          gross_pnl?: number | null
          id?: string
          is_open?: boolean | null
          net_pnl?: number | null
          partial_closes?: Json | null
          r_multiple_actual?: number | null
          r_multiple_planned?: number | null
          session?: Database["public"]["Enums"]["session_type"] | null
          sl_final?: number | null
          sl_initial?: number | null
          swap?: number | null
          symbol: string
          terminal_id?: string | null
          ticket?: number | null
          total_lots: number
          tp_final?: number | null
          tp_initial?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          commission?: number | null
          created_at?: string
          direction?: Database["public"]["Enums"]["trade_direction"]
          duration_seconds?: number | null
          entry_price?: number
          entry_time?: string
          exit_price?: number | null
          exit_time?: string | null
          gross_pnl?: number | null
          id?: string
          is_open?: boolean | null
          net_pnl?: number | null
          partial_closes?: Json | null
          r_multiple_actual?: number | null
          r_multiple_planned?: number | null
          session?: Database["public"]["Enums"]["session_type"] | null
          sl_final?: number | null
          sl_initial?: number | null
          swap?: number | null
          symbol?: string
          terminal_id?: string | null
          ticket?: number | null
          total_lots?: number
          tp_final?: number | null
          tp_initial?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trades_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      account_type: "demo" | "live" | "prop"
      ai_provider: "openai" | "gemini" | "lovable"
      emotional_state:
        | "great"
        | "good"
        | "calm"
        | "confident"
        | "focused"
        | "alright"
        | "okay"
        | "normal"
        | "rough"
        | "anxious"
        | "fomo"
        | "revenge"
        | "tilted"
        | "exhausted"
      event_type: "open" | "modify" | "partial_close" | "close"
      news_risk: "none" | "low" | "high"
      prop_firm: "ftmo" | "fundednext" | "other"
      regime_type: "rotational" | "transitional"
      session_type:
        | "tokyo"
        | "london"
        | "new_york"
        | "overlap_london_ny"
        | "off_hours"
      trade_direction: "buy" | "sell"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_type: ["demo", "live", "prop"],
      ai_provider: ["openai", "gemini", "lovable"],
      emotional_state: [
        "great",
        "good",
        "calm",
        "confident",
        "focused",
        "alright",
        "okay",
        "normal",
        "rough",
        "anxious",
        "fomo",
        "revenge",
        "tilted",
        "exhausted",
      ],
      event_type: ["open", "modify", "partial_close", "close"],
      news_risk: ["none", "low", "high"],
      prop_firm: ["ftmo", "fundednext", "other"],
      regime_type: ["rotational", "transitional"],
      session_type: [
        "tokyo",
        "london",
        "new_york",
        "overlap_london_ny",
        "off_hours",
      ],
      trade_direction: ["buy", "sell"],
    },
  },
} as const
