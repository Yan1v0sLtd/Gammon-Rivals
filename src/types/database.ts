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
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name: string;
          is_guest?: boolean;
          rating?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          display_name?: string;
          is_guest?: boolean;
          rating?: number;
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
    };
    Views: { [_ in never]: never };
    Functions: {
      join_match_by_invite: { Args: { invite: string }; Returns: string };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
