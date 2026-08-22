import { router } from 'expo-router';
import { Compass, House } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { AuxButton, EmptyState, Screen } from '@/components/ui';

/**
 * Reached by a bad deep link — a shared room URL for a Session that ended, or a
 * lounge invite that was revoked. `replace` rather than `back` because the
 * history entry that got us here is itself the broken one.
 */
export default function NotFoundScreen() {
  return (
    <Screen title="Off the map">
      <View style={styles.center}>
        <EmptyState
          icon={Compass}
          title="This link went nowhere"
          description="The lounge or Session you followed may have ended, or the invite was revoked."
          action={<AuxButton label="Back to Home" icon={House} onPress={() => router.replace('/')} />}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
  },
});
