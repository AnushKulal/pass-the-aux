/**
 * The bottom navigation.
 *
 * A floating capsule: inset 16px from each side, hovering 42px clear of the
 * bottom, 68px tall, fully rounded, bordered all the way around, and blurred
 * over whatever scrolls beneath it.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L878-889.
 *
 * REPLACES a full-width 88px bar that sat flush against the bottom and both
 * sides with a hairline along its top edge. That version was rejected for
 * looking like a bar, and it is worth being precise about why, because the
 * icons inside barely changed:
 *
 *   - a shape pinned to three edges reads as part of the window frame; the same
 *     shape with air on all four sides reads as an object resting on the app
 *   - a rule along the top edge ONLY is the universal signal for a bar. A
 *     border that closes all the way around says card instead
 *   - a bar is opaque because nothing passes behind it. This is translucent and
 *     blurred, so content visibly slides under it and it stops being structural
 *   - nothing floats without a shadow, and the old bar had none
 *
 * It also carries five slots where the old one had four, and the change is not
 * cosmetic:
 *
 *   - CREATE moves to a lifted centre button. It used to exist only inside the
 *     Feed's empty state, which meant the app's primary verb disappeared the
 *     moment you had any content
 *   - DIRECT MESSAGES get a permanent slot and the unread badge with it. They
 *     were reachable only from a header icon on one screen
 *   - LOUNGES lose their slot. They are not orphaned: the Feed carries a
 *     horizontal lounge row, which is where the design surfaces them, and the
 *     route stays registered for deep links
 */

import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Compass, House, MessageCircle, Plus, User, type LucideIcon } from 'lucide-react-native';
import { memo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';

import { useTotalUnread } from '@/features/dm';
import { Dock, Fonts, Rule, ZIndex, floating } from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

/** The two declared tabs that sit left of the centre action. */
const LEFT: { name: string; icon: LucideIcon; label: string }[] = [
  { name: 'index', icon: House, label: 'Feed' },
  { name: 'explore', icon: Compass, label: 'Explore' },
];

export function NavBar({ state, navigation }: BottomTabBarProps) {
  const C = useColors();
  const { scheme } = useTheme();
  const insets = useSafeAreaInsets();
  const unread = useTotalUnread();

  const current = state.routes[state.index]?.name ?? '';

  const goTab = (name: string) => {
    const index = state.routes.findIndex((r) => r.name === name);
    if (index === -1) return;
    const route = state.routes[index];
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (state.index !== index && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  return (
    <View
      // Load-bearing: this layer spans the full width, so without it the
      // transparent margin either side of the capsule would swallow every tap
      // along the bottom of every screen. A full-bleed overlay in this app has
      // already caused exactly that once.
      pointerEvents="box-none"
      style={[styles.layer, { bottom: Dock.bottom + insets.bottom }]}>
      <BlurView
        intensity={scheme === 'dark' ? 40 : 60}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        // Android does not blur at all without this; the tint alone would leave
        // a flat translucent slab with nothing happening behind it.
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={[styles.capsule, { borderColor: C.chromeBorder }, floating(C)]}>
        {/*
          The tint rides ON TOP of the blur rather than being handed to BlurView
          as a background, because the blur is what the glass is and the colour
          only warms it. Underneath, the tint becomes the thing being blurred
          and the whole capsule reads as fog.
        */}
        <View style={[styles.tint, { backgroundColor: C.nav }]} />

        {LEFT.map((cell) => (
          <NavCell
            key={cell.name}
            icon={cell.icon}
            label={cell.label}
            focused={current === cell.name}
            onPress={() => goTab(cell.name)}
          />
        ))}

        <CreateButton />

        <NavCell
          icon={MessageCircle}
          label="Messages"
          focused={current.startsWith('messages')}
          badge={unread}
          onPress={() => router.push('/messages')}
        />
        <NavCell
          icon={User}
          label="You"
          focused={current === 'profile'}
          onPress={() => goTab('profile')}
        />
      </BlurView>
    </View>
  );
}

/* ------------------------------------------------------------------- cells */

type CellProps = {
  icon: LucideIcon;
  label: string;
  focused: boolean;
  badge?: number;
  onPress: () => void;
};

const NavCell = memo(function NavCell({
  icon: Icon,
  label,
  focused,
  badge = 0,
  onPress,
}: CellProps) {
  const C = useColors();

  /*
    Selection is carried by ink weight alone — no tile, no pill, no underline.
    On glass that is enough, and it is the one place this design is quieter than
    the bar it replaces: a filled selection chip inside a translucent capsule
    reads as a second piece of chrome floating inside the first.
  */
  const ink = focused ? C.ink : C.ink3;

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge > 0 ? label + ', ' + badge + ' unread' : label}
      onPress={onPress}
      style={({ pressed }) => [styles.cell, pressed ? styles.held : null]}>
      <Icon size={Dock.icon} strokeWidth={focused ? 2.4 : 2} color={ink} />

      {badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: C.live, borderColor: C.badgeRing }]}>
          <Text style={[styles.badgeText, { color: C.onLive }]}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

/* --------------------------------------------------------------------- FAB */

/**
 * Create a session.
 *
 * Lifted 20px out of the capsule and gradient-filled, which makes it the only
 * element in the shell that is unambiguously an ACTION rather than a place.
 * That is the accent rule doing its job: blue for the thing you do, and the
 * coral badge two cells over for the thing that is happening.
 */
const CreateButton = memo(function CreateButton() {
  const C = useColors();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Start a session"
      onPress={() => router.push('/room/create')}
      style={({ pressed }) => [styles.fabWrap, pressed ? styles.fabHeld : null]}>
      <LinearGradient
        colors={[C.priTint, C.pill]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          styles.fab,
          // The design's own recipe rather than `bloom()`, whose sizes are all
          // wider than this — a 60px button under a 42px blur reads as a smudge.
          { boxShadow: [{ offsetX: 0, offsetY: 12, blurRadius: 30, color: C.glow }] },
        ]}>
        <Plus size={Dock.fabIcon} strokeWidth={2.4} color={C.pillInk} />
      </LinearGradient>
    </Pressable>
  );
});

/* ------------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: Dock.inset,
    right: Dock.inset,
    zIndex: ZIndex.tabBar,
  },
  capsule: {
    height: Dock.height,
    borderRadius: Dock.radius,
    borderWidth: Rule.hair,
    paddingHorizontal: Dock.padding,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Without this the blur paints square corners behind the rounded border.
    overflow: 'hidden',
  },
  tint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  cell: {
    width: Dock.cell,
    height: Dock.cell,
    borderRadius: Dock.cell / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  held: {
    opacity: 0.6,
  },

  badge: {
    position: 'absolute',
    right: 5,
    top: 6,
    minWidth: 17,
    height: 17,
    borderRadius: 999,
    borderWidth: 2,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: Fonts.extrabold,
    fontSize: 9,
  },

  fabWrap: {
    // Lifts the button out of the capsule without changing the row's height.
    marginTop: -Dock.fabLift,
  },
  fab: {
    width: Dock.fab,
    height: Dock.fab,
    borderRadius: Dock.fab / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabHeld: {
    transform: [{ scale: 0.985 }],
  },
});
