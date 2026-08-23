import { CircleAlert, CircleCheck, Info, type LucideIcon } from 'lucide-react-native';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/lib/theme-context';
import {
  Duration,
  PointerEvents,
  Radius,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  ZIndex,
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

const ICONS: Record<ToastVariant, LucideIcon> = {
  info: Info,
  error: CircleAlert,
  success: CircleCheck,
};

const ROLES: Record<ToastVariant, string> = {
  info: 'Notice',
  error: 'Error',
  success: 'Success',
};

/*
  Success is ink, not the accent. A completed action is not a live one, and
  spending the reserved colour on a tick is exactly what makes a Feed stop being
  scannable. Only a genuine failure gets its own hue.
*/
function tintFor(variant: ToastVariant, C: Palette): string {
  if (variant === 'error') return C.danger;
  if (variant === 'success') return C.ink;
  return C.ink2;
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
  const insets = useSafeAreaInsets();
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

      <View style={[styles.layer, { paddingTop: insets.top + Space.sm }, PointerEvents.boxNone]}>
        {visible.map((item) => (
          <ToastRow key={item.id} item={item} reduced={reduced} onDismiss={dismiss} />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

/**
 * A flat plate: `surface2` ground, one 1px `rule2` border, square corners. It
 * reads as a panel that has slid in over the page, which is all the separation
 * this direction allows — there is no shadow to lift it off.
 */
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

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * -8 }],
  }));

  return (
    <Animated.View style={[styles.rowWrap, enterStyle]}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLabel={`${ROLES[item.variant]}. ${item.message}`}
        accessibilityHint="Double tap to dismiss"
        accessibilityLiveRegion="polite"
        onPress={() => onDismiss(item.id)}
        style={[styles.row, { backgroundColor: C.surface2, borderColor: C.rule2 }]}>
        {/*
          The tint lives on the icon, not the fill: a solid danger panel cannot
          carry ink at 4.5:1, and a toast that cannot be read is worse than no
          toast at all.
        */}
        <Icon size={20} strokeWidth={2} color={tint} />
        <Text style={[styles.message, { color: C.ink }]}>{item.message}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: ZIndex.toast,
    elevation: ZIndex.toast,
    alignItems: 'center',
    paddingHorizontal: Space.lg,
    gap: Space.sm,
  },
  rowWrap: {
    width: '100%',
    maxWidth: 480,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: TOUCH_TARGET,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius,
    borderWidth: Rule.hair,
  },
  message: {
    ...Type.body(16),
    flex: 1,
  },
});
