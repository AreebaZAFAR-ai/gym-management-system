import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '../theme';

/** Weight stack built from +5 / +10 kg blocks; newest on top. */
export function MachineStack({ blocks }: { blocks: number[] }) {
  return (
    <View style={styles.wrap} accessible accessibilityLabel={`Weight stack: ${blocks.join(' + ') || 'empty'}`}>
      {blocks.length === 0 ? <View style={[styles.block, styles.empty]} /> : null}
      {[...blocks]
        .reverse()
        .slice(0, 10)
        .map((b, i) => (
          <View key={i} style={[styles.block, { height: b === 10 ? 18 : 10 }]}>
            {b === 10 ? <Text style={styles.label}>10</Text> : null}
          </View>
        ))}
      {blocks.length > 10 ? <Text style={styles.more}>+{blocks.length - 10} more</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'flex-end', gap: 3, minHeight: 110, paddingVertical: 4 },
  block: {
    width: 120,
    borderRadius: 4,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { height: 10, backgroundColor: colors.border },
  label: { color: colors.onBrand, fontFamily: fonts.semibold, fontSize: 11 },
  more: { fontFamily: fonts.medium, fontSize: 12, color: colors.textSecondary },
});
