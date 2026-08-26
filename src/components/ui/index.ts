/**
 * The Aux UI kit. Screens should import from '@/components/ui' only — reaching
 * into individual files couples callers to file names that may split later.
 */
export { BLURHASH_SURFACE } from '@/components/ui/blurhash';

export { Avatar, type AvatarProps } from '@/components/ui/avatar';
export {
  AuxButton,
  PillButton,
  type AuxButtonAlign,
  type AuxButtonProps,
  type AuxButtonShape,
  type AuxButtonSize,
  type AuxButtonVariant,
  type PillButtonProps,
} from '@/components/ui/aux-button';
/*
  `Chip` is also the name of the metrics token in '@/lib/theme' — the same
  collision `Rule` has below. A file wanting both should alias the token:
  `import { Chip as ChipMetrics } from '@/lib/theme'`, which is what
  'chip.tsx' itself does.
*/
export {
  Chip,
  ChipRow,
  type ChipItem,
  type ChipProps,
  type ChipRole,
  type ChipRowProps,
  type ChipRowVariant,
} from '@/components/ui/chip';
export {
  CircleIconButton,
  type CircleIconButtonProps,
  type CircleIconButtonSize,
  type CircleIconButtonTone,
} from '@/components/ui/circle-icon-button';
export {
  ConfirmDialog,
  type ConfirmDialogProps,
  type ConfirmDialogTone,
} from '@/components/ui/confirm-dialog';
export {
  EmptyState,
  type EmptyStateAction,
  type EmptyStateProps,
  type EmptyStateSize,
} from '@/components/ui/empty-state';
export {
  GlassCard,
  Panel,
  type GlassCardGlow,
  type GlassCardProps,
  type GlassCardTone,
  type GlassCardVariant,
  type PanelProps,
} from '@/components/ui/glass-card';
export {
  LivePulse,
  type LivePulseProps,
  type LivePulseTempo,
} from '@/components/ui/live-pulse';
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
export {
  StatusPill,
  type StatusPillProps,
  type StatusPillSize,
  type StatusPillTone,
} from '@/components/ui/status-pill';
export { TextField, type TextFieldProps } from '@/components/ui/text-field';
export {
  ToastProvider,
  useToast,
  type ToastApi,
  type ToastVariant,
} from '@/components/ui/toast';
