/**
 * The toast.
 *
 * From design/nocturne/aux-nocturne.dc.html L1529-1532: a chrome pill floating
 * 126px off the bottom of the screen, `chromeBorder` edge, a heavy drop shadow,
 * a 9px coral dot with its own glow, and one line of 13px ink.
 *
 * THREE CHANGES FROM THE PLATE THIS REPLACES.
 *
 * It MOVED TO THE BOTTOM. It used to hang under the status bar, which in this
 * direction collides with the floating header on every screen. 126px is not an
 * arbitrary number: it is exactly `useDockReserve()`, the strip the floating nav
 * capsule occupies, so the toast lands directly above the dock on a tab screen
 * and in the same place on every other screen. Reading the token rather than
 * the literal keeps the two in step if the capsule ever moves.
 *
 * It FLOATS rather than resting. `dropped(C, 'lg')` plus a `chromeBorder` edge
 * is the recipe for a piece of chrome hovering over the page, and the edge is
 * the load-bearing half: `chromeBorder` is roughly twice as bright as `rule`,
 * and that delta is the entire difference between a piece of glass and a card.
 *
 * Its fill is `dock`, NOT `nav`. The design's toast is real glass — a 30px
 * backdrop blur over the translucent `nav` fill. This ships the documented
 * fallback instead: the app budgets for one live blur surface and the nav
 * capsule spends it, and a translucent fill with no blur behind it lets the
 * content scroll straight through the message. `dock` is the near-opaque twin
 * of `nav` for exactly this case. Swapping in a blur later means changing the
 * fill token and nothing else.
 */

import { CircleAlert, CircleCheck, type LucideIcon } from 'lucide-react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useDockReserve } from '@/lib/dock';
import { useColors } from '@/lib/theme-context';
import {
  Duration,
  Fonts,
  PointerEvents,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  ZIndex,
  dropped,
  tracking,
  type Palette,
} from '@/lib/theme';

export type ToastVariant = 'info' | 'error' | 'success';

export type ToastApi = {
  show: (message: string, variant?: ToastVariant) => void;
};

type ToastItem = { id: number; message: string; variant: ToastVariant };

const VISIBLE_MS = 3200;
/** Older toasts stay in state (their timers own them) but only these render. */
const MAX_VISIBLE = 3;

/** L1530: a 9px disc with `0 0 12px var(--aux-live)` behind it. */
const DOT = 9;

/**
 * `info` gets the design's DOT; the other two keep a glyph.
 *
 * A deliberate split. The artboards only ever draw the neutral toast, so the
 * dot is the design's answer for that one case — but distinguishing a failure
 * from a success by TINT ALONE fails for anyone who cannot separate the two
 * hues, and a toast is dismissed in three seconds with no second chance to
 * read it. So the two variants that carry a verdict keep a shape as well.
 */
const ICONS: Record<ToastVariant, LucideIcon | null> = {
  info: null,
  error: CircleAlert,
  success: CircleCheck,
};

const ROLES: Record<ToastVariant, string> = {
  info: 'Notice',
  error: 'Error',
  success: 'Success',
};

