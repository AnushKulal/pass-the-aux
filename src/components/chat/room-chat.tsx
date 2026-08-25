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
 * `ground="sheet"` IS THE WHOLE REASON THIS WRAPPER IS SEPARATE. This log lives
 * inside the player's sheet — a blurred `chrome` panel (design L1166) — and on
 * that ground the translucent `surface` every card would otherwise take is
 * 5.5% white over a 72% panel over a blur, which composites to almost nothing.
 * The prop swaps every fill in the log and the composer to its opaque twin, and
 * matches the design, which draws the Session composer on `bg2` (L1280) where
 * the lounge draws it on glass (L492).
 *
 * It also defaults `bottomInset` to 0 — the sheet already pads for the home
 * indicator, and padding twice leaves a dead band under the composer.
 */
export function RoomChat({ roomId, loungeId, keyboardOffset = 0, bottomInset = 0 }: RoomChatProps) {
  return (
    <View style={styles.root}>
      <ChatList
        loungeId={loungeId}
        roomId={roomId}
        ground="sheet"
        emptyLabel="React to what's playing — everyone in the Session sees it."
      />
      <ChatComposer
        loungeId={loungeId}
        roomId={roomId}
        ground="sheet"
        placeholder="Say something"
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
