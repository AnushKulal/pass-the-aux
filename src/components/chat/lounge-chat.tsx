import { StyleSheet, View } from 'react-native';

import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatList } from '@/components/chat/chat-list';

export type LoungeChatProps = {
  loungeId: string;
  /** Height of any tab bar or header the composer must clear when the keyboard opens. */
  keyboardOffset?: number;
  bottomInset?: number;
};

/**
 * Lounge-wide chat: every message with `room_id IS NULL` for this community.
 *
 * `ground` is left at its `screen` default here and only here — this log is
 * drawn straight onto the app ground, so its cards can be the translucent glass
 * the direction is built on and the ambient blobs bleed through them.
 */
export function LoungeChat({ loungeId, keyboardOffset = 0, bottomInset }: LoungeChatProps) {
  return (
    <View style={styles.root}>
      <ChatList
        loungeId={loungeId}
        roomId={null}
        emptyLabel="Say hello, or drop a track everyone should hear."
      />
      <ChatComposer
        loungeId={loungeId}
        roomId={null}
        placeholder="Message the lounge"
        keyboardOffset={keyboardOffset}
        bottomInset={bottomInset}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
