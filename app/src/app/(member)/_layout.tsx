import { Stack } from 'expo-router';
import { RoleGate } from '../../lib/routes';
import { colors } from '../../theme';

export default function MemberLayout() {
  return (
    <RoleGate roles={['member']}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile" />
        <Stack.Screen name="checkin" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
        <Stack.Screen name="history/[exerciseId]" />
      </Stack>
    </RoleGate>
  );
}
