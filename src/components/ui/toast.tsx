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
import Animated, { FadeInUp, FadeOutUp, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Duration, PointerEvents, Radius, shadow, Space, TOUCH_TARGET, Type, ZIndex } from '@/lib/theme';

export type ToastVariant = 'info' | 'error' | 'success';

export type ToastApi = {
  show: (message: string, variant?: ToastVariant) => void;
};

type ToastItem = { id: number; message: string; variant: ToastVariant };

const VISIBLE_MS = 3200;
/** Older toasts stay in state (their timers own them) but only these render. */
const MAX_VISIBLE = 3;

const ACCENTS: Record<ToastVariant, { color: string; icon: LucideIcon; role: string }> = {
  info: { color: Colors.muted, icon: Info, role: 'Notice' },
  error: { color: Colors.danger, icon: CircleAlert, role: 'Error' },
  success: { color: Colors.accent, icon: CircleCheck, role: 'Success' },
};

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

      <View
        style={[styles.layer, { paddingTop: insets.top + Space.sm }, PointerEvents.boxNone]}>
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
  const accent = ACCENTS[item.variant];
  const Icon = accent.icon;

  return (
    <Animated.View
      entering={reduced ? undefined : FadeInUp.duration(Duration.base)}
      exiting={reduced ? undefined : FadeOutUp.duration(Duration.fast)}
      style={styles.rowWrap}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLabel={`${accent.role}. ${item.message}`}
        accessibilityHint="Double tap to dismiss"
        accessibilityLiveRegion="polite"
        onPress={() => onDismiss(item.id)}
        style={styles.row}>
        <Icon size={20} color={accent.color} />
        {/*
          The tint lives on the icon, not the fill: a solid Colors.danger or
          Colors.accent panel cannot carry Colors.text at 4.5:1, and a toast that
          cannot be read is worse than no toast.
        */}
        <Text style={styles.message}>{item.message}</Text>
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
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    ...shadow('lg'),
  },
  message: {
    ...Type.body,
    color: Colors.text,
    flex: 1,
  },
});
