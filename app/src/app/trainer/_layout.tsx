import { Stack } from 'expo-router';
import { RoleGate } from '../../lib/routes';
import { colors } from '../../theme';

export default function TrainerLayout() {
  return (
    <RoleGate roles={['trainer', 'owner']}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="plan" />
      </Stack>
    </RoleGate>
  );
}
