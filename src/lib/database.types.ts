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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          created_at: string
          duration_ms: number | null
          height: number | null
          id: string
          kind: Database["public"]["Enums"]["attachment_kind"]
          mime_type: string
          owner_id: string
          size_bytes: number
          storage_path: string
          waveform: number[] | null
          width: number | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          kind: Database["public"]["Enums"]["attachment_kind"]
          mime_type: string
          owner_id: string
          size_bytes: number
          storage_path: string
          waveform?: number[] | null
          width?: number | null
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["attachment_kind"]
          mime_type?: string
          owner_id?: string
          size_bytes?: number
          storage_path?: string
          waveform?: number[] | null
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          last_message_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_message_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_message_at?: string
        }
        Relationships: []
      }
      direct_messages: {
        Row: {
          attachment_id: string | null
          body: string
          conversation_id: string
          created_at: string
          deleted_at: string | null
          id: string
          kind: Database["public"]["Enums"]["dm_kind"]
          sender_id: string
          track_id: string | null
        }
        Insert: {
          attachment_id?: string | null
          body?: string
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["dm_kind"]
          sender_id: string
          track_id?: string | null
        }
        Update: {
          attachment_id?: string | null
          body?: string
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["dm_kind"]
          sender_id?: string
          track_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "direct_messages_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "direct_messages_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      lounge_members: {
        Row: {
          joined_at: string
          lounge_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Insert: {
          joined_at?: string
          lounge_id: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        Update: {
          joined_at?: string
          lounge_id?: string
          role?: Database["public"]["Enums"]["member_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lounge_members_lounge_id_fkey"
            columns: ["lounge_id"]
            isOneToOne: false
            referencedRelation: "lounges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lounge_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lounges: {
        Row: {
          created_at: string
          description: string
          icon_url: string | null
          id: string
          invite_code: string
          is_public: boolean
          name: string
          owner_id: string
          slug: string
        }
        Insert: {
          created_at?: string
          description?: string
          icon_url?: string | null
          id?: string
          invite_code?: string
          is_public?: boolean
          name: string
          owner_id: string
          slug: string
        }
        Update: {
          created_at?: string
          description?: string
          icon_url?: string | null
          id?: string
          invite_code?: string
          is_public?: boolean
          name?: string
          owner_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "lounges_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          lounge_id: string
          room_id: string | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          lounge_id: string
          room_id?: string | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          lounge_id?: string
          room_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_lounge_id_fkey"
            columns: ["lounge_id"]
            isOneToOne: false
            referencedRelation: "lounges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string
          created_at: string
          display_name: string
          id: string
          is_premium: boolean
          last_seen_at: string
          photo_url: string | null
          profile_done: boolean
          profile_video_url: string | null
          show_activity: boolean
          spotify_linked: boolean
          username: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string
          created_at?: string
          display_name?: string
          id: string
          is_premium?: boolean
          last_seen_at?: string
          photo_url?: string | null
          profile_done?: boolean
          profile_video_url?: string | null
          show_activity?: boolean
          spotify_linked?: boolean
          username: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string
          created_at?: string
          display_name?: string
          id?: string
          is_premium?: boolean
          last_seen_at?: string
          photo_url?: string | null
          profile_done?: boolean
          profile_video_url?: string | null
          show_activity?: boolean
          spotify_linked?: boolean
          username?: string
        }
        Relationships: []
      }
      provider_tokens: {
        Row: {
          access_token: string
          expires_at: string
          provider: Database["public"]["Enums"]["music_provider"]
          refresh_token: string | null
          scope: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          expires_at: string
          provider: Database["public"]["Enums"]["music_provider"]
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          expires_at?: string
          provider?: Database["public"]["Enums"]["music_provider"]
          refresh_token?: string | null
          scope?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      queue_items: {
        Row: {
          added_by: string
          created_at: string
          id: string
          played_at: string | null
          position: number
          room_id: string
          track_id: string
        }
        Insert: {
          added_by: string
          created_at?: string
          id?: string
          played_at?: string | null
          position: number
          room_id: string
          track_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          id?: string
          played_at?: string | null
          position?: number
          room_id?: string
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "queue_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_items_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "queue_items_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      reactions: {
        Row: {
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      room_participants: {
        Row: {
          is_synced: boolean
          joined_at: string
          room_id: string
          user_id: string
        }
        Insert: {
          is_synced?: boolean
          joined_at?: string
          room_id: string
          user_id: string
        }
        Update: {
          is_synced?: boolean
          joined_at?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "room_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          host_id: string
          id: string
          is_active: boolean
          is_playing: boolean
          lounge_id: string
          name: string
          paused_at_ms: number | null
          started_at_ms: number | null
          track_id: string | null
        }
        Insert: {
          created_at?: string
          host_id: string
          id?: string
          is_active?: boolean
          is_playing?: boolean
          lounge_id: string
          name?: string
          paused_at_ms?: number | null
          started_at_ms?: number | null
          track_id?: string | null
        }
        Update: {
          created_at?: string
          host_id?: string
          id?: string
          is_active?: boolean
          is_playing?: boolean
          lounge_id?: string
          name?: string
          paused_at_ms?: number | null
          started_at_ms?: number | null
          track_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rooms_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_lounge_id_fkey"
            columns: ["lounge_id"]
            isOneToOne: false
            referencedRelation: "lounges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rooms_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_metrics: {
        Row: {
          created_at: string
          drift_ms: number
          id: number
          platform: string | null
          provider: Database["public"]["Enums"]["music_provider"]
          room_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          drift_ms: number
          id?: number
          platform?: string | null
          provider: Database["public"]["Enums"]["music_provider"]
          room_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          drift_ms?: number
          id?: number
          platform?: string | null
          provider?: Database["public"]["Enums"]["music_provider"]
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_metrics_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sync_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      track_links: {
        Row: {
          confidence: number
          created_at: string
          provider: Database["public"]["Enums"]["music_provider"]
          provider_id: string
          track_id: string
        }
        Insert: {
          confidence?: number
          created_at?: string
          provider: Database["public"]["Enums"]["music_provider"]
          provider_id: string
          track_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          provider?: Database["public"]["Enums"]["music_provider"]
          provider_id?: string
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "track_links_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          album: string | null
          artist: string
          artwork_url: string | null
          created_at: string
          duration_ms: number
          id: string
          isrc: string | null
          title: string
        }
        Insert: {
          album?: string | null
          artist: string
          artwork_url?: string | null
          created_at?: string
          duration_ms: number
          id?: string
          isrc?: string | null
          title: string
        }
        Update: {
          album?: string | null
          artist?: string
          artwork_url?: string | null
          created_at?: string
          duration_ms?: number
          id?: string
          isrc?: string | null
          title?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      can_access_room: { Args: { p_room_id: string }; Returns: boolean }
      is_conversation_participant: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      is_lounge_member: { Args: { p_lounge_id: string }; Returns: boolean }
      is_room_host: { Args: { p_room_id: string }; Returns: boolean }
      join_lounge_by_code: { Args: { p_code: string }; Returns: string }
      lounge_role: {
        Args: { p_lounge_id: string }
        Returns: Database["public"]["Enums"]["member_role"]
      }
      mark_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      mark_profile_done: {
        Args: never
        Returns: {
          avatar_url: string | null
          bio: string
          created_at: string
          display_name: string
          id: string
          is_premium: boolean
          last_seen_at: string
          photo_url: string | null
          profile_done: boolean
          profile_video_url: string | null
          show_activity: boolean
          spotify_linked: boolean
          username: string
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      new_invite_code: { Args: never; Returns: string }
      open_direct_conversation: { Args: { p_other: string }; Returns: string }
      queue_append: {
        Args: { p_room_id: string; p_track_id: string }
        Returns: {
          added_by: string
          created_at: string
          id: string
          played_at: string | null
          position: number
          room_id: string
          track_id: string
        }
        SetofOptions: {
          from: "*"
          to: "queue_items"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      realtime_lounge_topic: { Args: never; Returns: string }
      room_advance: {
        Args: { p_room_id: string }
        Returns: {
          created_at: string
          host_id: string
          id: string
          is_active: boolean
          is_playing: boolean
          lounge_id: string
          name: string
          paused_at_ms: number | null
          started_at_ms: number | null
          track_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      room_pause: {
        Args: { p_room_id: string }
        Returns: {
          created_at: string
          host_id: string
          id: string
          is_active: boolean
          is_playing: boolean
          lounge_id: string
          name: string
          paused_at_ms: number | null
          started_at_ms: number | null
          track_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      room_play: {
        Args: { p_position_ms?: number; p_room_id: string; p_track_id: string }
        Returns: {
          created_at: string
          host_id: string
          id: string
          is_active: boolean
          is_playing: boolean
          lounge_id: string
          name: string
          paused_at_ms: number | null
          started_at_ms: number | null
          track_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      room_resume: {
        Args: { p_room_id: string }
        Returns: {
          created_at: string
          host_id: string
          id: string
          is_active: boolean
          is_playing: boolean
          lounge_id: string
          name: string
          paused_at_ms: number | null
          started_at_ms: number | null
          track_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      room_seek: {
        Args: { p_position_ms: number; p_room_id: string }
        Returns: {
          created_at: string
          host_id: string
          id: string
          is_active: boolean
          is_playing: boolean
          lounge_id: string
          name: string
          paused_at_ms: number | null
          started_at_ms: number | null
          track_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rooms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      server_time_ms: { Args: never; Returns: number }
      set_member_role: {
        Args: {
          p_lounge_id: string
          p_role: Database["public"]["Enums"]["member_role"]
          p_user_id: string
        }
        Returns: {
          joined_at: string
          lounge_id: string
          role: Database["public"]["Enums"]["member_role"]
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "lounge_members"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      touch_last_seen: { Args: never; Returns: undefined }
    }
    Enums: {
      attachment_kind: "image" | "video" | "file" | "voice"
      dm_kind: "text" | "image" | "video" | "file" | "voice" | "track"
      member_role: "owner" | "mod" | "member"
      music_provider: "spotify" | "youtube"
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
      attachment_kind: ["image", "video", "file", "voice"],
      dm_kind: ["text", "image", "video", "file", "voice", "track"],
      member_role: ["owner", "mod", "member"],
      music_provider: ["spotify", "youtube"],
    },
  },
} as const

/* ------------------------------------------------------------------------- */
/* Aux convenience aliases.                                                   */
/*                                                                            */
/* Everything above this line is generated by                                 */
/*   npx supabase gen types typescript --project-id figkjbunwqmbjisoajxe      */
/* and is overwritten wholesale on every regeneration. These aliases are what */
/* the app imports; re-append this block after regenerating, or 19 files stop */
/* compiling.                                                                 */
/* ------------------------------------------------------------------------- */

export type ProfileRow = Tables<'profiles'>;
export type LoungeRow = Tables<'lounges'>;
export type LoungeMemberRow = Tables<'lounge_members'>;
export type TrackRow = Tables<'tracks'>;
export type TrackLinkRow = Tables<'track_links'>;
export type RoomRow = Tables<'rooms'>;
export type RoomParticipantRow = Tables<'room_participants'>;
export type QueueItemRow = Tables<'queue_items'>;
export type MessageRow = Tables<'messages'>;

/** Direct messages. */
export type ConversationRow = Tables<'conversations'>;
export type ConversationParticipantRow = Tables<'conversation_participants'>;
export type DirectMessageRow = Tables<'direct_messages'>;
export type AttachmentRow = Tables<'attachments'>;

export type MusicProvider = Database['public']['Enums']['music_provider'];
export type MemberRole = Database['public']['Enums']['member_role'];
export type DmKind = Database['public']['Enums']['dm_kind'];
export type AttachmentKind = Database['public']['Enums']['attachment_kind'];
