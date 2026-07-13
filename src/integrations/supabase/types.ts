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
      account_balance_snapshots: {
        Row: {
          account_id: string
          balance: number
          created_at: string
          equity: number | null
          free_margin: number | null
          id: string
          margin: number | null
          recorded_at: string
          recorded_minute: number
          user_id: string
        }
        Insert: {
          account_id: string
          balance: number
          created_at?: string
          equity?: number | null
          free_margin?: number | null
          id?: string
          margin?: number | null
          recorded_at?: string
          recorded_minute: number
          user_id: string
        }
        Update: {
          account_id?: string
          balance?: number
          created_at?: string
          equity?: number | null
          free_margin?: number | null
          id?: string
          margin?: number | null
          recorded_at?: string
          recorded_minute?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "abs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "abs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_number: string | null
          account_type: Database["public"]["Enums"]["account_type"] | null
          api_key: string | null
          balance_start: number | null
          broker: string | null
          broker_dst_profile: Database["public"]["Enums"]["broker_dst_profile"]
          broker_utc_offset: number | null
          copier_enabled: boolean | null
          copier_role: Database["public"]["Enums"]["copier_role"] | null
          created_at: string
          equity_current: number | null
          force_resync: boolean
          id: string
          is_active: boolean | null
          last_heartbeat_at: string | null
          last_sync_at: string | null
          live_state: Database["public"]["Enums"]["account_live_state"]
          master_account_id: string | null
          mt5_install_id: string | null
          name: string
          prop_firm: string | null
          sync_history_enabled: boolean | null
          sync_history_from: string | null
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
          broker_dst_profile?: Database["public"]["Enums"]["broker_dst_profile"]
          broker_utc_offset?: number | null
          copier_enabled?: boolean | null
          copier_role?: Database["public"]["Enums"]["copier_role"] | null
          created_at?: string
          equity_current?: number | null
          force_resync?: boolean
          id?: string
          is_active?: boolean | null
          last_heartbeat_at?: string | null
          last_sync_at?: string | null
          live_state?: Database["public"]["Enums"]["account_live_state"]
          master_account_id?: string | null
          mt5_install_id?: string | null
          name: string
          prop_firm?: string | null
          sync_history_enabled?: boolean | null
          sync_history_from?: string | null
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
          broker_dst_profile?: Database["public"]["Enums"]["broker_dst_profile"]
          broker_utc_offset?: number | null
          copier_enabled?: boolean | null
          copier_role?: Database["public"]["Enums"]["copier_role"] | null
          created_at?: string
          equity_current?: number | null
          force_resync?: boolean
          id?: string
          is_active?: boolean | null
          last_heartbeat_at?: string | null
          last_sync_at?: string | null
          live_state?: Database["public"]["Enums"]["account_live_state"]
          master_account_id?: string | null
          mt5_install_id?: string | null
          name?: string
          prop_firm?: string | null
          sync_history_enabled?: boolean | null
          sync_history_from?: string | null
          terminal_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_master_account_id_fkey"
            columns: ["master_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_master_account_id_fkey"
            columns: ["master_account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "accounts_prop_firm_fkey"
            columns: ["prop_firm"]
            isOneToOne: false
            referencedRelation: "prop_firms"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_commands: {
        Row: {
          acked_at: string | null
          command: string
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          install_id: string
          payload: Json
          result: Json | null
          status: string
          user_id: string
        }
        Insert: {
          acked_at?: string | null
          command: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          install_id: string
          payload?: Json
          result?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          acked_at?: string | null
          command?: string
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          install_id?: string
          payload?: Json
          result?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      agent_state: {
        Row: {
          created_at: string
          id: string
          install_id: string
          last_error: string | null
          last_heartbeat_at: string | null
          receivers_status: Json
          status: string
          terminals: Json
          updated_at: string
          user_id: string
          version: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          install_id: string
          last_error?: string | null
          last_heartbeat_at?: string | null
          receivers_status?: Json
          status?: string
          terminals?: Json
          updated_at?: string
          user_id: string
          version?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          install_id?: string
          last_error?: string | null
          last_heartbeat_at?: string | null
          receivers_status?: Json
          status?: string
          terminals?: Json
          updated_at?: string
          user_id?: string
          version?: string | null
        }
        Relationships: []
      }
      ai_reviews: {
        Row: {
          actionable_guidance: Json | null
          comparison_to_past: Json | null
          confidence: string | null
          context_alignment_score: number | null
          created_at: string | null
          id: string
          mistake_attribution: Json | null
          psychology_analysis: Json | null
          raw_analysis: string | null
          rule_violations: string[] | null
          screenshots_analyzed: boolean | null
          setup_compliance_score: number | null
          similar_losers: string[] | null
          similar_winners: string[] | null
          strategy_refinement: Json | null
          technical_review: Json | null
          thesis_evaluation: Json | null
          trade_id: string
          updated_at: string | null
          user_id: string | null
          visual_analysis: Json | null
        }
        Insert: {
          actionable_guidance?: Json | null
          comparison_to_past?: Json | null
          confidence?: string | null
          context_alignment_score?: number | null
          created_at?: string | null
          id?: string
          mistake_attribution?: Json | null
          psychology_analysis?: Json | null
          raw_analysis?: string | null
          rule_violations?: string[] | null
          screenshots_analyzed?: boolean | null
          setup_compliance_score?: number | null
          similar_losers?: string[] | null
          similar_winners?: string[] | null
          strategy_refinement?: Json | null
          technical_review?: Json | null
          thesis_evaluation?: Json | null
          trade_id: string
          updated_at?: string | null
          user_id?: string | null
          visual_analysis?: Json | null
        }
        Update: {
          actionable_guidance?: Json | null
          comparison_to_past?: Json | null
          confidence?: string | null
          context_alignment_score?: number | null
          created_at?: string | null
          id?: string
          mistake_attribution?: Json | null
          psychology_analysis?: Json | null
          raw_analysis?: string | null
          rule_violations?: string[] | null
          screenshots_analyzed?: boolean | null
          setup_compliance_score?: number | null
          similar_losers?: string[] | null
          similar_winners?: string[] | null
          strategy_refinement?: Json | null
          technical_review?: Json | null
          thesis_evaluation?: Json | null
          trade_id?: string
          updated_at?: string | null
          user_id?: string | null
          visual_analysis?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_reviews_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_reviews_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_embed_queue: {
        Row: {
          attempts: number
          enqueued_at: string
          id: number
          last_error: string | null
          trade_id: string
          user_id: string
        }
        Insert: {
          attempts?: number
          enqueued_at?: string
          id?: number
          last_error?: string | null
          trade_id: string
          user_id: string
        }
        Update: {
          attempts?: number
          enqueued_at?: string
          id?: number
          last_error?: string | null
          trade_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_embed_queue_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_embed_queue_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_messages: {
        Row: {
          attachments: Json | null
          created_at: string
          id: string
          parts: Json
          role: string
          thread_id: string
          token_usage: Json | null
          tool_calls: Json | null
          user_id: string
        }
        Insert: {
          attachments?: Json | null
          created_at?: string
          id?: string
          parts: Json
          role: string
          thread_id: string
          token_usage?: Json | null
          tool_calls?: Json | null
          user_id: string
        }
        Update: {
          attachments?: Json | null
          created_at?: string
          id?: string
          parts?: Json
          role?: string
          thread_id?: string
          token_usage?: Json | null
          tool_calls?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "coach_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      coach_threads: {
        Row: {
          context_route: string | null
          context_trade_id: string | null
          created_at: string
          id: string
          last_message_at: string | null
          message_count: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          context_route?: string | null
          context_trade_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          context_route?: string | null
          context_trade_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          message_count?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coach_threads_context_trade_id_fkey"
            columns: ["context_trade_id"]
            isOneToOne: false
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coach_threads_context_trade_id_fkey"
            columns: ["context_trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      copier_executions: {
        Row: {
          direction: string
          error_message: string | null
          event_type: string
          executed_at: string | null
          executed_price: number | null
          id: string
          idempotency_key: string
          master_account_id: string | null
          master_lots: number | null
          master_position_id: number | null
          master_price: number | null
          receiver_account_id: string | null
          receiver_lots: number | null
          receiver_position_id: number | null
          slippage_pips: number | null
          status: string
          symbol: string
          user_id: string
        }
        Insert: {
          direction: string
          error_message?: string | null
          event_type: string
          executed_at?: string | null
          executed_price?: number | null
          id?: string
          idempotency_key: string
          master_account_id?: string | null
          master_lots?: number | null
          master_position_id?: number | null
          master_price?: number | null
          receiver_account_id?: string | null
          receiver_lots?: number | null
          receiver_position_id?: number | null
          slippage_pips?: number | null
          status: string
          symbol: string
          user_id: string
        }
        Update: {
          direction?: string
          error_message?: string | null
          event_type?: string
          executed_at?: string | null
          executed_price?: number | null
          id?: string
          idempotency_key?: string
          master_account_id?: string | null
          master_lots?: number | null
          master_position_id?: number | null
          master_price?: number | null
          receiver_account_id?: string | null
          receiver_lots?: number | null
          receiver_position_id?: number | null
          slippage_pips?: number | null
          status?: string
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copier_executions_master_account_id_fkey"
            columns: ["master_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copier_executions_master_account_id_fkey"
            columns: ["master_account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "copier_executions_receiver_account_id_fkey"
            columns: ["receiver_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copier_executions_receiver_account_id_fkey"
            columns: ["receiver_account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      copier_receiver_settings: {
        Row: {
          allowed_sessions: Json | null
          created_at: string | null
          id: string
          manual_confirm_mode: boolean | null
          max_daily_loss_r: number | null
          max_slippage_pips: number | null
          poll_interval_ms: number | null
          prop_firm_safe_mode: boolean | null
          receiver_account_id: string
          risk_mode: string
          risk_value: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          allowed_sessions?: Json | null
          created_at?: string | null
          id?: string
          manual_confirm_mode?: boolean | null
          max_daily_loss_r?: number | null
          max_slippage_pips?: number | null
          poll_interval_ms?: number | null
          prop_firm_safe_mode?: boolean | null
          receiver_account_id: string
          risk_mode?: string
          risk_value?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          allowed_sessions?: Json | null
          created_at?: string | null
          id?: string
          manual_confirm_mode?: boolean | null
          max_daily_loss_r?: number | null
          max_slippage_pips?: number | null
          poll_interval_ms?: number | null
          prop_firm_safe_mode?: boolean | null
          receiver_account_id?: string
          risk_mode?: string
          risk_value?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copier_receiver_settings_receiver_account_id_fkey"
            columns: ["receiver_account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copier_receiver_settings_receiver_account_id_fkey"
            columns: ["receiver_account_id"]
            isOneToOne: true
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      copier_symbol_mappings: {
        Row: {
          created_at: string | null
          id: string
          is_enabled: boolean | null
          master_account_id: string
          master_symbol: string
          receiver_account_id: string
          receiver_symbol: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          master_account_id: string
          master_symbol: string
          receiver_account_id: string
          receiver_symbol: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_enabled?: boolean | null
          master_account_id?: string
          master_symbol?: string
          receiver_account_id?: string
          receiver_symbol?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copier_symbol_mappings_master_account_id_fkey"
            columns: ["master_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copier_symbol_mappings_master_account_id_fkey"
            columns: ["master_account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "copier_symbol_mappings_receiver_account_id_fkey"
            columns: ["receiver_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copier_symbol_mappings_receiver_account_id_fkey"
            columns: ["receiver_account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      custom_field_definitions: {
        Row: {
          created_at: string
          default_value: Json | null
          id: string
          is_active: boolean
          key: string
          label: string
          options: Json
          scope: string
          sort_order: number
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_value?: Json | null
          id?: string
          is_active?: boolean
          key: string
          label: string
          options?: Json
          scope?: string
          sort_order?: number
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_value?: Json | null
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          options?: Json
          scope?: string
          sort_order?: number
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          account_id: string | null
          broker_login: string | null
          commission: number | null
          direction: Database["public"]["Enums"]["trade_direction"]
          event_timestamp: string
          event_type: Database["public"]["Enums"]["event_type"]
          id: string
          idempotency_key: string
          ingested_at: string
          install_id: string | null
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
          user_id: string
        }
        Insert: {
          account_id?: string | null
          broker_login?: string | null
          commission?: number | null
          direction: Database["public"]["Enums"]["trade_direction"]
          event_timestamp: string
          event_type: Database["public"]["Enums"]["event_type"]
          id?: string
          idempotency_key: string
          ingested_at?: string
          install_id?: string | null
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
          user_id: string
        }
        Update: {
          account_id?: string | null
          broker_login?: string | null
          commission?: number | null
          direction?: Database["public"]["Enums"]["trade_direction"]
          event_timestamp?: string
          event_type?: Database["public"]["Enums"]["event_type"]
          id?: string
          idempotency_key?: string
          ingested_at?: string
          install_id?: string | null
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
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      knowledge_chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          knowledge_entry_id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          knowledge_entry_id: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          knowledge_entry_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chat_messages_knowledge_entry_id_fkey"
            columns: ["knowledge_entry_id"]
            isOneToOne: false
            referencedRelation: "knowledge_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_entries: {
        Row: {
          concepts: Json
          created_at: string
          error_message: string | null
          id: string
          key_takeaways: Json
          raw_markdown: string | null
          screenshots: Json
          source_author: string | null
          source_published_at: string | null
          source_title: string | null
          source_url: string
          status: string
          summary: string | null
          tags: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          concepts?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          key_takeaways?: Json
          raw_markdown?: string | null
          screenshots?: Json
          source_author?: string | null
          source_published_at?: string | null
          source_title?: string | null
          source_url: string
          status?: string
          summary?: string | null
          tags?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          concepts?: Json
          created_at?: string
          error_message?: string | null
          id?: string
          key_takeaways?: Json
          raw_markdown?: string | null
          screenshots?: Json
          source_author?: string | null
          source_published_at?: string | null
          source_title?: string | null
          source_url?: string
          status?: string
          summary?: string | null
          tags?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          color: string | null
          confirmation_rules: string[] | null
          created_at: string
          description: string | null
          entry_zone_rules: Json | null
          failure_modes: string[] | null
          id: string
          invalidation_rules: string[] | null
          is_active: boolean | null
          management_rules: string[] | null
          max_daily_loss_r: number | null
          max_r_per_trade: number | null
          max_trades_per_session: number | null
          name: string
          screenshots: Json | null
          session_filter: string[] | null
          symbol_filter: string[] | null
          updated_at: string
          user_id: string
          valid_regimes: string[] | null
        }
        Insert: {
          checklist_questions?: Json
          color?: string | null
          confirmation_rules?: string[] | null
          created_at?: string
          description?: string | null
          entry_zone_rules?: Json | null
          failure_modes?: string[] | null
          id?: string
          invalidation_rules?: string[] | null
          is_active?: boolean | null
          management_rules?: string[] | null
          max_daily_loss_r?: number | null
          max_r_per_trade?: number | null
          max_trades_per_session?: number | null
          name: string
          screenshots?: Json | null
          session_filter?: string[] | null
          symbol_filter?: string[] | null
          updated_at?: string
          user_id: string
          valid_regimes?: string[] | null
        }
        Update: {
          checklist_questions?: Json
          color?: string | null
          confirmation_rules?: string[] | null
          created_at?: string
          description?: string | null
          entry_zone_rules?: Json | null
          failure_modes?: string[] | null
          id?: string
          invalidation_rules?: string[] | null
          is_active?: boolean | null
          management_rules?: string[] | null
          max_daily_loss_r?: number | null
          max_r_per_trade?: number | null
          max_trades_per_session?: number | null
          name?: string
          screenshots?: Json | null
          session_filter?: string[] | null
          symbol_filter?: string[] | null
          updated_at?: string
          user_id?: string
          valid_regimes?: string[] | null
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
          firm: string
          id: string
          is_percentage: boolean | null
          rule_name: string
          rule_type: string
          value: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          firm: string
          id?: string
          is_percentage?: boolean | null
          rule_name: string
          rule_type: string
          value: number
        }
        Update: {
          created_at?: string
          description?: string | null
          firm?: string
          id?: string
          is_percentage?: boolean | null
          rule_name?: string
          rule_type?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "prop_firm_rules_firm_fkey"
            columns: ["firm"]
            isOneToOne: false
            referencedRelation: "prop_firms"
            referencedColumns: ["id"]
          },
        ]
      }
      prop_firms: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          id: string
          is_active?: boolean
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      report_schedule_runs: {
        Row: {
          attempted_at: string
          error_message: string | null
          id: string
          period_start: string
          report_id: string | null
          report_type: string
          status: string
          user_id: string
        }
        Insert: {
          attempted_at?: string
          error_message?: string | null
          id?: string
          period_start: string
          report_id?: string | null
          report_type: string
          status: string
          user_id: string
        }
        Update: {
          attempted_at?: string
          error_message?: string | null
          id?: string
          period_start?: string
          report_id?: string | null
          report_type?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_schedule_runs_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          account_id: string | null
          consistency: Json
          created_at: string
          edge_clusters: Json
          error_message: string | null
          generated_at: string
          goals: Json | null
          grade: string | null
          id: string
          leak_clusters: Json
          metrics: Json
          period_end: string
          period_start: string
          prior_goals_evaluation: Json | null
          psychology: Json
          quant: Json | null
          read_quality: Json
          report_type: string
          schema_suggestions: Json | null
          sensei_model: string | null
          sensei_notes: Json | null
          sensei_regenerated_at: string | null
          status: string
          updated_at: string
          user_id: string
          verdict: string | null
        }
        Insert: {
          account_id?: string | null
          consistency?: Json
          created_at?: string
          edge_clusters?: Json
          error_message?: string | null
          generated_at?: string
          goals?: Json | null
          grade?: string | null
          id?: string
          leak_clusters?: Json
          metrics?: Json
          period_end: string
          period_start: string
          prior_goals_evaluation?: Json | null
          psychology?: Json
          quant?: Json | null
          read_quality?: Json
          report_type: string
          schema_suggestions?: Json | null
          sensei_model?: string | null
          sensei_notes?: Json | null
          sensei_regenerated_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verdict?: string | null
        }
        Update: {
          account_id?: string | null
          consistency?: Json
          created_at?: string
          edge_clusters?: Json
          error_message?: string | null
          generated_at?: string
          goals?: Json | null
          grade?: string | null
          id?: string
          leak_clusters?: Json
          metrics?: Json
          period_end?: string
          period_start?: string
          prior_goals_evaluation?: Json | null
          psychology?: Json
          quant?: Json | null
          read_quality?: Json
          report_type?: string
          schema_suggestions?: Json | null
          sensei_model?: string | null
          sensei_notes?: Json | null
          sensei_regenerated_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      session_definitions: {
        Row: {
          color: string
          created_at: string
          end_hour: number
          end_minute: number
          id: string
          is_active: boolean
          key: string
          name: string
          sort_order: number
          start_hour: number
          start_minute: number
          timezone: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          end_hour: number
          end_minute?: number
          id?: string
          is_active?: boolean
          key: string
          name: string
          sort_order?: number
          start_hour: number
          start_minute?: number
          timezone?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          end_hour?: number
          end_minute?: number
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          sort_order?: number
          start_hour?: number
          start_minute?: number
          timezone?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_definitions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      setup_tokens: {
        Row: {
          copier_role: Database["public"]["Enums"]["copier_role"] | null
          created_at: string
          expires_at: string
          id: string
          master_account_id: string | null
          sync_history_enabled: boolean | null
          sync_history_from: string | null
          token: string
          used: boolean | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          copier_role?: Database["public"]["Enums"]["copier_role"] | null
          created_at?: string
          expires_at: string
          id?: string
          master_account_id?: string | null
          sync_history_enabled?: boolean | null
          sync_history_from?: string | null
          token: string
          used?: boolean | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          copier_role?: Database["public"]["Enums"]["copier_role"] | null
          created_at?: string
          expires_at?: string
          id?: string
          master_account_id?: string | null
          sync_history_enabled?: boolean | null
          sync_history_from?: string | null
          token?: string
          used?: boolean | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "setup_tokens_master_account_id_fkey"
            columns: ["master_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "setup_tokens_master_account_id_fkey"
            columns: ["master_account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      shared_report_trades: {
        Row: {
          caption_what_to_improve: string | null
          caption_what_went_well: string | null
          caption_what_went_wrong: string | null
          created_at: string
          direction_override: string | null
          entry_time_override: string | null
          id: string
          playbook_name_override: string | null
          screenshot_overrides: Json
          session_override: string | null
          shared_report_id: string
          sort_order: number
          symbol_override: string | null
          trade_id: string
          updated_at: string
        }
        Insert: {
          caption_what_to_improve?: string | null
          caption_what_went_well?: string | null
          caption_what_went_wrong?: string | null
          created_at?: string
          direction_override?: string | null
          entry_time_override?: string | null
          id?: string
          playbook_name_override?: string | null
          screenshot_overrides?: Json
          session_override?: string | null
          shared_report_id: string
          sort_order?: number
          symbol_override?: string | null
          trade_id: string
          updated_at?: string
        }
        Update: {
          caption_what_to_improve?: string | null
          caption_what_went_well?: string | null
          caption_what_went_wrong?: string | null
          created_at?: string
          direction_override?: string | null
          entry_time_override?: string | null
          id?: string
          playbook_name_override?: string | null
          screenshot_overrides?: Json
          session_override?: string | null
          shared_report_id?: string
          sort_order?: number
          symbol_override?: string | null
          trade_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_report_trades_shared_report_id_fkey"
            columns: ["shared_report_id"]
            isOneToOne: false
            referencedRelation: "shared_reports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_report_trades_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_report_trades_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_reports: {
        Row: {
          author_display_name: string | null
          auto_title: boolean
          created_at: string
          id: string
          intro: string | null
          live_mode: boolean
          live_started_at: string | null
          period_end: string | null
          period_start: string | null
          published_at: string | null
          slug: string
          title: string
          updated_at: string
          user_id: string
          view_count: number
          visibility: string
        }
        Insert: {
          author_display_name?: string | null
          auto_title?: boolean
          created_at?: string
          id?: string
          intro?: string | null
          live_mode?: boolean
          live_started_at?: string | null
          period_end?: string | null
          period_start?: string | null
          published_at?: string | null
          slug: string
          title?: string
          updated_at?: string
          user_id: string
          view_count?: number
          visibility?: string
        }
        Update: {
          author_display_name?: string | null
          auto_title?: boolean
          created_at?: string
          id?: string
          intro?: string | null
          live_mode?: boolean
          live_started_at?: string | null
          period_end?: string | null
          period_start?: string | null
          published_at?: string | null
          slug?: string
          title?: string
          updated_at?: string
          user_id?: string
          view_count?: number
          visibility?: string
        }
        Relationships: []
      }
      symbol_aliases: {
        Row: {
          canonical_symbol: string
          created_at: string
          id: string
          raw_symbol: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          canonical_symbol: string
          created_at?: string
          id?: string
          raw_symbol: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          canonical_symbol?: string
          created_at?: string
          id?: string
          raw_symbol?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      symbol_groups: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          symbols: string[]
          tick_size_overrides: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          symbols?: string[]
          tick_size_overrides?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          symbols?: string[]
          tick_size_overrides?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      terminal_snapshots: {
        Row: {
          account_id: string | null
          active_login: string | null
          ea_version: string | null
          id: string
          install_id: string | null
          open_tickets: number[]
          raw_payload: Json | null
          received_at: string
          terminal_id: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          active_login?: string | null
          ea_version?: string | null
          id?: string
          install_id?: string | null
          open_tickets?: number[]
          raw_payload?: Json | null
          received_at?: string
          terminal_id: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          active_login?: string | null
          ea_version?: string | null
          id?: string
          install_id?: string | null
          open_tickets?: number[]
          raw_payload?: Json | null
          received_at?: string
          terminal_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "terminal_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "terminal_snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
        ]
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
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
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
      trade_embeddings: {
        Row: {
          content_hash: string
          content_preview: string | null
          embedding: string
          model_version: string
          trade_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content_hash: string
          content_preview?: string | null
          embedding: string
          model_version?: string
          trade_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content_hash?: string
          content_preview?: string | null
          embedding?: string
          model_version?: string
          trade_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_embeddings_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_embeddings_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_features: {
        Row: {
          computed_at: string | null
          day_of_week: number | null
          distance_to_mean_pips: number | null
          entry_efficiency: number | null
          entry_percentile: number | null
          exit_efficiency: number | null
          htf_bias: string | null
          id: string
          range_size_pips: number | null
          stop_location_quality: number | null
          time_since_session_open_mins: number | null
          trade_id: string
          volatility_regime: string | null
        }
        Insert: {
          computed_at?: string | null
          day_of_week?: number | null
          distance_to_mean_pips?: number | null
          entry_efficiency?: number | null
          entry_percentile?: number | null
          exit_efficiency?: number | null
          htf_bias?: string | null
          id?: string
          range_size_pips?: number | null
          stop_location_quality?: number | null
          time_since_session_open_mins?: number | null
          trade_id: string
          volatility_regime?: string | null
        }
        Update: {
          computed_at?: string | null
          day_of_week?: number | null
          distance_to_mean_pips?: number | null
          entry_efficiency?: number | null
          entry_percentile?: number | null
          exit_efficiency?: number | null
          htf_bias?: string | null
          id?: string
          range_size_pips?: number | null
          stop_location_quality?: number | null
          time_since_session_open_mins?: number | null
          trade_id?: string
          volatility_regime?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "trade_features_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_features_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_modifications: {
        Row: {
          created_at: string
          field: string
          id: string
          new_value: number | null
          occurred_at: string
          old_value: number | null
          trade_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          field: string
          id?: string
          new_value?: number | null
          occurred_at: string
          old_value?: number | null
          trade_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          field?: string
          id?: string
          new_value?: number | null
          occurred_at?: string
          old_value?: number | null
          trade_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_modifications_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_modifications_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_partial_fills: {
        Row: {
          commission: number | null
          created_at: string
          deal_id: number | null
          id: string
          lots: number
          occurred_at: string
          price: number
          profit: number | null
          swap: number | null
          ticket: number | null
          trade_id: string
          user_id: string
        }
        Insert: {
          commission?: number | null
          created_at?: string
          deal_id?: number | null
          id?: string
          lots: number
          occurred_at: string
          price: number
          profit?: number | null
          swap?: number | null
          ticket?: number | null
          trade_id: string
          user_id: string
        }
        Update: {
          commission?: number | null
          created_at?: string
          deal_id?: number | null
          id?: string
          lots?: number
          occurred_at?: string
          price?: number
          profit?: number | null
          swap?: number | null
          ticket?: number | null
          trade_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_partial_fills_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_partial_fills_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_repair_events: {
        Row: {
          action: string
          applied_at: string
          id: string
          metadata: Json | null
          source: string | null
          trade_id: string
          user_id: string
        }
        Insert: {
          action: string
          applied_at?: string
          id?: string
          metadata?: Json | null
          source?: string | null
          trade_id: string
          user_id: string
        }
        Update: {
          action?: string
          applied_at?: string
          id?: string
          metadata?: Json | null
          source?: string | null
          trade_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_repair_events_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_repair_events_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "trades"
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
            isOneToOne: true
            referencedRelation: "trade_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trade_reviews_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "trades"
            referencedColumns: ["id"]
          },
        ]
      }
      trades: {
        Row: {
          account_id: string | null
          actual_playbook_id: string | null
          actual_profile: string | null
          actual_regime: string | null
          alignment: string[] | null
          archived_at: string | null
          awaiting_exit: boolean
          balance_at_entry: number | null
          broker_login: string | null
          commission: number | null
          created_at: string
          custom_fields: Json
          direction: Database["public"]["Enums"]["trade_direction"]
          duration_seconds: number | null
          entry_price: number
          entry_time: string
          entry_timeframes: string[] | null
          equity_at_entry: number | null
          exit_price: number | null
          exit_time: string | null
          gross_pnl: number | null
          group_key: string | null
          group_role: string | null
          id: string
          install_id: string | null
          is_archived: boolean | null
          is_open: boolean | null
          net_pnl: number | null
          original_lots: number | null
          place: string | null
          playbook_id: string | null
          profile: string | null
          r_multiple_actual: number | null
          r_multiple_planned: number | null
          repair_state: string
          risk_percent: number | null
          session: string | null
          sl_final: number | null
          sl_initial: number | null
          swap: number | null
          symbol: string
          terminal_id: string | null
          ticket: number | null
          total_lots: number
          tp_final: number | null
          tp_initial: number | null
          trade_number: number | null
          trade_type: Database["public"]["Enums"]["trade_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id?: string | null
          actual_playbook_id?: string | null
          actual_profile?: string | null
          actual_regime?: string | null
          alignment?: string[] | null
          archived_at?: string | null
          awaiting_exit?: boolean
          balance_at_entry?: number | null
          broker_login?: string | null
          commission?: number | null
          created_at?: string
          custom_fields?: Json
          direction: Database["public"]["Enums"]["trade_direction"]
          duration_seconds?: number | null
          entry_price: number
          entry_time: string
          entry_timeframes?: string[] | null
          equity_at_entry?: number | null
          exit_price?: number | null
          exit_time?: string | null
          gross_pnl?: number | null
          group_key?: string | null
          group_role?: string | null
          id?: string
          install_id?: string | null
          is_archived?: boolean | null
          is_open?: boolean | null
          net_pnl?: number | null
          original_lots?: number | null
          place?: string | null
          playbook_id?: string | null
          profile?: string | null
          r_multiple_actual?: number | null
          r_multiple_planned?: number | null
          repair_state?: string
          risk_percent?: number | null
          session?: string | null
          sl_final?: number | null
          sl_initial?: number | null
          swap?: number | null
          symbol: string
          terminal_id?: string | null
          ticket?: number | null
          total_lots: number
          tp_final?: number | null
          tp_initial?: number | null
          trade_number?: number | null
          trade_type?: Database["public"]["Enums"]["trade_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string | null
          actual_playbook_id?: string | null
          actual_profile?: string | null
          actual_regime?: string | null
          alignment?: string[] | null
          archived_at?: string | null
          awaiting_exit?: boolean
          balance_at_entry?: number | null
          broker_login?: string | null
          commission?: number | null
          created_at?: string
          custom_fields?: Json
          direction?: Database["public"]["Enums"]["trade_direction"]
          duration_seconds?: number | null
          entry_price?: number
          entry_time?: string
          entry_timeframes?: string[] | null
          equity_at_entry?: number | null
          exit_price?: number | null
          exit_time?: string | null
          gross_pnl?: number | null
          group_key?: string | null
          group_role?: string | null
          id?: string
          install_id?: string | null
          is_archived?: boolean | null
          is_open?: boolean | null
          net_pnl?: number | null
          original_lots?: number | null
          place?: string | null
          playbook_id?: string | null
          profile?: string | null
          r_multiple_actual?: number | null
          r_multiple_planned?: number | null
          repair_state?: string
          risk_percent?: number | null
          session?: string | null
          sl_final?: number | null
          sl_initial?: number | null
          swap?: number | null
          symbol?: string
          terminal_id?: string | null
          ticket?: number | null
          total_lots?: number
          tp_final?: number | null
          tp_initial?: number | null
          trade_number?: number | null
          trade_type?: Database["public"]["Enums"]["trade_type"]
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
            foreignKeyName: "trades_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "trades_actual_playbook_id_fkey"
            columns: ["actual_playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
        ]
      }
      user_settings: {
        Row: {
          column_order: Json
          column_overrides: Json
          created_at: string
          default_filters: Json
          deleted_system_fields: Json
          detail_field_order: Json
          detail_section_order: Json
          detail_visible_fields: Json
          detail_visible_sections: Json
          display_timezone: string
          field_label_overrides: Json
          id: string
          pair_lab_prefs: Json
          ranker_comfort_dd_pct: number
          sim_balance: number
          sim_hard_cap_pct: number
          sim_prop_firm: string | null
          sim_risk_per_trade_pct: number
          sim_source: string
          updated_at: string
          user_id: string
          visible_columns: Json
        }
        Insert: {
          column_order?: Json
          column_overrides?: Json
          created_at?: string
          default_filters?: Json
          deleted_system_fields?: Json
          detail_field_order?: Json
          detail_section_order?: Json
          detail_visible_fields?: Json
          detail_visible_sections?: Json
          display_timezone?: string
          field_label_overrides?: Json
          id?: string
          pair_lab_prefs?: Json
          ranker_comfort_dd_pct?: number
          sim_balance?: number
          sim_hard_cap_pct?: number
          sim_prop_firm?: string | null
          sim_risk_per_trade_pct?: number
          sim_source?: string
          updated_at?: string
          user_id: string
          visible_columns?: Json
        }
        Update: {
          column_order?: Json
          column_overrides?: Json
          created_at?: string
          default_filters?: Json
          deleted_system_fields?: Json
          detail_field_order?: Json
          detail_section_order?: Json
          detail_visible_fields?: Json
          detail_visible_sections?: Json
          display_timezone?: string
          field_label_overrides?: Json
          id?: string
          pair_lab_prefs?: Json
          ranker_comfort_dd_pct?: number
          sim_balance?: number
          sim_hard_cap_pct?: number
          sim_prop_firm?: string | null
          sim_risk_per_trade_pct?: number
          sim_source?: string
          updated_at?: string
          user_id?: string
          visible_columns?: Json
        }
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      terminal_accounts: {
        Row: {
          account_id: string | null
          created_at: string | null
          install_id: string | null
          is_currently_active: boolean | null
          last_active_at: string | null
          terminal_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          install_id?: string | null
          is_currently_active?: never
          last_active_at?: string | null
          terminal_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          install_id?: string | null
          is_currently_active?: never
          last_active_at?: string | null
          terminal_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      trade_view: {
        Row: {
          account_id: string | null
          actual_playbook_id: string | null
          actual_profile: string | null
          actual_regime: string | null
          alignment: string[] | null
          archived_at: string | null
          balance_at_entry: number | null
          broker_login: string | null
          commission: number | null
          created_at: string | null
          custom_fields: Json | null
          direction: Database["public"]["Enums"]["trade_direction"] | null
          duration_seconds: number | null
          entry_price: number | null
          entry_time: string | null
          entry_timeframes: string[] | null
          equity_at_entry: number | null
          exit_price: number | null
          exit_time: string | null
          gross_pnl: number | null
          id: string | null
          install_id: string | null
          is_archived: boolean | null
          is_open: boolean | null
          net_pnl: number | null
          original_lots: number | null
          place: string | null
          playbook_id: string | null
          profile: string | null
          r_multiple_actual: number | null
          r_multiple_planned: number | null
          repair_state: string | null
          resolved_account_id: string | null
          risk_percent: number | null
          session: string | null
          sl_final: number | null
          sl_initial: number | null
          swap: number | null
          symbol: string | null
          terminal_id: string | null
          ticket: number | null
          total_lots: number | null
          tp_final: number | null
          tp_initial: number | null
          trade_number: number | null
          trade_type: Database["public"]["Enums"]["trade_type"] | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          actual_playbook_id?: string | null
          actual_profile?: string | null
          actual_regime?: string | null
          alignment?: string[] | null
          archived_at?: string | null
          balance_at_entry?: number | null
          broker_login?: string | null
          commission?: number | null
          created_at?: string | null
          custom_fields?: Json | null
          direction?: Database["public"]["Enums"]["trade_direction"] | null
          duration_seconds?: number | null
          entry_price?: number | null
          entry_time?: string | null
          entry_timeframes?: string[] | null
          equity_at_entry?: number | null
          exit_price?: number | null
          exit_time?: string | null
          gross_pnl?: number | null
          id?: string | null
          install_id?: string | null
          is_archived?: boolean | null
          is_open?: boolean | null
          net_pnl?: number | null
          original_lots?: number | null
          place?: string | null
          playbook_id?: string | null
          profile?: string | null
          r_multiple_actual?: number | null
          r_multiple_planned?: number | null
          repair_state?: string | null
          resolved_account_id?: never
          risk_percent?: number | null
          session?: string | null
          sl_final?: number | null
          sl_initial?: number | null
          swap?: number | null
          symbol?: string | null
          terminal_id?: string | null
          ticket?: number | null
          total_lots?: number | null
          tp_final?: number | null
          tp_initial?: number | null
          trade_number?: number | null
          trade_type?: Database["public"]["Enums"]["trade_type"] | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          actual_playbook_id?: string | null
          actual_profile?: string | null
          actual_regime?: string | null
          alignment?: string[] | null
          archived_at?: string | null
          balance_at_entry?: number | null
          broker_login?: string | null
          commission?: number | null
          created_at?: string | null
          custom_fields?: Json | null
          direction?: Database["public"]["Enums"]["trade_direction"] | null
          duration_seconds?: number | null
          entry_price?: number | null
          entry_time?: string | null
          entry_timeframes?: string[] | null
          equity_at_entry?: number | null
          exit_price?: number | null
          exit_time?: string | null
          gross_pnl?: number | null
          id?: string | null
          install_id?: string | null
          is_archived?: boolean | null
          is_open?: boolean | null
          net_pnl?: number | null
          original_lots?: number | null
          place?: string | null
          playbook_id?: string | null
          profile?: string | null
          r_multiple_actual?: number | null
          r_multiple_planned?: number | null
          repair_state?: string | null
          resolved_account_id?: never
          risk_percent?: number | null
          session?: string | null
          sl_final?: number | null
          sl_initial?: number | null
          swap?: number | null
          symbol?: string | null
          terminal_id?: string | null
          ticket?: number | null
          total_lots?: number | null
          tp_final?: number | null
          tp_initial?: number | null
          trade_number?: number | null
          trade_type?: Database["public"]["Enums"]["trade_type"] | null
          updated_at?: string | null
          user_id?: string | null
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
            foreignKeyName: "trades_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "terminal_accounts"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "trades_actual_playbook_id_fkey"
            columns: ["actual_playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trades_playbook_id_fkey"
            columns: ["playbook_id"]
            isOneToOne: false
            referencedRelation: "playbooks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      apply_equity_delta: {
        Args: { _account_id: string; _delta: number }
        Returns: undefined
      }
      enqueue_trade_embed: {
        Args: { _trade_id: string; _user_id: string }
        Returns: undefined
      }
      has_trade_access: { Args: { _trade_id: string }; Returns: boolean }
      increment_shared_report_view: {
        Args: { p_report_id: string }
        Returns: undefined
      }
      mark_dormant_accounts: { Args: never; Returns: undefined }
      match_user_trades: {
        Args: { match_count?: number; query_embedding: string }
        Returns: {
          content_preview: string
          similarity: number
          trade_id: string
        }[]
      }
      prune_monitoring_snapshots: { Args: never; Returns: undefined }
    }
    Enums: {
      account_live_state: "live" | "dormant" | "verifying" | "stale"
      account_type: "demo" | "live" | "prop"
      broker_dst_profile:
        | "EET_DST"
        | "GMT_DST"
        | "FIXED_PLUS_3"
        | "FIXED_PLUS_2"
        | "FIXED_PLUS_0"
        | "MANUAL"
      copier_role: "independent" | "master" | "receiver"
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
      regime_type: "rotational" | "transitional"
      trade_direction: "buy" | "sell"
      trade_type: "executed" | "idea" | "paper" | "missed"
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
      account_live_state: ["live", "dormant", "verifying", "stale"],
      account_type: ["demo", "live", "prop"],
      broker_dst_profile: [
        "EET_DST",
        "GMT_DST",
        "FIXED_PLUS_3",
        "FIXED_PLUS_2",
        "FIXED_PLUS_0",
        "MANUAL",
      ],
      copier_role: ["independent", "master", "receiver"],
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
      regime_type: ["rotational", "transitional"],
      trade_direction: ["buy", "sell"],
      trade_type: ["executed", "idea", "paper", "missed"],
    },
  },
} as const
