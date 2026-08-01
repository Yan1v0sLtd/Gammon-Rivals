export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string;
          is_guest: boolean;
          rating: number;
          pvp_rating: number;
          avatar_seed: string;
          avatar_url: string | null;
          level: number;
          xp: number;
          is_suspended: boolean;
          suspended_at: string | null;
          suspension_reason: string | null;
          admin_note: string | null;
          deleted_at: string | null;
          deleted_by: string | null;
          delete_note: string | null;
          last_seen_at: string | null;
          tutorial_completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          is_guest?: boolean;
          rating?: number;
          pvp_rating?: number;
          avatar_seed?: string;
          avatar_url?: string | null;
          level?: number;
          xp?: number;
          is_suspended?: boolean;
          suspended_at?: string | null;
          suspension_reason?: string | null;
          admin_note?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          delete_note?: string | null;
          last_seen_at?: string | null;
          tutorial_completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          is_guest?: boolean;
          rating?: number;
          pvp_rating?: number;
          avatar_seed?: string;
          avatar_url?: string | null;
          level?: number;
          xp?: number;
          is_suspended?: boolean;
          suspended_at?: string | null;
          suspension_reason?: string | null;
          admin_note?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          delete_note?: string | null;
          last_seen_at?: string | null;
          tutorial_completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      matches: {
        Row: {
          id: string;
          owner_id: string;
          opponent_id: string | null;
          owner_color: string;
          invite_code: string | null;
          invite_expires_at: string | null;
          current_turn: Json | null;
          current_game_id: string | null;
          cube_value: number;
          cube_owner: string | null;
          cube_offer: string | null;
          is_public: boolean;
          mode: string;
          is_bot: boolean;
          bot_level: string | null;
          target: number;
          white_score: number;
          black_score: number;
          winner: string | null;
          crawford_game_number: number | null;
          table_config_id: string | null;
          started_at: string;
          finished_at: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          opponent_id?: string | null;
          owner_color?: string;
          invite_code?: string | null;
          invite_expires_at?: string | null;
          current_turn?: Json | null;
          current_game_id?: string | null;
          cube_value?: number;
          cube_owner?: string | null;
          cube_offer?: string | null;
          is_public?: boolean;
          mode: string;
          is_bot?: boolean;
          bot_level?: string | null;
          target: number;
          white_score?: number;
          black_score?: number;
          winner?: string | null;
          crawford_game_number?: number | null;
          table_config_id?: string | null;
          started_at?: string;
          finished_at?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          opponent_id?: string | null;
          owner_color?: string;
          invite_code?: string | null;
          invite_expires_at?: string | null;
          current_turn?: Json | null;
          current_game_id?: string | null;
          cube_value?: number;
          cube_owner?: string | null;
          cube_offer?: string | null;
          is_public?: boolean;
          mode?: string;
          is_bot?: boolean;
          bot_level?: string | null;
          target?: number;
          white_score?: number;
          black_score?: number;
          winner?: string | null;
          crawford_game_number?: number | null;
          table_config_id?: string | null;
          started_at?: string;
          finished_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      games: {
        Row: {
          id: string;
          match_id: string;
          game_number: number;
          winner: string | null;
          win_type: string | null;
          cube_value: number;
          cube_owner: string | null;
          dropped_double: boolean;
          points_awarded: number;
          was_crawford: boolean;
          started_at: string;
          finished_at: string | null;
        };
        Insert: {
          id?: string;
          match_id: string;
          game_number: number;
          winner?: string | null;
          win_type?: string | null;
          cube_value?: number;
          cube_owner?: string | null;
          dropped_double?: boolean;
          points_awarded?: number;
          was_crawford?: boolean;
          started_at?: string;
          finished_at?: string | null;
        };
        Update: {
          id?: string;
          match_id?: string;
          game_number?: number;
          winner?: string | null;
          win_type?: string | null;
          cube_value?: number;
          cube_owner?: string | null;
          dropped_double?: boolean;
          points_awarded?: number;
          was_crawford?: boolean;
          started_at?: string;
          finished_at?: string | null;
        };
        Relationships: [];
      };
      moves: {
        Row: {
          id: number;
          game_id: string;
          ply: number;
          player: string;
          dice: number[];
          sub_moves: Json;
          elapsed_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          game_id: string;
          ply: number;
          player: string;
          dice: number[];
          sub_moves: Json;
          elapsed_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          game_id?: string;
          ply?: number;
          player?: string;
          dice?: number[];
          sub_moves?: Json;
          elapsed_ms?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      admin_roles: {
        Row: {
          profile_id: string;
          role: 'owner' | 'admin' | 'support' | 'viewer';
          note: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          role: 'owner' | 'admin' | 'support' | 'viewer';
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          profile_id?: string;
          role?: 'owner' | 'admin' | 'support' | 'viewer';
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      admin_email_allowlist: {
        Row: {
          email: string;
          role: 'owner' | 'admin' | 'support' | 'viewer';
          note: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          email: string;
          role: 'owner' | 'admin' | 'support' | 'viewer';
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          role?: 'owner' | 'admin' | 'support' | 'viewer';
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      admin_audit_log: {
        Row: {
          id: string;
          actor_profile_id: string | null;
          action: 'insert' | 'update' | 'delete';
          entity_table: string;
          entity_id: string;
          before_value: Json | null;
          after_value: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_profile_id?: string | null;
          action: 'insert' | 'update' | 'delete';
          entity_table: string;
          entity_id: string;
          before_value?: Json | null;
          after_value?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_profile_id?: string | null;
          action?: 'insert' | 'update' | 'delete';
          entity_table?: string;
          entity_id?: string;
          before_value?: Json | null;
          after_value?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      lobby_feature_configs: {
        Row: {
          id: string;
          feature_key: string;
          label: string;
          unlock_level: number;
          is_enabled: boolean;
          sort_order: number;
          tooltip_text: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          feature_key: string;
          label: string;
          unlock_level?: number;
          is_enabled?: boolean;
          sort_order?: number;
          tooltip_text?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          feature_key?: string;
          label?: string;
          unlock_level?: number;
          is_enabled?: boolean;
          sort_order?: number;
          tooltip_text?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      board_theme_configs: {
        Row: {
          id: string;
          display_name: string;
          preview_image: string;
          gameplay_image: string;
          lobby_background_image: string | null;
          white_checker_image: string | null;
          black_checker_image: string | null;
          dice_image: string | null;
          tray_image: string | null;
          holder_image: string | null;
          unlock_level: number;
          price_coins: number;
          price_gems: number;
          is_enabled: boolean;
          is_featured: boolean;
          sort_order: number;
          metadata: Json;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          preview_image: string;
          gameplay_image: string;
          lobby_background_image?: string | null;
          white_checker_image?: string | null;
          black_checker_image?: string | null;
          dice_image?: string | null;
          tray_image?: string | null;
          holder_image?: string | null;
          unlock_level?: number;
          price_coins?: number;
          price_gems?: number;
          is_enabled?: boolean;
          is_featured?: boolean;
          sort_order?: number;
          metadata?: Json;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          preview_image?: string;
          gameplay_image?: string;
          lobby_background_image?: string | null;
          white_checker_image?: string | null;
          black_checker_image?: string | null;
          dice_image?: string | null;
          tray_image?: string | null;
          holder_image?: string | null;
          unlock_level?: number;
          price_coins?: number;
          price_gems?: number;
          is_enabled?: boolean;
          is_featured?: boolean;
          sort_order?: number;
          metadata?: Json;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      currency_configs: {
        Row: {
          code: string;
          display_name: string;
          usd_value_micros: number;
          is_enabled: boolean;
          sort_order: number;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          display_name: string;
          usd_value_micros: number;
          is_enabled?: boolean;
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          display_name?: string;
          usd_value_micros?: number;
          is_enabled?: boolean;
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      daily_bonus_configs: {
        Row: {
          day: number;
          reward_coins: number;
          reward_gems: number;
          reward_xp: number;
          reward_items: Json;
          metadata: Json;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          day: number;
          reward_coins?: number;
          reward_gems?: number;
          reward_xp?: number;
          reward_items?: Json;
          metadata?: Json;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          day?: number;
          reward_coins?: number;
          reward_gems?: number;
          reward_xp?: number;
          reward_items?: Json;
          metadata?: Json;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      level_configs: {
        Row: {
          level: number;
          xp_required: number;
          reward_coins: number;
          reward_gems: number;
          reward_items: Json;
          unlock_rules: Json;
          status_label: string;
          is_enabled: boolean;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          level: number;
          xp_required: number;
          reward_coins?: number;
          reward_gems?: number;
          reward_items?: Json;
          unlock_rules?: Json;
          status_label?: string;
          is_enabled?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          level?: number;
          xp_required?: number;
          reward_coins?: number;
          reward_gems?: number;
          reward_items?: Json;
          unlock_rules?: Json;
          status_label?: string;
          is_enabled?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      level_status_tiers: {
        Row: {
          id: string;
          level_from: number;
          level_to: number;
          label: string;
          sort_order: number;
          is_enabled: boolean;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          level_from: number;
          level_to: number;
          label: string;
          sort_order?: number;
          is_enabled?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          level_from?: number;
          level_to?: number;
          label?: string;
          sort_order?: number;
          is_enabled?: boolean;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      economy_grants: {
        Row: {
          trigger_key: string;
          display_name: string;
          description: string;
          coins: number;
          gems: number;
          one_time: boolean;
          is_enabled: boolean;
          sort_order: number;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          trigger_key: string;
          display_name: string;
          description?: string;
          coins?: number;
          gems?: number;
          one_time?: boolean;
          is_enabled?: boolean;
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          trigger_key?: string;
          display_name?: string;
          description?: string;
          coins?: number;
          gems?: number;
          one_time?: boolean;
          is_enabled?: boolean;
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      player_grants: {
        Row: {
          id: string;
          profile_id: string;
          trigger_key: string;
          coins: number;
          gems: number;
          granted_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          trigger_key: string;
          coins?: number;
          gems?: number;
          granted_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          trigger_key?: string;
          coins?: number;
          gems?: number;
          granted_at?: string;
        };
        Relationships: [];
      };
      loading_screen_images: {
        Row: {
          id: string;
          name: string;
          image_url: string;
          is_active: boolean;
          sort_order: number;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name?: string;
          image_url: string;
          is_active?: boolean;
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          image_url?: string;
          is_active?: boolean;
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      podium_images: {
        Row: {
          id: string;
          name: string;
          image_url: string;
          is_active: boolean;
          sort_order: number;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name?: string;
          image_url: string;
          is_active?: boolean;
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          image_url?: string;
          is_active?: boolean;
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      table_configs: {
        Row: {
          id: string;
          kind: 'standard' | 'difficulty';
          display_name: string;
          description: string;
          entry_fee_coins: number;
          prize_coins: number;
          prize_coins_loss: number;
          required_level: number;
          match_target: number;
          allow_ai: boolean;
          allow_online: boolean;
          is_enabled: boolean;
          sort_order: number;
          xp_multiplier_pct: number;
          base_xp_win: number;
          turn_seconds: number;
          accent_color: string;
          ai_level: 'easy' | 'medium' | 'hard';
          target_rtp_pct: number;
          allow_online_pvp: boolean;
          server_bot: boolean;
          metadata: Json;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          server_bot?: boolean;
          kind?: 'standard' | 'difficulty';
          display_name: string;
          description?: string;
          entry_fee_coins?: number;
          prize_coins?: number;
          prize_coins_loss?: number;
          required_level?: number;
          match_target?: number;
          allow_ai?: boolean;
          allow_online?: boolean;
          is_enabled?: boolean;
          sort_order?: number;
          xp_multiplier_pct?: number;
          base_xp_win?: number;
          turn_seconds?: number;
          accent_color?: string;
          ai_level?: 'easy' | 'medium' | 'hard';
          target_rtp_pct?: number;
          allow_online_pvp?: boolean;
          metadata?: Json;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          server_bot?: boolean;
          kind?: 'standard' | 'difficulty';
          display_name?: string;
          description?: string;
          entry_fee_coins?: number;
          prize_coins?: number;
          prize_coins_loss?: number;
          required_level?: number;
          match_target?: number;
          allow_ai?: boolean;
          allow_online?: boolean;
          is_enabled?: boolean;
          sort_order?: number;
          xp_multiplier_pct?: number;
          base_xp_win?: number;
          turn_seconds?: number;
          accent_color?: string;
          ai_level?: 'easy' | 'medium' | 'hard';
          target_rtp_pct?: number;
          allow_online_pvp?: boolean;
          metadata?: Json;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_wallets: {
        Row: {
          profile_id: string;
          coins: number;
          gems: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          coins?: number;
          gems?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          profile_id?: string;
          coins?: number;
          gems?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      wallet_transactions: {
        Row: {
          id: string;
          profile_id: string;
          currency: 'coins' | 'gems';
          amount: number;
          balance_after: number;
          source:
            | 'admin_adjustment'
            | 'match_reward'
            | 'purchase'
            | 'daily_bonus'
            | 'level_reward'
            | 'refund'
            | 'system';
          reason: string;
          metadata: Json;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          currency: 'coins' | 'gems';
          amount: number;
          balance_after: number;
          source?:
            | 'admin_adjustment'
            | 'match_reward'
            | 'purchase'
            | 'daily_bonus'
            | 'level_reward'
            | 'refund'
            | 'system';
          reason: string;
          metadata?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          currency?: 'coins' | 'gems';
          amount?: number;
          balance_after?: number;
          source?:
            | 'admin_adjustment'
            | 'match_reward'
            | 'purchase'
            | 'daily_bonus'
            | 'level_reward'
            | 'refund'
            | 'system';
          reason?: string;
          metadata?: Json;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      user_board_inventory: {
        Row: {
          profile_id: string;
          board_theme_id: string;
          source: 'default' | 'purchase' | 'level_reward' | 'admin_grant' | 'bundle';
          granted_by: string | null;
          created_at: string;
        };
        Insert: {
          profile_id: string;
          board_theme_id: string;
          source?: 'default' | 'purchase' | 'level_reward' | 'admin_grant' | 'bundle';
          granted_by?: string | null;
          created_at?: string;
        };
        Update: {
          profile_id?: string;
          board_theme_id?: string;
          source?: 'default' | 'purchase' | 'level_reward' | 'admin_grant' | 'bundle';
          granted_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      user_daily_bonuses: {
        Row: {
          profile_id: string;
          current_day: number;
          last_claim_date_et: string | null;
          last_claim_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          profile_id: string;
          current_day?: number;
          last_claim_date_et?: string | null;
          last_claim_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          profile_id?: string;
          current_day?: number;
          last_claim_date_et?: string | null;
          last_claim_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      purchases: {
        Row: {
          id: string;
          profile_id: string;
          product_id: string;
          product_type: 'coin_pack' | 'gem_pack' | 'board_theme' | 'cosmetic' | 'bundle' | 'special_offer';
          provider: 'apple' | 'google' | 'stripe' | 'admin' | 'test';
          provider_transaction_id: string | null;
          price_cents: number | null;
          currency_code: string;
          contents: Json;
          status: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          product_id: string;
          product_type: 'coin_pack' | 'gem_pack' | 'board_theme' | 'cosmetic' | 'bundle' | 'special_offer';
          provider?: 'apple' | 'google' | 'stripe' | 'admin' | 'test';
          provider_transaction_id?: string | null;
          price_cents?: number | null;
          currency_code?: string;
          contents?: Json;
          status?: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          product_id?: string;
          product_type?: 'coin_pack' | 'gem_pack' | 'board_theme' | 'cosmetic' | 'bundle' | 'special_offer';
          provider?: 'apple' | 'google' | 'stripe' | 'admin' | 'test';
          provider_transaction_id?: string | null;
          price_cents?: number | null;
          currency_code?: string;
          contents?: Json;
          status?: 'pending' | 'completed' | 'failed' | 'refunded' | 'cancelled';
          created_at?: string;
        };
        Relationships: [];
      };
      shop_items: {
        Row: {
          id: string;
          kind: 'coin_pack' | 'gem_pack' | 'board_theme' | 'cosmetic' | 'bundle' | 'special_offer';
          display_name: string;
          description: string;
          image_url: string | null;
          price_cents: number | null;
          price_coins: number | null;
          price_gems: number | null;
          apple_product_id: string | null;
          google_product_id: string | null;
          contents: Json;
          visibility_rules: Json;
          starts_at: string | null;
          ends_at: string | null;
          max_purchases_per_user: number | null;
          is_enabled: boolean;
          exclude_from_sale: boolean;
          sort_order: number;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          kind: 'coin_pack' | 'gem_pack' | 'board_theme' | 'cosmetic' | 'bundle' | 'special_offer';
          display_name: string;
          description?: string;
          image_url?: string | null;
          price_cents?: number | null;
          price_coins?: number | null;
          price_gems?: number | null;
          apple_product_id?: string | null;
          google_product_id?: string | null;
          contents?: Json;
          visibility_rules?: Json;
          starts_at?: string | null;
          ends_at?: string | null;
          max_purchases_per_user?: number | null;
          is_enabled?: boolean;
          exclude_from_sale?: boolean;
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          kind?: 'coin_pack' | 'gem_pack' | 'board_theme' | 'cosmetic' | 'bundle' | 'special_offer';
          display_name?: string;
          description?: string;
          image_url?: string | null;
          price_cents?: number | null;
          price_coins?: number | null;
          price_gems?: number | null;
          apple_product_id?: string | null;
          google_product_id?: string | null;
          contents?: Json;
          visibility_rules?: Json;
          starts_at?: string | null;
          ends_at?: string | null;
          max_purchases_per_user?: number | null;
          is_enabled?: boolean;
          exclude_from_sale?: boolean;
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      store_sales: {
        Row: {
          id: string;
          label: string;
          bonus_percent: number;
          is_active: boolean;
          starts_at: string | null;
          ends_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          label?: string;
          bonus_percent?: number;
          is_active?: boolean;
          starts_at?: string | null;
          ends_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          label?: string;
          bonus_percent?: number;
          is_active?: boolean;
          starts_at?: string | null;
          ends_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      store_config: {
        Row: {
          id: boolean;
          title: string;
          bg_image_url: string | null;
          updated_at: string;
        };
        Insert: {
          id?: boolean;
          title?: string;
          bg_image_url?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: boolean;
          title?: string;
          bg_image_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_xp_boosts: {
        Row: {
          id: string;
          profile_id: string;
          multiplier: number;
          expires_at: string;
          source: 'purchase' | 'admin' | 'daily_bonus' | 'event' | 'test';
          shop_item_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          multiplier: number;
          expires_at: string;
          source?: 'purchase' | 'admin' | 'daily_bonus' | 'event' | 'test';
          shop_item_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          multiplier?: number;
          expires_at?: string;
          source?: 'purchase' | 'admin' | 'daily_bonus' | 'event' | 'test';
          shop_item_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      wheel_configs: {
        Row: {
          id: string;
          display_name: string;
          cooldown_seconds: number;
          is_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          cooldown_seconds?: number;
          is_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          cooldown_seconds?: number;
          is_enabled?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      wheel_slots: {
        Row: {
          config_id: string;
          slot_index: number;
          primary_reward_type: string;
          primary_reward_amount: number;
          primary_reward_icon_url: string | null;
          secondary_reward_type: string | null;
          secondary_reward_amount: number | null;
          secondary_reward_icon_url: string | null;
          chance_basis_points: number;
          label: string | null;
          accent_color: string;
          is_enabled: boolean;
        };
        Insert: {
          config_id: string;
          slot_index: number;
          primary_reward_type: string;
          primary_reward_amount: number;
          primary_reward_icon_url?: string | null;
          secondary_reward_type?: string | null;
          secondary_reward_amount?: number | null;
          secondary_reward_icon_url?: string | null;
          chance_basis_points: number;
          label?: string | null;
          accent_color?: string;
          is_enabled?: boolean;
        };
        Update: {
          config_id?: string;
          slot_index?: number;
          primary_reward_type?: string;
          primary_reward_amount?: number;
          primary_reward_icon_url?: string | null;
          secondary_reward_type?: string | null;
          secondary_reward_amount?: number | null;
          secondary_reward_icon_url?: string | null;
          chance_basis_points?: number;
          label?: string | null;
          accent_color?: string;
          is_enabled?: boolean;
        };
        Relationships: [];
      };
      user_wheel_spins: {
        Row: {
          profile_id: string;
          config_id: string;
          last_spin_at: string | null;
          total_spins: number;
          last_slot_index: number | null;
          last_reward_coins: number;
          last_reward_gems: number;
          last_reward_xp: number;
        };
        Insert: {
          profile_id: string;
          config_id: string;
          last_spin_at?: string | null;
          total_spins?: number;
          last_slot_index?: number | null;
          last_reward_coins?: number;
          last_reward_gems?: number;
          last_reward_xp?: number;
        };
        Update: {
          last_spin_at?: string | null;
          total_spins?: number;
          last_slot_index?: number | null;
          last_reward_coins?: number;
          last_reward_gems?: number;
          last_reward_xp?: number;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      join_match_by_invite: { Args: { invite: string }; Returns: string };
      join_public_match: { Args: { target_match_id: string }; Returns: string };
      matchmake: { Args: { p_target: number }; Returns: string | null };
      cancel_matchmaking: { Args: Record<string, never>; Returns: void };
      admin_adjust_wallet: {
        Args: {
          target_profile_id: string;
          currency_code: string;
          delta_amount: number;
          adjustment_reason: string;
        };
        Returns: Database['public']['Tables']['user_wallets']['Row'];
      };
      purchase_board_with_gems: {
        Args: { target_board_id: string };
        Returns: Database['public']['Tables']['user_wallets']['Row'];
      };
      purchase_shop_item: {
        Args: { target_item_id: string };
        Returns: Database['public']['Tables']['user_wallets']['Row'];
      };
      current_store_sale: {
        Args: Record<string, never>;
        Returns: { label: string; bonus_percent: number; ends_at: string | null }[];
      };
      admin_hard_delete_user: {
        Args: { target_id: string };
        Returns: void;
      };
      recompute_player_levels: {
        Args: Record<string, never>;
        Returns: number;
      };
      mark_tutorial_complete: {
        Args: Record<string, never>;
        Returns: void;
      };
      test_purchase_shop_item: {
        Args: { p_item_id: string; p_target_profile_id?: string | null };
        Returns: Database['public']['Tables']['user_wallets']['Row'];
      };
      set_active_podium: {
        Args: { p_id: string };
        Returns: void;
      };
      set_active_loading_screen: {
        Args: { p_id: string };
        Returns: void;
      };
      admin_upsert_economy_grant: {
        Args: {
          p_trigger_key: string;
          p_display_name: string;
          p_description: string;
          p_coins: number;
          p_gems: number;
          p_one_time: boolean;
          p_is_enabled: boolean;
          p_sort_order: number;
        };
        Returns: Database['public']['Tables']['economy_grants']['Row'];
      };
      admin_upsert_currency_config: {
        Args: {
          p_code: string;
          p_display_name: string;
          p_usd_value_micros: number;
          p_is_enabled: boolean;
          p_sort_order: number;
        };
        Returns: Database['public']['Tables']['currency_configs']['Row'];
      };
      claim_daily_bonus: {
        Args: Record<string, never>;
        Returns: Json;
      };
      current_xp_multiplier: {
        Args: { target_profile_id: string };
        Returns: number;
      };
      find_match_in_tier: {
        Args: { p_table_config_id: string; p_rating_band?: number };
        Returns: Json;
      };
      enter_room_ai_fallback: {
        Args: { p_table_config_id: string };
        Returns: Json;
      };
      finish_match: {
        Args: {
          p_match_id: string;
          p_white_score: number;
          p_black_score: number;
          p_winner: string | null;
          p_crawford_game_number?: number | null;
          p_owner_abandoned?: boolean;
          p_opponent_abandoned?: boolean;
        };
        Returns: Json;
      };
      get_rtp_summary: {
        Args: { p_since?: string | null };
        Returns: ReadonlyArray<{
          out_table_config_id: string;
          out_display_name: string;
          out_target_rtp_pct: number;
          out_matches_played: number;
          out_matches_won: number;
          out_actual_win_rate_pct: number | null;
          out_coins_wagered: number;
          out_coins_paid_out: number;
          out_coins_house_net: number;
          out_actual_rtp_pct: number | null;
          out_rtp_delta_pct: number | null;
          out_risk_free_count: number;
        }>;
      };
      abandon_stale_matches: {
        Args: { p_max_age_minutes?: number };
        Returns: Json;
      };
      replace_opponent_with_ai: {
        Args: { p_match_id: string; p_min_inactive_seconds?: number };
        Returns: Json;
      };
      finish_turn: {
        Args: {
          p_match_id: string;
          p_game_winner?: 'white' | 'black' | null;
          p_game_win_type?: 'single' | 'gammon' | 'backgammon' | null;
          p_game_points?: number | null;
          p_game_dropped_double?: boolean;
          p_new_white_score?: number | null;
          p_new_black_score?: number | null;
          p_match_winner?: 'white' | 'black' | null;
          p_crawford_game_number?: number | null;
          p_elapsed_ms?: number | null;
        };
        Returns: Json;
      };
      get_wheel_state: {
        Args: { p_config_id?: string };
        Returns: Json;
      };
      spin_wheel: {
        Args: { p_config_id?: string };
        Returns: Json;
      };
      // Daily Missions (Phase 4-6) — types added manually since a
      // full Supabase types regen would lose the project's hand-
      // patched phantom columns (profiles.avatar_url etc).
      get_player_missions_today: {
        Args: Record<string, never>;
        Returns: Json;
      };
      claim_mission: {
        Args: { p_mission_id: string };
        Returns: Json;
      };
      reroll_mission: {
        Args: { p_mission_id: string };
        Returns: Json;
      };
      claim_chest: {
        Args: { p_milestone_index: number };
        Returns: Json;
      };
      claim_streak_chest: {
        Args: Record<string, never>;
        Returns: Json;
      };
      // Lobby premium profile card — see migration
      // 20260630000000_lobby_profile_stats_rpc.sql. Returns
      // { highest_win, streak_days, wins, total_finished, win_rate_pct }.
      get_player_lobby_stats: {
        Args: Record<string, never>;
        Returns: Json;
      };
      // Daily Missions Phase 8 — simulation harness (BO-only).
      simulate_create_test_profile: {
        Args: { p_display_name: string; p_level?: number; p_pvp_rating?: number };
        Returns: string;
      };
      simulate_set_metric: {
        Args: { p_profile_id: string; p_metric_code: string; p_baseline: number };
        Returns: string;
      };
      simulate_reset_today_missions: {
        Args: { p_profile_id: string };
        Returns: number;
      };
      simulate_spawn_archetypes: {
        Args: { p_casuals?: number; p_regulars?: number; p_whales?: number };
        Returns: Json;
      };
      simulate_cleanup_all: {
        Args: Record<string, never>;
        Returns: number;
      };
      simulate_get_test_user_state: {
        Args: { p_profile_id: string };
        Returns: Json;
      };
      simulate_list_test_profiles: {
        Args: Record<string, never>;
        Returns: Json;
      };
      assign_daily_missions_for_profile: {
        Args: { p_profile_id: string };
        Returns: number;
      };
      get_rtp_per_player: {
        Args: {
          p_table_config_id: string;
          p_since?: string | null;
          p_limit?: number;
        };
        Returns: ReadonlyArray<{
          out_profile_id: string;
          out_display_name: string;
          out_matches_played: number;
          out_matches_won: number;
          out_win_rate_pct: number | null;
          out_coins_wagered: number;
          out_coins_paid_out: number;
          out_coins_house_net: number;
          out_actual_rtp_pct: number | null;
        }>;
      };
      get_my_admin_role: {
        Args: Record<string, never>;
        Returns: 'owner' | 'admin' | 'support' | 'viewer' | null;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
