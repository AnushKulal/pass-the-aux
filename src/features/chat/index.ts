/**
 * Chat's public surface.
 *
 * Room and lounge screens mount the two wrappers and nothing else; the list,
 * composer and row are implementation detail and are free to be reshaped.
 */
export { LoungeChat, type LoungeChatProps } from '@/components/chat/lounge-chat';
export { RoomChat, type RoomChatProps } from '@/components/chat/room-chat';

export {
  chatKeys,
  useDeleteMessage,
  useMessageSubscription,
  useMessages,
  useSendMessage,
  useToggleReaction,
  useViewerId,
  type ChatAuthor,
  type ChatMessage,
  type ChatScope,
  type ReactionSummary,
  type ToggleReactionInput,
  type UseMessagesResult,
} from '@/features/chat/queries';
