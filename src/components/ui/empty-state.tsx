import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/lib/theme-context';
import { Radius, Rule, Space, Type } from '@/lib/theme';

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
};

/**
 * Shown when a loaded list is genuinely empty — never in place of a Skeleton.
 *
 * A bordered block, flush left, exactly like the prototype's "You are not in a
 * lounge yet" and "No lounges yet" markers. No centred illustration and no
 * badge: an empty state here is a note in the margin, not an event, and
 * centring it would give it more weight than the content it is standing in for.
 */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  const C = useColors();

  return (
    <View style={[styles.root, { borderColor: C.rule2 }]}>
      <Icon size={20} strokeWidth={2} color={C.ink3} />

      <Text style={[styles.title, { color: C.ink }]}>{title}</Text>
      {description ? (
        <Text style={[styles.description, { color: C.ink2 }]}>{description}</Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'flex-start',
    padding: Space.lg,
    gap: Space.sm,
    borderRadius: Radius,
    borderWidth: Rule.hair,
  },
  title: {
    ...Type.heading(15),
  },
  description: {
    ...Type.body(16),
    maxWidth: 380,
  },
  action: {
    marginTop: Space.xs,
  },
});
