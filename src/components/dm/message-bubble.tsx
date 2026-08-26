/**
 * One direct message, in whichever of the six shapes a DM can take.
 *
 * Source: `design/nocturne/aux-nocturne.dc.html` L744–L777 — the thread's bubble
 * column and its five attachment shapes.
 *
 * The alignment and the fill are the whole grammar: your own messages are the
 * BLUE primary hard against the right edge, theirs a raised `surface` bubble
 * against the left. Both shapes, the day break, the identity line and the stamp
 * come from `@/components/chat/bubble-kit`, which the lounge and Session log
 * render through as well — the two surfaces are one visual language and must
 * stay one.
 *
 * NOCTURNE MOVED THE OWN-SIDE FILL FROM CORAL TO BLUE, and that reaches in here
 * twice. Authoring a message is a thing you DID, and things you do are blue;
 * coral now says only that something is happening right now. Anything drawn on
 * top of the own-side fill therefore has to be checked against a BLUE field, not
 * a coral one — see `<VoiceNote>`, whose play disc inverts for exactly this
 * reason.
 *
 * Kinds, and who draws them:
 *   text   — here
 *   voice  — `<VoiceNote>`
 *   image  — here, a well; the bucket is PRIVATE, so `useSignedUrl`
 *   video  — here, the same well with a play badge
 *   file   — here: name, size, type glyph
 *   track  — `<TrackCard>`
 *
 * The media and file wells are INSET in their bubble rather than bleeding to its
 * edge the way L759 draws them. Full-bleed needs `overflow:'hidden'` on the
 * bubble, and on Android a clipping view drops its own `boxShadow` — the whole
 * thread would lose its lift on one platform only. The card's outer footprint
 * still matches the artboard (166 + 12 either side = the design's 190).
 *
 * Grouping is the caller's decision (`showHeader` / `showStamp`), because
 * whether a message starts or ends a run depends on its NEIGHBOURS in an
 * inverted list and this component only ever sees itself.
 *
 * THE ENTRANCE IS THE SHARED ONE, DELIBERATELY UNCONFIGURED. A DM thread and a
 * lounge log are the same object drawn twice — the same `bubble-kit`, the same
 * run grouping, the same day breaks — so a reader who can tell them apart by
 * how their messages arrive has found a seam that should not exist.
 * `useEntrance({ index })` at its defaults is what a chat row gets everywhere:
 * `auxRow`, an 8px lift over 240ms, 55ms per step. `Stagger.messages` is NOT
 * borrowed here; that token is the INBOX row's step (see `conversation-row`),
 * and this is a log, not the inbox.
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
import Animated from 'react-native-reanimated';

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
import { useEntrance } from '@/lib/entrance';
import {
  DarkPalette,
  Duration,
  Fonts,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  tracking,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * The photo well, sized so the BUBBLE lands on the artboard's 190px (L759): the
 * well plus the 12px band the bubble pads it with on either side. The default
 * height keeps L759's 190×140 proportion for an image whose dimensions the
 * attachment row never recorded.
 */
const WELL_WIDTH = 166;
const WELL_DEFAULT_HEIGHT = 122;
/** A panorama must not become a 12px sliver, nor a portrait a whole screen. */
const WELL_MIN_HEIGHT = 92;
const WELL_MAX_HEIGHT = 240;
/**
 * Concentric with the bubble: a 20px corner minus the 12px band around it. The
 * radius scale has no 8, and an inner corner ROUNDER than that reads as a
 * sticker sitting on the bubble rather than a hole cut in it.
 */
const WELL_RADIUS = 8;

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

        {/*
          A MARKER, not a control, and that is why it is not blue.

          Blue is the action colour, and nothing happens when this is pressed —
          there is no video player in the app (neither `expo-video` nor
          `expo-av` is a dependency) and no viewer route to open. A blue play
          disc would promise playback the build cannot deliver. So it takes the
          neutral overlay treatment instead and says only "this one moves".

          Pinned to the DARK palette on purpose, exactly as `StatusPill`'s
          `overlay` tone is: it sits on a photograph, and a photograph does not
          get lighter because the user switched to light mode. `dock` and not
          `nav` — this is chrome laid straight ON content with no blur under it,
          and the translucent one would let the still read through the glyph.
        */}
        {video ? (
          <View style={[styles.playBadge, { backgroundColor: DarkPalette.dock }]}>
            <Play size={15} strokeWidth={2} color={DarkPalette.ink} fill={DarkPalette.ink} />
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
   * Position in the log. Drives the entrance stagger, and the list is
   * `inverted` — so index 0 is the NEWEST message, sitting at the bottom, and
   * the thread assembles upward from the message you are reading. Straight from
   * `renderItem`, which already hands it over; nothing derives it.
   */
  index?: number;
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
  index = 0,
  onLongPress,
  onOpenProfile,
}: MessageBubbleProps) {
  const { mine, kind, body } = message;

  /*
    The whole row arrives as one thing — day break, identity line and bubble
    together. Animating the bubble alone would leave "Yesterday" and the
    sender's name already sitting there waiting for their own message.
  */
  const entering = useEntrance({ index });

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
    <Animated.View style={entering}>
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
    </Animated.View>
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
    // WELL_RADIUS (8), not Radii.md (14). The bubble corner is 20 and it pads
    // this well by 12, so 8 is the concentric inner corner. Radii.md is ROUNDER
    // than the corner containing it, which is what makes an inset well read as
    // a sticker stuck onto the bubble instead of a hole cut into it.
    borderRadius: WELL_RADIUS,
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
