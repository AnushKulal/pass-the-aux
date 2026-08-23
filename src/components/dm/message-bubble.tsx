/**
 * One direct message, in whichever of the five shapes a DM can take.
 *
 * The alignment and the fill are the whole grammar: your own messages are the
 * ACCENT hard against the right edge, theirs a raised `surface` bubble against
 * the left. Both shapes, the day break, the identity line and the stamp come
 * from `@/components/chat/bubble-kit`, which the lounge and Session log render
 * through as well — the two surfaces are one visual language and must stay one.
 *
 * Kinds, and who draws them:
 *   text   — here
 *   voice  — `<VoiceNote>`
 *   image  — here, a 180px well; the bucket is PRIVATE, so `useSignedUrl`
 *   video  — here, the same well with a play badge
 *   file   — here: name, size, type glyph
 *   track  — `<TrackCard>`
 *
 * Grouping is the caller's decision (`showHeader` / `showStamp`), because
 * whether a message starts or ends a run depends on its NEIGHBOURS in an
 * inverted list and this component only ever sees itself.
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
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  Bubble,
  BubbleBody,
  BubbleIdentity,
  BubbleStamp,
  DaySeparator,
  readout,
  styles as kit,
  type BubbleTone,
} from '@/components/chat/bubble-kit';
import { TrackCard } from '@/components/dm/track-card';
import { VoiceNote } from '@/components/dm/voice-note';
import { BLURHASH_SURFACE } from '@/components/ui';
import { useSignedUrl, type DmAttachment, type DmMessage } from '@/features/dm';
import { Duration, Fonts, Radii, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** The design's photo well. */
const WELL_WIDTH = 180;
const WELL_DEFAULT_HEIGHT = 132;
/** A panorama must not become a 12px sliver, nor a portrait a whole screen. */
const WELL_MIN_HEIGHT = 96;
const WELL_MAX_HEIGHT = 260;

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
 * The type glyph, chosen from the mime type rather than guessed from a filename
 * the schema does not store.
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
    <View style={styles.well}>
      <View style={[styles.wellImage, { height, backgroundColor: C.bgRecessed }]}>
        {/* Under the image, so it is also what a failed signature leaves behind. */}
        <ImageOff size={26} strokeWidth={2} color={C.ink3} />

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
          <View style={[styles.playBadge, { backgroundColor: C.pill }]}>
            <Play size={16} strokeWidth={2} color={C.pillInk} fill={C.pillInk} />
          </View>
        ) : null}
      </View>

      {trimmed ? (
        <Text style={[styles.wellCaption, { color: C.ink2 }]}>{trimmed}</Text>
      ) : null}
    </View>
  );
}

/** Name, size, type glyph. Nothing more. */
function FileWell({ attachment, caption }: { attachment: DmAttachment | null; caption: string }) {
  const C = useColors();
  const name = fileName(attachment, caption);

  return (
    <View style={styles.fileRow}>
      <View style={[styles.fileGlyph, { backgroundColor: C.bgRecessed, borderColor: C.rule }]}>
        <FileGlyph mime={attachment?.mime_type} color={C.ink2} />
      </View>

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
  /**
   * Last message of a run. Draws the stamp. A run of six gets one timestamp,
   * not six.
   */
  showStamp?: boolean;
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
  showStamp = true,
  daySeparator,
  onLongPress,
  onOpenProfile,
}: MessageBubbleProps) {
  const { mine, kind, body } = message;
  const name = message.author?.display_name?.trim() || message.author?.username || 'Someone';

  /*
    "Own = accent fill" governs the message BODY. A photo well, a file row and a
    track card carry their own frame in both directions — filling those accent
    as well would put a red field behind a red-framed card and spend the one
    colour the design reserves. `voice` takes the fill (it *is* a body); the
    wells do not.
  */
  const attachment = kind === 'image' || kind === 'video' || kind === 'file' || kind === 'track';
  const tone: BubbleTone = mine && !attachment ? 'fill' : 'surface';

  const openProfile = useCallback(() => {
    onOpenProfile?.(message.senderId);
  }, [onOpenProfile, message.senderId]);

  const openActions = useCallback(() => {
    // A pending message has no server id yet, so nothing offered here could
    // succeed against it.
    if (message.pending) return;
    onLongPress?.(message);
  }, [message, onLongPress]);

  const align: StyleProp<ViewStyle> = mine ? kit.alignEnd : kit.alignStart;

  let content: ReactNode;
  switch (kind) {
    case 'voice':
      content = <VoiceNote attachment={message.attachment} mine={mine} />;
      break;
    case 'track':
      content = <TrackCard track={message.track} caption={body} mine={mine} />;
      break;
    case 'image':
    case 'video':
      content = (
        <Bubble mine={mine} tone="surface" card>
          <MediaWell attachment={message.attachment} caption={body} video={kind === 'video'} />
        </Bubble>
      );
      break;
    case 'file':
      content = (
        <Bubble mine={mine} tone="surface" card>
          <FileWell attachment={message.attachment} caption={body} />
        </Bubble>
      );
      break;
    default:
      content = (
        <Bubble mine={mine} tone={tone}>
          <BubbleBody text={body} tone={tone} />
        </Bubble>
      );
  }

  return (
    <View>
      {daySeparator ? <DaySeparator label={daySeparator} /> : null}

      {/* The identity line, on the first of the other person's runs only. */}
      {showHeader && !mine ? (
        <BubbleIdentity
          name={name}
          avatarUrl={message.author?.avatar_url}
          onPress={onOpenProfile ? openProfile : undefined}
        />
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
          kit.row,
          align,
          showHeader && kit.rowLeading,
          // Pending is carried by weight, not by a spinner: the message is
          // already readable and in place, it simply has not landed yet.
          message.pending && kit.pending,
        ]}>
        <View style={[kit.column, attachment && kit.columnWide, align]}>
          {content}

          {showStamp || message.pending ? (
            <BubbleStamp iso={message.createdAt} pending={message.pending} />
          ) : null}
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
  well: {
    width: WELL_WIDTH,
    borderRadius: Radii.md,
    overflow: 'hidden',
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
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wellCaption: {
    ...Type.body(12),
    paddingHorizontal: 2,
    paddingTop: Space.sm,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minWidth: 168,
  },
  fileGlyph: {
    width: 40,
    height: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radii.sm,
    borderWidth: Rule.hair,
  },
  fileText: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontFamily: Fonts.semibold,
    fontSize: 13.5,
    lineHeight: 18,
    letterSpacing: tracking(13.5, -0.01),
  },
  fileMeta: {
    ...readout(11),
    marginTop: 2,
  },
});
