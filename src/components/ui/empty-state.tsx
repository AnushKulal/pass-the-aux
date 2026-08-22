import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Space, Type } from '@/lib/theme';

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
};

/** Shown when a loaded list is genuinely empty — never in place of a Skeleton. */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <View style={styles.root}>
      <View style={styles.badge}>
        <Icon size={28} color={Colors.muted} />
      </View>

      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.xxxl,
    paddingHorizontal: Space.xl,
    gap: Space.md,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    // Glass rather than a solid block, so the badge tints when a Bloom sits
    // behind it.
    backgroundColor: Colors.glass,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    // Instrument Serif. Empty states are the one place the app speaks, so the
    // title takes the display face rather than the UI face.
    ...Type.title,
    color: Colors.text,
    textAlign: 'center',
  },
  description: {
    ...Type.body,
    color: Colors.muted,
    textAlign: 'center',
    maxWidth: 320,
  },
  action: {
    marginTop: Space.sm,
  },
});
