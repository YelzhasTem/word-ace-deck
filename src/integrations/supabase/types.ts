export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      card_associations: {
        Row: {
          card_id: string;
          created_at: string;
          favorite: boolean;
          id: string;
          source: string;
          text: string;
          user_id: string;
        };
        Insert: {
          card_id: string;
          created_at?: string;
          favorite?: boolean;
          id?: string;
          source?: string;
          text: string;
          user_id: string;
        };
        Update: {
          card_id?: string;
          created_at?: string;
          favorite?: boolean;
          id?: string;
          source?: string;
          text?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "card_associations_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
        ];
      };
      card_progress: {
        Row: {
          avg_ms: number | null;
          card_id: string | null;
          card_key: string;
          correct_count: number;
          deck_id: string;
          due_at: string | null;
          id: string;
          last_seen_at: string | null;
          mastery: number;
          samples: number | null;
          slow_misses: number;
          stage: number;
          total_ms: number | null;
          updated_at: string;
          user_id: string;
          wrong_count: number;
        };
        Insert: {
          avg_ms?: number | null;
          card_id?: string | null;
          card_key: string;
          correct_count?: number;
          deck_id: string;
          due_at?: string | null;
          id?: string;
          last_seen_at?: string | null;
          mastery?: number;
          samples?: number | null;
          slow_misses?: number;
          stage?: number;
          total_ms?: number | null;
          updated_at?: string;
          user_id: string;
          wrong_count?: number;
        };
        Update: {
          avg_ms?: number | null;
          card_id?: string | null;
          card_key?: string;
          correct_count?: number;
          deck_id?: string;
          due_at?: string | null;
          id?: string;
          last_seen_at?: string | null;
          mastery?: number;
          samples?: number | null;
          slow_misses?: number;
          stage?: number;
          total_ms?: number | null;
          updated_at?: string;
          user_id?: string;
          wrong_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "card_progress_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "card_progress_deck_card_fkey";
            columns: ["deck_id", "card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["deck_id", "id"];
          },
          {
            foreignKeyName: "card_progress_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      cards: {
        Row: {
          created_at: string;
          deck_id: string;
          definition: string;
          id: string;
          known: boolean;
          position: number;
          term: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deck_id: string;
          definition: string;
          id?: string;
          known?: boolean;
          position?: number;
          term: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          deck_id?: string;
          definition?: string;
          id?: string;
          known?: boolean;
          position?: number;
          term?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cards_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cards_deck_owner_fkey";
            columns: ["deck_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      collection_decks: {
        Row: {
          collection_id: string;
          created_at: string;
          deck_id: string;
          id: string;
          position: number;
          user_id: string;
        };
        Insert: {
          collection_id: string;
          created_at?: string;
          deck_id: string;
          id?: string;
          position?: number;
          user_id: string;
        };
        Update: {
          collection_id?: string;
          created_at?: string;
          deck_id?: string;
          id?: string;
          position?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "collection_decks_collection_id_fkey";
            columns: ["collection_id"];
            isOneToOne: false;
            referencedRelation: "collections";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "collection_decks_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      collection_likes: {
        Row: {
          collection_id: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          collection_id: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          collection_id?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "collection_likes_collection_id_fkey";
            columns: ["collection_id"];
            isOneToOne: false;
            referencedRelation: "collections";
            referencedColumns: ["id"];
          },
        ];
      };
      collection_ratings: {
        Row: {
          collection_id: string;
          created_at: string;
          id: string;
          rating: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          collection_id: string;
          created_at?: string;
          id?: string;
          rating: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          collection_id?: string;
          created_at?: string;
          id?: string;
          rating?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "collection_ratings_collection_id_fkey";
            columns: ["collection_id"];
            isOneToOne: false;
            referencedRelation: "collections";
            referencedColumns: ["id"];
          },
        ];
      };
      collection_reports: {
        Row: {
          collection_id: string;
          created_at: string;
          id: string;
          reason: string;
          reporter_id: string;
          reviewed_at: string | null;
          status: Database["public"]["Enums"]["report_status"];
        };
        Insert: {
          collection_id: string;
          created_at?: string;
          id?: string;
          reason?: string;
          reporter_id: string;
          reviewed_at?: string | null;
          status?: Database["public"]["Enums"]["report_status"];
        };
        Update: {
          collection_id?: string;
          created_at?: string;
          id?: string;
          reason?: string;
          reporter_id?: string;
          reviewed_at?: string | null;
          status?: Database["public"]["Enums"]["report_status"];
        };
        Relationships: [
          {
            foreignKeyName: "collection_reports_collection_id_fkey";
            columns: ["collection_id"];
            isOneToOne: false;
            referencedRelation: "collections";
            referencedColumns: ["id"];
          },
        ];
      };
      collection_saves: {
        Row: {
          collection_id: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          collection_id: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          collection_id?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "collection_saves_collection_id_fkey";
            columns: ["collection_id"];
            isOneToOne: false;
            referencedRelation: "collections";
            referencedColumns: ["id"];
          },
        ];
      };
      collections: {
        Row: {
          copy_count: number;
          created_at: string;
          description: string;
          hidden_at: string | null;
          id: string;
          keywords: string[];
          learner_count: number;
          like_count: number;
          name: string;
          published_at: string | null;
          rating_count: number;
          rating_sum: number;
          source_collection_id: string | null;
          updated_at: string;
          user_id: string;
          view_count: number;
          visibility: Database["public"]["Enums"]["deck_visibility"];
        };
        Insert: {
          copy_count?: number;
          created_at?: string;
          description?: string;
          hidden_at?: string | null;
          id?: string;
          keywords?: string[];
          learner_count?: number;
          like_count?: number;
          name: string;
          published_at?: string | null;
          rating_count?: number;
          rating_sum?: number;
          source_collection_id?: string | null;
          updated_at?: string;
          user_id: string;
          view_count?: number;
          visibility?: Database["public"]["Enums"]["deck_visibility"];
        };
        Update: {
          copy_count?: number;
          created_at?: string;
          description?: string;
          hidden_at?: string | null;
          id?: string;
          keywords?: string[];
          learner_count?: number;
          like_count?: number;
          name?: string;
          published_at?: string | null;
          rating_count?: number;
          rating_sum?: number;
          source_collection_id?: string | null;
          updated_at?: string;
          user_id?: string;
          view_count?: number;
          visibility?: Database["public"]["Enums"]["deck_visibility"];
        };
        Relationships: [
          {
            foreignKeyName: "collections_source_collection_id_fkey";
            columns: ["source_collection_id"];
            isOneToOne: false;
            referencedRelation: "collections";
            referencedColumns: ["id"];
          },
        ];
      };
      creator_follows: {
        Row: {
          created_at: string;
          creator_id: string;
          follower_id: string;
          id: string;
        };
        Insert: {
          created_at?: string;
          creator_id: string;
          follower_id: string;
          id?: string;
        };
        Update: {
          created_at?: string;
          creator_id?: string;
          follower_id?: string;
          id?: string;
        };
        Relationships: [];
      };
      deck_learning_settings: {
        Row: {
          deck_id: string;
          delayed_recall_enabled: boolean;
          id: string;
          shuffle_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          deck_id: string;
          delayed_recall_enabled?: boolean;
          id?: string;
          shuffle_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          deck_id?: string;
          delayed_recall_enabled?: boolean;
          id?: string;
          shuffle_enabled?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deck_learning_settings_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      deck_likes: {
        Row: {
          created_at: string;
          deck_id: string;
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deck_id: string;
          id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          deck_id?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deck_likes_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      deck_ratings: {
        Row: {
          created_at: string;
          deck_id: string;
          id: string;
          rating: number;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deck_id: string;
          id?: string;
          rating: number;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          deck_id?: string;
          id?: string;
          rating?: number;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deck_ratings_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      deck_reports: {
        Row: {
          created_at: string;
          deck_id: string;
          id: string;
          reason: string;
          reporter_id: string;
          reviewed_at: string | null;
          status: Database["public"]["Enums"]["report_status"];
        };
        Insert: {
          created_at?: string;
          deck_id: string;
          id?: string;
          reason?: string;
          reporter_id: string;
          reviewed_at?: string | null;
          status?: Database["public"]["Enums"]["report_status"];
        };
        Update: {
          created_at?: string;
          deck_id?: string;
          id?: string;
          reason?: string;
          reporter_id?: string;
          reviewed_at?: string | null;
          status?: Database["public"]["Enums"]["report_status"];
        };
        Relationships: [
          {
            foreignKeyName: "deck_reports_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      deck_saves: {
        Row: {
          created_at: string;
          deck_id: string;
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          deck_id: string;
          id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          deck_id?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "deck_saves_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      decks: {
        Row: {
          category: Database["public"]["Enums"]["deck_category"];
          copy_count: number;
          cover_color: string | null;
          created_at: string;
          definition_language: string;
          description: string;
          hidden_at: string | null;
          id: string;
          keywords: string[];
          learner_count: number;
          like_count: number;
          name: string;
          published_at: string | null;
          rating_count: number;
          rating_sum: number;
          source_deck_id: string | null;
          target_language: string;
          updated_at: string;
          user_id: string;
          view_count: number;
          visibility: Database["public"]["Enums"]["deck_visibility"];
        };
        Insert: {
          category?: Database["public"]["Enums"]["deck_category"];
          copy_count?: number;
          cover_color?: string | null;
          created_at?: string;
          definition_language?: string;
          description?: string;
          hidden_at?: string | null;
          id?: string;
          keywords?: string[];
          learner_count?: number;
          like_count?: number;
          name: string;
          published_at?: string | null;
          rating_count?: number;
          rating_sum?: number;
          source_deck_id?: string | null;
          target_language?: string;
          updated_at?: string;
          user_id: string;
          view_count?: number;
          visibility?: Database["public"]["Enums"]["deck_visibility"];
        };
        Update: {
          category?: Database["public"]["Enums"]["deck_category"];
          copy_count?: number;
          cover_color?: string | null;
          created_at?: string;
          definition_language?: string;
          description?: string;
          hidden_at?: string | null;
          id?: string;
          keywords?: string[];
          learner_count?: number;
          like_count?: number;
          name?: string;
          published_at?: string | null;
          rating_count?: number;
          rating_sum?: number;
          source_deck_id?: string | null;
          target_language?: string;
          updated_at?: string;
          user_id?: string;
          view_count?: number;
          visibility?: Database["public"]["Enums"]["deck_visibility"];
        };
        Relationships: [
          {
            foreignKeyName: "decks_source_deck_id_fkey";
            columns: ["source_deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      delayed_recall_entries: {
        Row: {
          card_id: string;
          correct_count: number;
          created_at: string;
          deck_id: string;
          due_at: string;
          id: string;
          interval_idx: number;
          last_review_at: string | null;
          score: number;
          stage_idx: number;
          user_id: string;
          wrong_count: number;
        };
        Insert: {
          card_id: string;
          correct_count?: number;
          created_at?: string;
          deck_id: string;
          due_at: string;
          id?: string;
          interval_idx?: number;
          last_review_at?: string | null;
          score?: number;
          stage_idx?: number;
          user_id: string;
          wrong_count?: number;
        };
        Update: {
          card_id?: string;
          correct_count?: number;
          created_at?: string;
          deck_id?: string;
          due_at?: string;
          id?: string;
          interval_idx?: number;
          last_review_at?: string | null;
          score?: number;
          stage_idx?: number;
          user_id?: string;
          wrong_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "delayed_recall_entries_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "delayed_recall_entries_deck_card_fkey";
            columns: ["deck_id", "card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["deck_id", "id"];
          },
          {
            foreignKeyName: "delayed_recall_entries_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      friendships: {
        Row: {
          addressee_id: string;
          created_at: string;
          id: string;
          requester_id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          addressee_id: string;
          created_at?: string;
          id?: string;
          requester_id: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          addressee_id?: string;
          created_at?: string;
          id?: string;
          requester_id?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "friendships_addressee_id_fkey";
            columns: ["addressee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "friendships_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      last_studied_decks: {
        Row: {
          deck_id: string;
          id: string;
          last_studied_at: string;
          user_id: string;
        };
        Insert: {
          deck_id: string;
          id?: string;
          last_studied_at?: string;
          user_id: string;
        };
        Update: {
          deck_id?: string;
          id?: string;
          last_studied_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "last_studied_decks_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      profile_private: {
        Row: {
          created_at: string;
          last_active_date: string | null;
          native_language: string;
          streak_days: number;
          target_language: string;
          total_xp: number;
          updated_at: string;
          user_id: string;
          username_privacy_review_needed: boolean;
        };
        Insert: {
          created_at?: string;
          last_active_date?: string | null;
          native_language?: string;
          streak_days?: number;
          target_language?: string;
          total_xp?: number;
          updated_at?: string;
          user_id: string;
          username_privacy_review_needed?: boolean;
        };
        Update: {
          created_at?: string;
          last_active_date?: string | null;
          native_language?: string;
          streak_days?: number;
          target_language?: string;
          total_xp?: number;
          updated_at?: string;
          user_id?: string;
          username_privacy_review_needed?: boolean;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          updated_at: string;
          user_id: string;
          username: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          updated_at?: string;
          user_id: string;
          username: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          updated_at?: string;
          user_id?: string;
          username?: string;
        };
        Relationships: [];
      };
      speed_runs: {
        Row: {
          accuracy: number;
          created_at: string;
          deck_id: string;
          duration: number;
          id: string;
          max_combo: number | null;
          score: number;
          session_id: string | null;
          user_id: string;
        };
        Insert: {
          accuracy: number;
          created_at?: string;
          deck_id: string;
          duration: number;
          id?: string;
          max_combo?: number | null;
          score: number;
          session_id?: string | null;
          user_id: string;
        };
        Update: {
          accuracy?: number;
          created_at?: string;
          deck_id?: string;
          duration?: number;
          id?: string;
          max_combo?: number | null;
          score?: number;
          session_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "speed_runs_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "speed_runs_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "study_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      streak_days: {
        Row: {
          created_at: string;
          day: string;
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          day: string;
          id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          day?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      study_events: {
        Row: {
          answered_at: string;
          card_id: string | null;
          card_key: string;
          correct: boolean;
          deck_id: string;
          id: string;
          idempotency_key: string | null;
          mode: string;
          response_ms: number | null;
          session_id: string | null;
          user_id: string;
        };
        Insert: {
          answered_at?: string;
          card_id?: string | null;
          card_key: string;
          correct: boolean;
          deck_id: string;
          id?: string;
          idempotency_key?: string | null;
          mode?: string;
          response_ms?: number | null;
          session_id?: string | null;
          user_id: string;
        };
        Update: {
          answered_at?: string;
          card_id?: string | null;
          card_key?: string;
          correct?: boolean;
          deck_id?: string;
          id?: string;
          idempotency_key?: string | null;
          mode?: string;
          response_ms?: number | null;
          session_id?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "study_events_card_id_fkey";
            columns: ["card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_events_deck_card_fkey";
            columns: ["deck_id", "card_id"];
            isOneToOne: false;
            referencedRelation: "cards";
            referencedColumns: ["deck_id", "id"];
          },
          {
            foreignKeyName: "study_events_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_events_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "study_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      study_sessions: {
        Row: {
          client_session_key: string;
          completed_at: string | null;
          completion_key: string | null;
          created_at: string;
          deck_id: string;
          duration_seconds: number | null;
          id: string;
          mode: string;
          started_at: string;
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          client_session_key: string;
          completed_at?: string | null;
          completion_key?: string | null;
          created_at?: string;
          deck_id: string;
          duration_seconds?: number | null;
          id?: string;
          mode: string;
          started_at?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          client_session_key?: string;
          completed_at?: string | null;
          completion_key?: string | null;
          created_at?: string;
          deck_id?: string;
          duration_seconds?: number | null;
          id?: string;
          mode?: string;
          started_at?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "study_sessions_deck_id_fkey";
            columns: ["deck_id"];
            isOneToOne: false;
            referencedRelation: "decks";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      can_study_card: { Args: { _card_id: string }; Returns: boolean };
      can_study_deck: { Args: { _deck_id: string }; Returns: boolean };
      complete_study_session: {
        Args: { p_completion_key: string; p_session_id: string };
        Returns: {
          accuracy: number;
          answer_count: number;
          completed_at: string;
          duplicate: boolean;
          max_combo: number;
          score: number;
          session_id: string;
          session_status: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      is_public_profile: { Args: { _user_id: string }; Returns: boolean };
      is_username_available: { Args: { _username: string }; Returns: boolean };
      list_friendships: {
        Args: never;
        Returns: {
          avatar_url: string;
          created_at: string;
          display_name: string;
          friendship_id: string;
          relationship: string;
          status: string;
          updated_at: string;
          user_id: string;
          username: string;
        }[];
      };
      make_unique_username: {
        Args: { _base: string; _user_id?: string };
        Returns: string;
      };
      mark_deck_studied: { Args: { p_deck_id: string }; Returns: string };
      normalize_username: {
        Args: { _fallback?: string; _value: string };
        Returns: string;
      };
      record_study_answer: {
        Args: {
          p_card_id: string;
          p_idempotency_key: string;
          p_progress_key?: string;
          p_response_ms?: number;
          p_result: boolean;
          p_session_id: string;
        };
        Returns: {
          avg_ms: number;
          correct_count: number;
          due_at: string;
          duplicate: boolean;
          event_id: string;
          mastery: number;
          recall_correct_count: number;
          recall_due_at: string;
          recall_interval_idx: number;
          recall_score: number;
          recall_stage_idx: number;
          recall_wrong_count: number;
          samples: number;
          slow_misses: number;
          stage: number;
          total_ms: number;
          wrong_count: number;
        }[];
      };
      reset_deck_known: { Args: { p_deck_id: string }; Returns: number };
      schedule_recall_card: { Args: { p_card_id: string }; Returns: boolean };
      search_friend_profiles: {
        Args: { _limit?: number; _query: string };
        Returns: {
          avatar_url: string;
          display_name: string;
          friendship_id: string;
          relationship: string;
          status: string;
          user_id: string;
          username: string;
        }[];
      };
      set_card_known: {
        Args: { p_card_id: string; p_known: boolean };
        Returns: boolean;
      };
      start_study_session: {
        Args: {
          p_client_session_key: string;
          p_deck_id: string;
          p_duration_seconds?: number;
          p_mode: string;
        };
        Returns: {
          session_id: string;
          session_started_at: string;
          session_status: string;
        }[];
      };
    };
    Enums: {
      app_role: "admin" | "user";
      deck_category:
        | "General English"
        | "Travel"
        | "Business"
        | "Academic"
        | "IELTS"
        | "TOEFL"
        | "Technology"
        | "Programming"
        | "Medical"
        | "Custom";
      deck_visibility: "private" | "unlisted" | "public";
      report_status: "pending" | "reviewed" | "dismissed" | "hidden";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      deck_category: [
        "General English",
        "Travel",
        "Business",
        "Academic",
        "IELTS",
        "TOEFL",
        "Technology",
        "Programming",
        "Medical",
        "Custom",
      ],
      deck_visibility: ["private", "unlisted", "public"],
      report_status: ["pending", "reviewed", "dismissed", "hidden"],
    },
  },
} as const;
