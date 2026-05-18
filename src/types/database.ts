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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          is_guest?: boolean;
          rating?: number;
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
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          is_guest?: boolean;
          rating?: number;
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
          target: number;
          white_score: number;
          black_score: number;
          winner: string | null;
          crawford_game_number: number | null;
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
          target: number;
          white_score?: number;
          black_score?: number;
          winner?: string | null;
          crawford_game_number?: number | null;
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
          target?: number;
          white_score?: number;
          black_score?: number;
          winner?: string | null;
          crawford_game_number?: number | null;
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
          created_at: string;
        };
        Insert: {
          id?: number;
          game_id: string;
          ply: number;
          player: string;
          dice: number[];
          sub_moves: Json;
          created_at?: string;
        };
        Update: {
          id?: number;
          game_id?: string;
          ply?: number;
          player?: string;
          dice?: number[];
          sub_moves?: Json;
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
      table_configs: {
        Row: {
          id: string;
          display_name: string;
          description: string;
          entry_fee_coins: number;
          prize_coins: number;
          required_level: number;
          match_target: number;
          allow_ai: boolean;
          allow_online: boolean;
          is_enabled: boolean;
          sort_order: number;
          metadata: Json;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          description?: string;
          entry_fee_coins?: number;
          prize_coins?: number;
          required_level?: number;
          match_target?: number;
          allow_ai?: boolean;
          allow_online?: boolean;
          is_enabled?: boolean;
          sort_order?: number;
          metadata?: Json;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          description?: string;
          entry_fee_coins?: number;
          prize_coins?: number;
          required_level?: number;
          match_target?: number;
          allow_ai?: boolean;
          allow_online?: boolean;
          is_enabled?: boolean;
          sort_order?: number;
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
          sort_order?: number;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
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
      claim_daily_bonus: {
        Args: Record<string, never>;
        Returns: Json;
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
