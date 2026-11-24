import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReactNode } from 'react';
import { t } from '../strings';
import { colors, fonts, TOUCH } from '../theme';

/** Small mobile header: avatar on the left, icon buttons on the right. No large titles. */
export function Header({ name, onAvatar, right }: { name: string; onAvatar?: () => void; right?: ReactNode }) {
  return (
    <View style={styles.row}>
      <Avatar name={name} onPress={onAvatar} />
      <View style={styles.right}>{right}</View>
    </View>
  );
}

export function Avatar({ name, onPress, size = TOUCH }: { name: string; onPress?: () => void; size?: number }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
  const circle = (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initials}</Text>
    </View>
  );
  if (!onPress) return circle;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t.a11y.openProfile} onPress={onPress} hitSlop={6}>
      {circle}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: fonts.bold, color: colors.onBrand },
});
