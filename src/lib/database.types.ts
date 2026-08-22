/**
 * Types for the Aux Postgres schema.
 *
 * Hand-authored to mirror supabase/migrations/*.sql exactly so the app is
 * type-safe before a Supabase project exists. Once you have linked a project,
 * regenerate instead of editing by hand:
 *
 *   npx supabase gen types typescript --linked > src/lib/database.types.ts
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MemberRole = 'owner' | 'mod' | 'member';
export type MusicProvider = 'spotify' | 'youtube';

type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  spotify_linked: boolean;
  is_premium: boolean;
  created_at: string;
};

type Lounge = {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon_url: string | null;
  owner_id: string;
  is_public: boolean;
  invite_code: string;
  created_at: string;
};

type LoungeMember = {
  lounge_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
};

type Track = {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration_ms: number;
  isrc: string | null;
  artwork_url: string | null;
  created_at: string;
};

type TrackLink = {
  track_id: string;
  provider: MusicProvider;
  provider_id: string;
  confidence: number;
  created_at: string;
};

type Room = {
  id: string;
  lounge_id: string;
  name: string;
  host_id: string;
  track_id: string | null;
  started_at_ms: number | null;
  paused_at_ms: number | null;
  is_playing: boolean;
  is_active: boolean;
  created_at: string;
};

type RoomParticipant = {
  room_id: string;
  user_id: string;
  joined_at: string;
  is_synced: boolean;
};

type QueueItem = {
  id: string;
  room_id: string;
  track_id: string;
  added_by: string;
  position: number;
  played_at: string | null;
  created_at: string;
};

type Message = {
  id: string;
  lounge_id: string;
  room_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
};

type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
};

type SyncMetric = {
  id: number;
  room_id: string;
  user_id: string;
  provider: MusicProvider;
  drift_ms: number;
  platform: string | null;
  created_at: string;
};

/** Columns the database fills in for us, so callers may omit them on insert. */
type Generated = 'id' | 'created_at' | 'joined_at' | 'updated_at';

type TableDef<Row, RequiredOnInsert extends keyof Row = never> = {
  Row: Row;
  Insert: Partial<Omit<Row, Extract<keyof Row, Generated>>> &
    Pick<Row, RequiredOnInsert> & { id?: string; created_at?: string };
  Update: Partial<Row>;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<Profile, 'id' | 'username'>;
      lounges: TableDef<Lounge, 'name' | 'slug' | 'owner_id'>;
      lounge_members: TableDef<LoungeMember, 'lounge_id' | 'user_id'>;
      tracks: TableDef<Track, 'title' | 'artist' | 'duration_ms'>;
      track_links: TableDef<TrackLink, 'track_id' | 'provider' | 'provider_id'>;
      rooms: TableDef<Room, 'lounge_id' | 'host_id'>;
      room_participants: TableDef<RoomParticipant, 'room_id' | 'user_id'>;
      queue_items: TableDef<QueueItem, 'room_id' | 'track_id' | 'added_by' | 'position'>;
      messages: TableDef<Message, 'lounge_id' | 'user_id' | 'body'>;
      reactions: TableDef<Reaction, 'message_id' | 'user_id' | 'emoji'>;
      sync_metrics: TableDef<SyncMetric, 'room_id' | 'user_id' | 'provider' | 'drift_ms'>;
    };
    Views: Record<never, never>;
    Functions: {
      server_time_ms: { Args: Record<string, never>; Returns: number };
      join_lounge_by_code: { Args: { p_code: string }; Returns: string };
      is_lounge_member: { Args: { p_lounge_id: string }; Returns: boolean };
      lounge_role: { Args: { p_lounge_id: string }; Returns: MemberRole };
      can_access_room: { Args: { p_room_id: string }; Returns: boolean };
      is_room_host: { Args: { p_room_id: string }; Returns: boolean };
      room_play: {
        Args: { p_room_id: string; p_track_id: string; p_position_ms?: number };
        Returns: Room;
      };
      room_pause: { Args: { p_room_id: string }; Returns: Room };
      room_resume: { Args: { p_room_id: string }; Returns: Room };
      room_seek: { Args: { p_room_id: string; p_position_ms: number }; Returns: Room };
      room_advance: { Args: { p_room_id: string }; Returns: Room };
      queue_append: { Args: { p_room_id: string; p_track_id: string }; Returns: QueueItem };
    };
    Enums: {
      member_role: MemberRole;
      music_provider: MusicProvider;
    };
    CompositeTypes: Record<never, never>;
  };
};

/** Convenience row aliases used across the app. */
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type ProfileRow = Tables<'profiles'>;
export type LoungeRow = Tables<'lounges'>;
export type LoungeMemberRow = Tables<'lounge_members'>;
export type TrackRow = Tables<'tracks'>;
export type TrackLinkRow = Tables<'track_links'>;
export type RoomRow = Tables<'rooms'>;
export type RoomParticipantRow = Tables<'room_participants'>;
export type QueueItemRow = Tables<'queue_items'>;
export type MessageRow = Tables<'messages'>;