/*
  Success is ink, not coral. A completed action is not a LIVE one, and coral in
  this direction means something is happening right now — spending it on a tick
  is exactly what makes a Feed stop being scannable. The neutral dot keeps the
  coral because that is the design's own value for it, and because a bare notice
  is the one place with nothing else to say "the app just did something".
*/
function tintFor(variant: ToastVariant, C: Palette): string {
  if (variant === 'error') return C.danger;
  if (variant === 'success') return C.ink;
  return C.live;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    throw new Error('useToast() requires <ToastProvider> above it — mount it in src/app/_layout.tsx.');
  }
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(0);
  const dockReserve = useDockReserve();
  const reduced = useReducedMotion();

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const show = useCallback(
    (message: string, variant: ToastVariant = 'info') => {
      const id = nextId.current;
      nextId.current += 1;
      setItems((prev) => [...prev, { id, message, variant }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), VISIBLE_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  // Stable so consumers can safely list `toast` in effect dependency arrays.
  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  const visible = items.slice(-MAX_VISIBLE);

  return (
    <ToastContext.Provider value={api}>
      {children}

      {/*
        `box-none`, and it matters more here than anywhere: this layer spans the
        full width and sits above every screen in the app. With `auto` it would
        swallow taps across a 60px band above the dock — the exact strip the
        last row of any list scrolls through.

        No `top`, so the layer is only as tall as the toasts inside it.
      */}
      <View
        style={[
          styles.layer,
          /*
            `useDockReserve()` already includes the bottom inset. This previously
            read `insets.bottom + Dock.reserveBase` and was one of the few sites that
            got the arithmetic right by hand; it goes through the hook now so
            there is exactly one definition of how tall the capsule's exclusion
            zone is.
          */
          { paddingBottom: dockReserve },
          PointerEvents.boxNone,
        ]}>
        {visible.map((item) => (
          <ToastRow key={item.id} item={item} reduced={reduced} onDismiss={dismiss} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

function ToastRow({
  item,
  reduced,
  onDismiss,
}: {
  item: ToastItem;
  reduced: boolean;
  onDismiss: (id: number) => void;
}) {
  const C = useColors();
  const Icon = ICONS[item.variant];
  const tint = tintFor(item.variant, C);

  /*
    Driven by a shared value from an effect, NOT `entering={FadeInUp…}`.
    Reanimated marks an entering view `visibility: hidden` until its animation
    runs, and on react-native-web that animation never fires — which would make
    EVERY toast in the app invisible on web while reporting correct layout.

    `exiting` went with it: a removal the layout system never animates can hold
    the node in the tree forever. The row is filtered out of provider state on
    dismiss, so React unmounts it either way.
  */
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [reduced, enter]);

  // Rises INTO place now that the toast lives at the bottom. Sliding down from
  // above would have it arrive travelling away from where it came from.
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 8 }],
  }));

  return (
    <Animated.View style={[styles.rowWrap, enterStyle]}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLabel={`${ROLES[item.variant]}. ${item.message}`}
        accessibilityHint="Double tap to dismiss"
        accessibilityLiveRegion="polite"
        onPress={() => onDismiss(item.id)}
        style={[
          styles.row,
          dropped(C, 'lg'),
          { backgroundColor: C.dock, borderColor: C.chromeBorder },
        ]}>
        {/*
          Both marks occupy the same 20px slot, so a run of toasts keeps one
          text column no matter which variants land in it.
        */}
        <View style={styles.mark}>
          {Icon ? (
            <Icon size={18} strokeWidth={2} color={tint} />
          ) : (
            <View
              style={[
                styles.dot,
                {
                  backgroundColor: tint,
                  // Zero offset: the dot is lit, not raised. Same recipe as
                  // `LivePulse`, which is the same mark doing the same job.
                  boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 12, color: tint }],
                },
              ]}
            />
          )}
        </View>

        <Text numberOfLines={2} style={[styles.message, { color: C.ink }]}>
          {item.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    // No `top`: the layer is content-height, so it cannot become the
    // full-bleed overlay that eats every tap in the app.
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: ZIndex.toast,
    elevation: ZIndex.toast,
    alignItems: 'center',
    // L1529: `left:18px;right:18px`.
    paddingHorizontal: Space.lg + 2,
    gap: Space.sm,
  },
  rowWrap: {
    width: '100%',
    maxWidth: 480,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    // L1529: `gap:11px;padding:14px 16px`.
    gap: 11,
    minHeight: TOUCH_TARGET,
    paddingVertical: Space.md + 2,
    paddingHorizontal: Space.lg,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
  },
  mark: {
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: Radii.pill,
  },
  /**
   * L1531 sets this at 800; 600 at 13px is the same read without the shout —
   * an extrabold sentence inside a pill looks like a label for the pill rather
   * than a message in it.
   */
  message: {
    flex: 1,
    fontFamily: Fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: tracking(13, 0.01),
  },
});
