import Ionicons from '@expo/vector-icons/Ionicons';
import type { Exercise, MuscleGroup } from '@gym/shared';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../strings';
import { colors, fonts, radius, space, TOUCH } from '../theme';
import { Chip, IconButton, Row, Txt } from './ui';

const MUSCLES: MuscleGroup[] = ['chest', 'back', 'legs', 'shoulders', 'arms', 'core'];

/** Search, recent exercises and a muscle-group filter. */
export function ExercisePicker({
  visible,
  exercises,
  recentIds,
  onPick,
  onClose,
}: {
  visible: boolean;
  exercises: Exercise[];
  recentIds: string[];
  onPick: (e: Exercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [muscle, setMuscle] = useState<MuscleGroup | null>(null);

  const recent = useMemo(
    () => recentIds.map((id) => exercises.find((e) => e.id === id)).filter((e): e is Exercise => !!e),
    [recentIds, exercises],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return exercises
      .filter((e) => (!muscle || e.muscle === muscle) && (!q || e.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [exercises, query, muscle]);

  const showRecent = !query && !muscle && recent.length > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: space.lg }}>
          <Txt variant="title">{t.workout.pickerTitle}</Txt>
          <IconButton icon="close" label={t.common.close} onPress={onClose} />
        </Row>
        <View style={styles.search}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t.workout.search}
            placeholderTextColor={colors.textSecondary}
            accessibilityLabel={t.workout.search}
            style={styles.searchInput}
            autoCorrect={false}
          />
        </View>
        <View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            <Chip label={t.workout.all} selected={!muscle} onPress={() => setMuscle(null)} />
            {MUSCLES.map((m) => (
              <Chip key={m} label={t.muscles[m]} selected={muscle === m} onPress={() => setMuscle(muscle === m ? null : m)} />
            ))}
          </ScrollView>
        </View>
        <FlatList
          data={filtered}
          keyExtractor={(e) => e.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
          ListHeaderComponent={
            showRecent ? (
              <View style={{ gap: space.sm, marginBottom: space.lg }}>
                <Txt variant="section">{t.workout.recent}</Txt>
                <View style={styles.wrap}>
                  {recent.map((e) => (
                    <Chip key={e.id} label={e.name} icon="time-outline" onPress={() => onPick(e)} />
                  ))}
                </View>
              </View>
            ) : undefined
          }
          ListEmptyComponent={<Txt variant="small">{t.workout.noResults}</Txt>}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.bg }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Txt variant="small">
                  {t.muscles[item.muscle]} · {t.workout.equipment[item.equipment]}
                </Txt>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.card, gap: space.md, paddingTop: space.md },
  search: {
    marginHorizontal: space.lg,
    minHeight: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 17, color: colors.text },
  filters: { gap: space.sm, paddingHorizontal: space.lg },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  item: {
    minHeight: TOUCH + 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  itemName: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
});
