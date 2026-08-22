/**
 * The Aux UI kit. Screens should import from '@/components/ui' only — reaching
 * into individual files couples callers to file names that may split later.
 */
export { BLURHASH_SURFACE } from '@/components/ui/blurhash';

export { Avatar, type AvatarProps } from '@/components/ui/avatar';
export {
  AuxButton,
  type AuxButtonProps,
  type AuxButtonSize,
  type AuxButtonVariant,
} from '@/components/ui/aux-button';
export { EmptyState, type EmptyStateProps } from '@/components/ui/empty-state';
export {
  GlassCard,
  Panel,
  type GlassCardProps,
  type PanelProps,
} from '@/components/ui/glass-card';
export { LivePulse, type LivePulseProps } from '@/components/ui/live-pulse';
export { ProgressBar, type ProgressBarProps } from '@/components/ui/progress-bar';
/*
  `Rule` is also the name of the weight table in '@/lib/theme'. A file that wants
  both should import one of them aliased — `import { Rule as RuleWeight } from
  '@/lib/theme'` — or use the `Divider` alias exported here.
*/
export { Divider, Rule, type RuleProps, type RuleWeightName } from '@/components/ui/rule';
export { Screen, type ScreenProps } from '@/components/ui/screen';
export {
  SheetTabs,
  type SheetTab,
  type SheetTabsProps,
  type SheetTabsVariant,
} from '@/components/ui/sheet-tabs';
export { Skeleton, type SkeletonProps } from '@/components/ui/skeleton';
export { TextField, type TextFieldProps } from '@/components/ui/text-field';
export {
  ToastProvider,
  useToast,
  type ToastApi,
  type ToastVariant,
} from '@/components/ui/toast';
