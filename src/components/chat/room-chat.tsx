import { StyleSheet, View } from 'react-native';

import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatList } from '@/components/chat/chat-list';

export type RoomChatProps = {
  roomId: string;
  loungeId: string;
  /** Forwarded to the composer — see ChatComposerProps for why the sheet needs it. */
  keyboardOffset?: number;
  bottomInset?: number;
};

/**
 * Session chat: the same log as the lounge, scoped to one room.
 *
 * Lives inside the room's bottom sheet, so it defaults `bottomInset` to 0 —
 * the sheet already pads for the home indicator, and padding twice leaves a
 * dead band under the composer.
 */
export function RoomChat({ roomId, loungeId, keyboardOffset = 0, bottomInset = 0 }: RoomChatProps) {
  return (
    <View style={styles.root}>
      <ChatList
        loungeId={loungeId}
        roomId={roomId}
        emptyTitle="Quiet in here"
        emptyDescription="React to what's playing — everyone in the Session sees it."
      />
      <ChatComposer
        loungeId={loungeId}
        roomId={roomId}
        placeholder="Message the Session"
        keyboardOffset={keyboardOffset}
        bottomInset={bottomInset}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The list takes the remaining height and the composer sits under it, which is
   * what lets the composer's KeyboardAvoidingView steal space from the list
   * rather than pushing itself off the bottom of the sheet.
   */
  root: {
    flex: 1,
  },
});
