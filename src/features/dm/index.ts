/**
 * The DM feature's public surface.
 *
 * The inbox screen, the thread screen, the composer and the rail's DM tile all
 * bind to this — nothing outside `@/features/dm` should reach into `queries.ts`
 * directly, so the fetch shapes stay free to change.
 */

export {
  dmKeys,
  previewForKind,
  useDeleteMessage,
  useDmSubscription,
  useInbox,
  useMarkRead,
  useOpenConversation,
  useSendMessage,
  useSignedUrl,
  useThread,
  useTotalUnread,
  useUploadAttachment,
  type DmAttachment,
  type DmAuthor,
  type DmMessage,
  type DmTrack,
  type InboxRow,
  type SendDmInput,
  type UploadAttachmentInput,
  type UseInboxResult,
  type UseThreadResult,
} from '@/features/dm/queries';

/**
 * Re-exported so DM screens do not have to import a chat internal for something
 * as general as "who is signed in". It is the same hook and the same cache
 * entry, not a second copy.
 */
export { useViewerId } from '@/features/chat/queries';
