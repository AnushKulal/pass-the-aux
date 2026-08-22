import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Colors, Space, TOUCH_TARGET, Type } from '@/lib/theme';

export type ScreenProps = {
  children: ReactNode;
  title?: string;
  scroll?: boolean;
  padded?: boolean;
  right?: ReactNode;
  onBack?: () => void;
};

/**
 * Every route's outer shell.
 *
 * Bottom inset is deliberately not consumed here: screens sit under the tab bar
 * or a mini player, both of which own their own bottom padding. A screen that
 * genuinely reaches the bottom edge should apply useSafeAreaInsets itself.
 */
export function Screen({
  children,
  title,
  scroll = false,
  padded = true,
  right,
  onBack,
}: ScreenProps) {
  const hasHeader = Boolean(title || onBack || right);

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.root}>
      {hasHeader ? (
        <View style={[styles.constrain, styles.header, padded && styles.gutter]}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={({ pressed }) => [styles.back, pressed && styles.backPressed]}>
              <ChevronLeft size={24} strokeWidth={1.6} color={Colors.text} />
            </Pressable>
          ) : null}

          {title ? (
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
          ) : (
            <View style={styles.spacer} />
          )}

          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
      ) : null}

      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, styles.constrain, padded && styles.gutter]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.constrain, padded && styles.gutter]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  flex: {
    flex: 1,
  },
  /**
   * react-native-web has no phone to constrain it, so an unbounded column
   * stretches to the full 1440px window and the line length becomes unreadable.
   */
  constrain: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  /** Every artboard sets its screen gutter to 20, not 16. */
  gutter: {
    paddingHorizontal: Space.xl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET,
    paddingTop: Space.lg,
    // The chevron already carries its own 44px box, so the title sits close to
    // it rather than a full step away.
    gap: Space.xs,
  },
  back: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    // Pulls the optical centre of the chevron back onto the gutter line.
    marginLeft: -Space.md,
  },
  backPressed: {
    opacity: 0.6,
  },
  title: {
    ...Type.title,
    color: Colors.text,
    flex: 1,
  },
  spacer: {
    flex: 1,
  },
  right: {
    minWidth: TOUCH_TARGET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: Space.xxl,
  },
});
