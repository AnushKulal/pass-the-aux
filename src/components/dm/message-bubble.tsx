/**
 * One direct message, in whichever of the five shapes §13 gives it.
 *
 * The alignment and the fill are the whole grammar of a DM thread: your own
 * messages are an accent fill hard against the right edge, theirs are
 * `C.surface` against the left. Radius 0, no tail, no shadow — the fill and the
 * edge are what say who spoke.
 *
 * Kinds, and who draws them:
 *   text   — here, with @mentions lifted per §13
 *   voice  — `<VoiceNote>`
 *   image  — here, a 180px well; the bucket is PRIVATE, so `useSignedUrl`
 *   video  — here, the same well with a play badge
 *   file   — here: name, size, type glyph
 *   track  — `<TrackCard>`
 *
 * Grouping is the caller's decision (`showHeader`), because whether a message
 * starts a run depends on the message *below* it in an inverted list and this
 * component only ever sees itself. The identity line is drawn for the other
 * person only: on your own side the accent fill and the right edge already
 * name the sender, and a run of your own avatars would be the loudest thing on
 * a screen where the red is supposed to mean something.
 */

import { Image } from 'expo-image';
import {
  File as FileBlank,
  FileArchive,
  FileImage,
  FileMusic,
  FileText,
  FileVideoCamera,
  ImageOff,
  Play,
} from 'lucide-react-native';
import { memo, useCallback, useMemo, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Avatar, BLURHASH_SURFACE } from '@/components/ui';
import { TrackCard } from '@/components/dm/track-card';
import { VoiceNote } from '@/components/dm/voice-note';
import { useSignedUrl, type DmAttachment, type DmMessage } from '@/features/dm';
import {
  Duration,
  Fonts,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const AVATAR = 30;
/** Half the difference between the avatar and its 44px target. */
const AVATAR_SLOP = (TOUCH_TARGET - AVATAR) / 2;
/** Pulls a 44px name target back to the height of the text inside it. */
const NAME_INSET = 13;

/** §13's photo well. */
const WELL_WIDTH = 180;
const WELL_DEFAULT_HEIGHT = 132;
/** A panorama must not become a 12px sliver, nor a portrait a whole screen. */
const WELL_MIN_HEIGHT = 96;
const WELL_MAX_HEIGHT = 260;

/** A bubble never spans the column — the free edge is what makes the side read. */
const MAX_WIDTH = '78%';

/** `@mira`, `@sol_r`. Split, not replace, so the surrounding text survives. */
const MENTION = /(@[A-Za-z0-9_]{1,32})/g;

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** `2.4 MB`. Binary units, one decimal once past a kilobyte. */
function formatSize(bytes: number | null | undefined): string {
  const value = bytes ?? 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A name for a file the schema does not store one for.
 *
 * `attachments` has no `file_name` column — the uploader keeps only the
 * extension and names the object with a fresh uuid — so the caption a sender
 * typed is the best name available, and the stored basename is the fallback.
 */
function fileName(attachment: DmAttachment | null, caption: string): string {
  const typed = caption.trim();
  if (typed) return typed;

  const base = attachment?.storage_path?.split('/').pop();
  return base && base.length > 0 ? base : 'Attachment';
}

/**
 * The type glyph §13 asks for, chosen from the mime type rather than guessed
 * from a filename the schema does not store.
 *
 * Written as a component that switches internally rather than as a function
 * returning a component *type*: picking a `ComponentType` during render remounts
 * whatever it draws whenever the branch changes, and the lint rule that catches
 * that is right to.
 */
function FileGlyph({ mime, color }: { mime: string | null | undefined; color: string }) {
  const type = (mime ?? '').toLowerCase();
  const props = { size: 18, strokeWidth: 2, color };

  if (type.startsWith('image/')) return <FileImage {...props} />;
  if (type.startsWith('audio/')) return <FileMusic {...props} />;
  if (type.startsWith('video/')) return <FileVideoCamera {...props} />;
  if (type === 'application/pdf' || type.startsWith('text/')) return <FileText {...props} />;
  if (type.includes('zip') || type.includes('compressed') || type.includes('tar')) {
    return <FileArchive {...props} />;
  }
  return <FileBlank {...props} />;
}

/**
 * The body, with handles lifted out of it.
 *
 * §13: mentions render in accent at 600 — except inside your own accent bubble,
 * where accent-on-accent is invisible, so they become `ink` at 800. Nested
 * `<Text>` rather than a row of views, so a mention still wraps mid-line with
 * the words around it instead of becoming an unbreakable block.
 */
function Body({
  text,
  color,
  mentionColor,
  mentionFont,
}: {
  text: string;
  color: string;
  mentionColor: string;
  mentionFont: string;
}) {
  const parts = useMemo(() => text.split(MENTION), [text]);

  return (
    <Text selectable style={[styles.body, { color }]}>
      {parts.map((part, index) =>
        // split() with one capture group puts the matches on the odd indices.
        index % 2 === 1 ? (
          <Text
            key={`${index}-${part}`}
            style={{ color: mentionColor, fontFamily: mentionFont }}>
            {part}
          </Text>
        ) : (
          part
        ),
      )}
    </Text>
  );
}

/**
 * A photo or a video still, signed.
 *
 * `dm-media` is private: a public URL 400s, so nothing here ever builds one.
 * `useSignedUrl` mints and rotates one per storage path, and returns null while
 * it is in flight — which is why the well always draws its own ground and the
 * image lands on top of it rather than the well waiting for a URL to exist.
 */
function MediaWell({
  attachment,
  caption,
  video,
}: {
  attachment: DmAttachment | null;
  caption: string;
  video: boolean;
}) {
  const C = useColors();
  const url = useSignedUrl(attachment?.storage_path);

  const height = useMemo(() => {
    const w = attachment?.width ?? 0;
    const h = attachment?.height ?? 0;
    if (w <= 0 || h <= 0) return WELL_DEFAULT_HEIGHT;
    const scaled = Math.round(WELL_WIDTH * (h / w));
    return Math.min(WELL_MAX_HEIGHT, Math.max(WELL_MIN_HEIGHT, scaled));
  }, [attachment?.width, attachment?.height]);

  const trimmed = caption.trim();

  return (
    <View style={[styles.well, { borderColor: C.rule2 }]}>
      <View style={[styles.wellImage, { height, backgroundColor: C.bgRecessed }]}>
        {/* Under the image, so it is also what a failed signature leaves behind. */}
        <ImageOff size={26} strokeWidth={2} color={C.artwork} />

        {url ? (
          <Image
            source={{ uri: url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            placeholder={{ blurhash: BLURHASH_SURFACE }}
            transition={Duration.press}
            accessibilityIgnoresInvertColors
            accessibilityLabel={trimmed || (video ? 'Video' : 'Photo')}
          />
        ) : null}

        {video ? (
          <View style={[styles.playBadge, { backgroundColor: C.scrim, borderColor: C.rule2 }]}>
            <Play size={18} strokeWidth={2} color={C.ink} />
          </View>
        ) : null}
      </View>

      {trimmed ? (
        <Text style={[styles.wellCaption, { color: C.ink2, borderTopColor: C.rule }]}>
          {trimmed}
        </Text>
      ) : null}
    </View>
  );
}

/** Name, size, type glyph — §13's file bubble, and nothing more. */
function FileWell({ attachment, caption }: { attachment: DmAttachment | null; caption: string }) {
  const C = useColors();
  const name = fileName(attachment, caption);

  return (
    <View style={[styles.fileRow, { borderColor: C.rule2 }]}>
      <FileGlyph mime={attachment?.mime_type} color={C.ink2} />
      <View style={styles.fileText}>
        <Text numberOfLines={2} style={[styles.fileName, { color: C.ink }]}>
          {name}
        </Text>
        <Text style={[styles.fileMeta, { color: C.ink3 }]}>
          {formatSize(attachment?.size_bytes)}
        </Text>
      </View>
    </View>
  );
}

export type MessageBubbleProps = {
  message: DmMessage;
  /**
   * First message of a run — a new sender, a new day, or more than the
   * grouping window since the one below it. Draws the identity line.
   */
  showHeader: boolean;
  /** Day label to print above this bubble, or null. */
  daySeparator: string | null;
  /**
   * The seam for a message-actions sheet (delete lives behind
   * `useDeleteMessage`). Absent here, the bubble simply has no long press.
   */
  onLongPress?: (message: DmMessage) => void;
  /** Avatar and name become targets onto the sender's profile when supplied. */
  onOpenProfile?: (userId: string) => void;
};

function MessageBubbleBase({
  message,
  showHeader,
  daySeparator,
  onLongPress,
  onOpenProfile,
}: MessageBubbleProps) {
  const C = useColors();

  const { mine, kind, body } = message;
  const name = message.author?.display_name?.trim() || message.author?.username || 'Someone';

  /*
    §13's "own = accent fill" governs the message body. A photo well, a file row
    and a track card carry their own frame in both directions — filling those
    accent as well would put a red field behind a red-bordered card and spend
    the one colour the design reserves. `voice` takes the fill (it *is* a body);
    the wells do not.
  */
  const bubbleBg = mine ? C.live : C.surface;
  const bubbleFg = mine ? C.onLive : C.ink;

  const openProfile = useCallback(() => {
    onOpenProfile?.(message.senderId);
  }, [onOpenProfile, message.senderId]);

  const openActions = useCallback(() => {
    // A pending message has no server id yet, so nothing offered here could
    // succeed against it.
    if (message.pending) return;
    onLongPress?.(message);
  }, [message, onLongPress]);

  const align: StyleProp<ViewStyle> = mine ? styles.alignEnd : styles.alignStart;

  let content: ReactNode;
  switch (kind) {
    case 'voice':
      content = <VoiceNote attachment={message.attachment} mine={mine} />;
      break;
    case 'track':
      content = <TrackCard track={message.track} caption={body} />;
      break;
    case 'image':
    case 'video':
      content = <MediaWell attachment={message.attachment} caption={body} video={kind === 'video'} />;
      break;
    case 'file':
      content = <FileWell attachment={message.attachment} caption={body} />;
      break;
    default:
      content = (
        <View style={[styles.textBubble, { backgroundColor: bubbleBg }]}>
          <Body
            text={body}
            color={bubbleFg}
            // Accent-on-accent is unreadable, so inside your own bubble a
            // mention becomes ink at 800 instead. §13 names both cases.
            mentionColor={mine ? C.ink : C.liveText}
            mentionFont={mine ? Fonts.extrabold : Fonts.semibold}
          />
        </View>
      );
  }

  return (
    <View>
      {daySeparator ? (
        <View accessibilityRole="header" style={styles.daySeparator}>
          <View style={[styles.dayRule, { backgroundColor: C.rule }]} />
          <Text style={[styles.dayLabel, { color: C.ink3 }]}>{daySeparator}</Text>
          <View style={[styles.dayRule, { backgroundColor: C.rule }]} />
        </View>
      ) : null}

      {/* The identity line, on the first of the other person's runs only. */}
      {showHeader && !mine ? (
        <View style={styles.identity}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${name}'s profile`}
            disabled={!onOpenProfile}
            onPress={openProfile}
            style={({ pressed }) => [styles.avatarTarget, pressed && styles.dim]}>
            <Avatar uri={message.author?.avatar_url} name={name} size={AVATAR} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${name}'s profile`}
            disabled={!onOpenProfile}
            onPress={openProfile}
            style={({ pressed }) => [styles.nameTarget, pressed && styles.dim]}>
            <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
              {name}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        accessible={false}
        accessibilityActions={
          message.pending || !onLongPress
            ? undefined
            : [{ name: 'longpress', label: 'Message actions' }]
        }
        onAccessibilityAction={openActions}
        onLongPress={onLongPress ? openActions : undefined}
        delayLongPress={350}
        style={[
          styles.row,
          align,
          showHeader && styles.rowLeading,
          // Pending is carried by weight, not by a spinner: the message is
          // already readable and in place, it simply has not landed yet.
          message.pending && styles.pending,
        ]}>
        <View style={[styles.column, align]}>
          {content}

          <Text style={[styles.time, { color: C.ink3 }]}>
            {formatTime(message.createdAt)}
            {message.pending ? ' · SENDING' : ''}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

/**
 * Bubbles re-render only when their own message object is replaced — a send
 * being confirmed, or a signature rotating — never because a sibling arrived.
 */
export const MessageBubble = memo(MessageBubbleBase);

const styles = StyleSheet.create({
  daySeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.lg,
    paddingHorizontal: Space.md,
  },
  dayRule: {
    flex: 1,
    height: Rule.hair,
  },
  dayLabel: {
    ...Type.label(11),
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: Space.md,
    paddingTop: Space.md,
  },
  /** 30px of avatar inside 44px of target, without costing 14px of layout. */
  avatarTarget: {
    padding: AVATAR_SLOP,
    margin: -AVATAR_SLOP,
  },
  nameTarget: {
    minHeight: TOUCH_TARGET,
    minWidth: TOUCH_TARGET,
    justifyContent: 'center',
    marginVertical: -NAME_INSET,
    flexShrink: 1,
  },
  name: {
    ...Type.heading(12),
    letterSpacing: tracking(12, 0.02),
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: Space.md,
    paddingVertical: 5,
  },
  rowLeading: {
    marginTop: Space.xs,
  },
  alignStart: {
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  alignEnd: {
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  column: {
    maxWidth: MAX_WIDTH,
    gap: Space.xs,
  },
  pending: {
    opacity: 0.6,
  },
  dim: {
    opacity: 0.6,
  },
  textBubble: {
    paddingHorizontal: Space.md,
    paddingVertical: 10,
  },
  body: {
    ...Type.body(16),
  },
  well: {
    width: WELL_WIDTH,
    borderWidth: Rule.hair,
  },
  wellImage: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  playBadge: {
    position: 'absolute',
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: Rule.hair,
  },
  wellCaption: {
    ...Type.body(12),
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderTopWidth: Rule.hair,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    minHeight: 52,
    borderWidth: Rule.hair,
  },
  fileText: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    ...Type.heading(13),
    letterSpacing: tracking(13, 0.01),
  },
  fileMeta: {
    ...readout(11),
    marginTop: 2,
  },
  time: {
    ...readout(10),
    letterSpacing: tracking(10, 0.06),
  },
});
