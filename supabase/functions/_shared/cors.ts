/**
 * Shared response construction for every Aux Edge Function.
 *
 * CORS lives here rather than at each call site because Aux also runs on web:
 * a response that omits these headers does not fail loudly, it turns into an
 * opaque browser network error with no status and no body. Routing *every*
 * response — successes and failures alike — through these helpers makes that
 * class of bug impossible.
 */

/**
 * The only error codes the client is allowed to branch on. Deliberately a
 * closed set: it maps onto `PlaybackErrorCode` in `src/playback/types.ts`, so
 * upstream provider quirks get normalised once, here, instead of leaking
 * Spotify's `reason` strings into UI code.
 */
export type ApiErrorCode =
  | 'premium_required'
  | 'no_active_device'
  | 'not_playable'
  | 'auth_expired'
  | 'rate_limited'
  | 'bad_request'
  | 'forbidden'
  | 'unknown';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  // Retry-After has to be explicitly exposed or the browser hides it from JS,
  // which would break rate-limit backoff on web.
  'Access-Control-Expose-Headers': 'retry-after',
  'Access-Control-Max-Age': '86400',
};

/**
 * Returns a preflight response for OPTIONS, or `null` to signal "keep going".
 * Call it as the first line of every handler.
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body === undefined ? null : body), {
    status,
    headers: { ...corsHeaders, ...extraHeaders, 'Content-Type': 'application/json' },
  });
}

/** The one and only failure shape the client parses: `{ error: { code, message } }`. */
export function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return jsonResponse({ error: { code, message } }, status, extraHeaders);
}

/** Thrown inside a handler and converted to `errorResponse` by the top-level catch. */
export class HttpError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly headers: Record<string, string> = {}
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return errorResponse(error.code, error.message, error.status, error.headers);
  }
  // Anything unhandled is a bug or a misconfiguration (a missing secret, say).
  // Log the detail server-side; hand the client a message that reveals nothing.
  console.error('Unhandled edge function error', error);
  return errorResponse('unknown', 'Something went wrong. Please try again.', 500);
}

/** Body parser that tolerates an absent or malformed body instead of throwing. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function requiredString(
  source: Record<string, unknown>,
  key: string
): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new HttpError('bad_request', `Missing required field "${key}".`, 400);
  }
  return value.trim();
}
