/**
 * Voice, screen share, and throwing someone out.
 *
 * WHY AN EDGE FUNCTION AT ALL: a LiveKit access token is a signed JWT, and
 * signing it requires `LIVEKIT_API_SECRET`. That secret is the key to the whole
 * project — anyone holding it can mint a token for any room as any identity, so
 * it can never be in the app bundle. The same reasoning that keeps Spotify
 * refresh tokens in `spotify-auth` applies here, only the blast radius is
 * larger: a leaked Spotify token exposes one account, a leaked LiveKit secret
 * exposes every session in the app.
 *
 * SO THE CLIENT NEVER ASKS FOR A ROOM, IT ASKS FOR *ITS* ROOM. The room name is
 * derived from the session id the caller is actually a participant in, checked
 * here against the database. A client that asks for a room it has no business
 * in gets a 403 rather than a token, which is the difference between an
 * authorisation system and a naming convention.
 *
 * TWO ACTIONS, one function, because they share the same secret and the same
 * participant check and splitting them would mean deploying that twice:
 *
 *   token  { roomId }              -> { url, token, identity }
 *   kick   { roomId, userId }      -> { removed: true }
 *
 * Required secrets:
 *   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (injected by Supabase)
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { AccessToken, RoomServiceClient } from 'npm:livekit-server-sdk@2';

import {
  HttpError,
  handlePreflight,
  jsonResponse,
  readJsonBody,
  requiredString,
  toErrorResponse,
} from '../_shared/cors.ts';

/**
 * A LiveKit room per Aux session, named from the session id.
 *
 * Prefixed rather than using the bare uuid so that a LiveKit dashboard listing
 * is readable, and so this app can never collide with another project sharing
 * the same LiveKit tenant.
 */
const roomName = (roomId: string) => `aux-session-${roomId}`;

/** How long a join token stays valid. Long enough for a session, short enough
 *  that a leaked one is not a standing invitation. The client re-mints on
 *  rejoin, so this is not a session length limit. */
const TOKEN_TTL = '4h';

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    // Named explicitly: a missing secret is the single most likely reason this
    // function fails after a project migration, and "internal error" would send
    // whoever debugs it looking in the wrong place entirely.
    throw new HttpError(500, `${name} is not set on this project`);
  }
  return value;
}

/** The caller, from their own JWT. Never from the request body. */
async function callerId(req: Request, admin: SupabaseClient): Promise<string> {
  const header = req.headers.get('Authorization') ?? '';
  const jwt = header.replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'Sign in first');

  const { data, error } = await admin.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'Sign in first');
  return data.user.id;
}

/**
 * Is this person actually in this session?
 *
 * The check that makes the room name meaningless to an attacker. Reads through
 * the service role deliberately: RLS on `room_participants` grants read to
 * lounge members, and this needs a plain factual answer for exactly one row
 * rather than whatever the caller's policies happen to allow.
 */
async function assertParticipant(
  admin: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await admin
    .from('room_participants')
    .select('user_id')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Could not check the session');
  if (!data) throw new HttpError(403, 'Join the session first');
}

/** Only the person on aux may remove somebody. */
async function assertHost(
  admin: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await admin
    .from('rooms')
    .select('host_id')
    .eq('id', roomId)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Could not check the session');
  if (!data) throw new HttpError(404, 'That session has ended');
  if (data.host_id !== userId) throw new HttpError(403, 'Only the host can do that');
}

async function mintToken(
  admin: SupabaseClient,
  roomId: string,
  userId: string,
): Promise<Response> {
  await assertParticipant(admin, roomId, userId);

  const { data: profile } = await admin
    .from('profiles')
    .select('username, display_name')
    .eq('id', userId)
    .maybeSingle();

  const token = new AccessToken(env('LIVEKIT_API_KEY'), env('LIVEKIT_API_SECRET'), {
    identity: userId,
    name: profile?.display_name ?? profile?.username ?? 'Someone',
    ttl: TOKEN_TTL,
  });

  token.addGrant({
    room: roomName(roomId),
    roomJoin: true,
    // Publish covers both the microphone and the screen share track. There is
    // no separate screen-share grant in LiveKit — a screen share is just
    // another published track — so gating it further has to happen in the app.
    canPublish: true,
    canSubscribe: true,
    // Used to announce "started sharing" to everyone in the room over LiveKit's
    // own data channel, rather than a second round trip through Postgres.
    canPublishData: true,
    // NOT roomAdmin, even for the host. Removing someone goes through `kick`
    // below so the server can check the host claim itself; handing a client
    // admin rights would let a compromised app remove anyone from any room it
    // could name.
  });

  return jsonResponse({
    url: env('LIVEKIT_URL'),
    token: await token.toJwt(),
    identity: userId,
  });
}

async function kick(
  admin: SupabaseClient,
  roomId: string,
  hostId: string,
  targetId: string,
): Promise<Response> {
  await assertHost(admin, roomId, hostId);
  if (targetId === hostId) throw new HttpError(400, 'You cannot remove yourself');

  // The database row first. If LiveKit is down or the person was never
  // connected to voice, they must still leave the session — the source of truth
  // for "who is in this room" is Postgres, not the media server.
  const { error } = await admin
    .from('room_participants')
    .delete()
    .eq('room_id', roomId)
    .eq('user_id', targetId);

  if (error) throw new HttpError(500, 'Could not remove them from the session');

  // Then the media connection, best effort. A failure here means someone with
  // no seat in the room can still be heard until their client notices it has
  // been removed, which is a far smaller problem than a failed request leaving
  // them fully in the session.
  try {
    const rooms = new RoomServiceClient(
      env('LIVEKIT_URL'),
      env('LIVEKIT_API_KEY'),
      env('LIVEKIT_API_SECRET'),
    );
    await rooms.removeParticipant(roomName(roomId), targetId);
  } catch {
    // Deliberately swallowed. Reported as success because the authoritative
    // half succeeded.
  }

  return jsonResponse({ removed: true });
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    const userId = await callerId(req, admin);
    const body = await readJsonBody(req);
    const action = requiredString(body, 'action');
    const roomId = requiredString(body, 'roomId');

    if (action === 'token') return await mintToken(admin, roomId, userId);
    if (action === 'kick') return await kick(admin, roomId, userId, requiredString(body, 'userId'));

    throw new HttpError(400, `Unknown action: ${action}`);
  } catch (error) {
    return toErrorResponse(error);
  }
});
