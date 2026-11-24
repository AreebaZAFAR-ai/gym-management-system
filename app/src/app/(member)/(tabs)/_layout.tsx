import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { t } from '../../../strings';
import { colors, floatingShadow, fonts, radius } from '../../../theme';

/** Floating tab bar with only Progress and Workout (spec §4, §12). */
export default function MemberTabs() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.onBrand,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarActiveBackgroundColor: colors.brand,
        tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 13 },
        tabBarItemStyle: { borderRadius: radius.pill, margin: 6 },
        tabBarIconStyle: { marginBottom: -2 },
        tabBarStyle: {
          position: 'absolute',
          left: 0,
          right: 0,
          marginHorizontal: 48,
          bottom: 20,
          height: 68,
          paddingBottom: 0,
          borderRadius: radius.pill,
          borderTopWidth: 0,
          backgroundColor: colors.card,
          ...floatingShadow,
        },
      }}
    >
      <Tabs.Screen
        name="progress"
        options={{
          title: t.tabs.progress,
          tabBarIcon: ({ color, size }) => <Ionicons name="stats-chart" color={color as string} size={size - 2} />,
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{
          title: t.tabs.workout,
          tabBarIcon: ({ color, size }) => <Ionicons name="barbell" color={color as string} size={size} />,
        }}
      />
    </Tabs>
  );
}
