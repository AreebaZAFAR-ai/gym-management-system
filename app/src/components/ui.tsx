import Ionicons from '@expo/vector-icons/Ionicons';
import type { MembershipStatus } from '@gym/shared';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { t } from '../strings';
import { BIG_NUMBER, colors, fonts, radius, space, TOUCH } from '../theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

// ---------- Layout ----------

export function Screen({
  children,
  scroll = true,
  edges = ['top'],
  contentStyle,
  bottomInset = 0,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  contentStyle?: StyleProp<ViewStyle>;
  bottomInset?: number;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: space.xxl + bottomInset }, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

// ---------- Text ----------

type TxtVariant = 'body' | 'small' | 'label' | 'title' | 'section' | 'display' | 'big';

export function Txt({
  children,
  variant = 'body',
  color,
  style,
  numberOfLines,
  center,
}: {
  children: ReactNode;
  variant?: TxtVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  center?: boolean;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[textStyles[variant], color ? { color } : null, center ? { textAlign: 'center' } : null, style]}
    >
      {children}
    </Text>
  );
}

const textStyles = StyleSheet.create({
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, color: colors.text },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18, color: colors.text },
  section: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  title: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, color: colors.text, textTransform: 'uppercase' },
  display: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, color: colors.text },
  big: { fontFamily: fonts.display, fontSize: BIG_NUMBER, lineHeight: BIG_NUMBER + 4, color: colors.text },
});

// ---------- Buttons ----------

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  loading,
  big,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  big?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}) {
  const bg = {
    primary: colors.brand,
    secondary: colors.card,
    danger: colors.red,
    success: colors.green,
    ghost: 'transparent',
  }[kind];
  const fg = kind === 'secondary' || kind === 'ghost' ? colors.text : colors.onBrand;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: bg, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
        kind === 'secondary' && styles.buttonOutline,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={big ? 22 : 18} color={fg} /> : null}
          <Text style={[styles.buttonText, big && styles.buttonTextBig, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  filled,
  size = TOUCH,
  color,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  filled?: boolean;
  size?: number;
  color?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconButton,
        { width: size, height: size, opacity: pressed ? 0.7 : 1 },
        filled ? { backgroundColor: colors.brand, borderColor: colors.brand } : null,
      ]}
    >
      <Ionicons name={icon} size={size * 0.48} color={color ?? (filled ? colors.onBrand : colors.text)} />
    </Pressable>
  );
}

export function TextLink({ label, onPress, color }: { label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={10} style={{ minHeight: TOUCH, justifyContent: 'center' }}>
      <Text style={[styles.link, color ? { color } : null]}>{label}</Text>
    </Pressable>
  );
}

// ---------- Chips & pills ----------

export function Chip({
  label,
  selected,
  onPress,
  icon,
  tone,
  style,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  tone?: 'done' | 'current' | 'next';
  style?: StyleProp<ViewStyle>;
}) {
  const toneStyle =
    tone === 'done'
      ? { backgroundColor: colors.greenSoft, borderColor: colors.greenSoft }
      : tone === 'current'
        ? { backgroundColor: colors.brand, borderColor: colors.brand }
        : null;
  const textColor = selected || tone === 'current' ? colors.onBrand : tone === 'done' ? colors.green : colors.text;
  const content = (
    <>
      {icon ? <Ionicons name={icon} size={16} color={textColor} /> : null}
      <Text style={[styles.chipText, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </>
  );
  const base = [styles.chip, selected && styles.chipSelected, toneStyle, style];
  if (!onPress) return <View style={base}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [...base, { opacity: pressed ? 0.8 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

const STATUS_COLORS: Record<MembershipStatus, { bg: string; fg: string }> = {
  active: { bg: colors.greenSoft, fg: colors.green },
  due_soon: { bg: colors.amberSoft, fg: colors.amber },
  overdue: { bg: colors.redSoft, fg: colors.red },
  frozen: { bg: colors.blueSoft, fg: '#1F4E99' },
};

export function StatusPill({ status, label }: { status: MembershipStatus; label?: string }) {
  const c = STATUS_COLORS[status];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <View style={[styles.dot, { backgroundColor: c.fg }]} />
      <Text style={[styles.pillText, { color: c.fg }]}>{label ?? t.status[status]}</Text>
    </View>
  );
}

// ---------- Inputs ----------

export function Field({
  label,
  error,
  prefix,
  right,
  ...input
}: TextInputProps & { label: string; error?: string | null; prefix?: string; right?: ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={textStyles.label}>{label}</Text>
      <View style={[styles.input, error ? { borderColor: colors.red } : null]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={label}
          style={styles.inputText}
          {...input}
        />
        {right}
      </View>
      {error ? <Text style={[textStyles.small, { color: colors.red }]}>{error}</Text> : null}
    </View>
  );
}

/** Big − value + control. Display numbers are 40 px+ when `big`. */
export function Stepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  format = String,
  unit,
  big,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  unit?: string;
  big?: boolean;
  disabled?: boolean;
}) {
  const size = big ? 56 : TOUCH;
  return (
    <Row gap={space.md} style={{ justifyContent: 'center' }}>
      <IconButton
        icon="remove"
        label={t.a11y.decrease}
        size={size}
        onPress={() => !disabled && onChange(Math.max(min, round2(value - step)))}
      />
      <View style={{ minWidth: big ? 110 : 56, alignItems: 'center' }}>
        <Text style={[big ? textStyles.big : styles.stepperValue, disabled && { color: colors.textSecondary }]}>
          {format(value)}
        </Text>
        {unit ? <Text style={textStyles.small}>{unit}</Text> : null}
      </View>
      <IconButton
        icon="add"
        label={t.a11y.increase}
        size={size}
        onPress={() => !disabled && onChange(Math.min(max, round2(value + step)))}
      />
    </Row>
  );
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A row of mutually exclusive chips. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.wrap}>
      {options.map((o) => (
        <Chip key={String(o.value)} label={o.label} selected={o.value === value} onPress={() => onChange(o.value)} />
      ))}
    </View>
  );
}

// ---------- Feedback ----------

export function Banner({
  tone = 'info',
  text,
  action,
}: {
  tone?: 'info' | 'error' | 'success' | 'warn';
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  const c = {
    info: { bg: colors.card, fg: colors.text, icon: 'information-circle' as const },
    error: { bg: colors.redSoft, fg: colors.red, icon: 'alert-circle' as const },
    success: { bg: colors.greenSoft, fg: colors.green, icon: 'checkmark-circle' as const },
    warn: { bg: colors.amberSoft, fg: colors.amber, icon: 'cloud-offline' as const },
  }[tone];
  return (
    <View accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: c.bg }]}>
      <Ionicons name={c.icon} size={20} color={c.fg} />
      <Text style={[textStyles.body, { color: c.fg, flex: 1, fontSize: 14 }]}>{text}</Text>
      {action ? <TextLink label={action.label} onPress={action.onPress} color={c.fg} /> : null}
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: space.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={colors.text} />
    </View>
  );
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: space.lg,
    gap: space.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonBig: { minHeight: 64 },
  buttonOutline: { borderWidth: 1, borderColor: colors.border },
  buttonText: { fontFamily: fonts.semibold, fontSize: 16 },
  buttonTextBig: { fontSize: 18 },
  iconButton: {
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  link: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text, textDecorationLine: 'underline' },
  chip: {
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontFamily: fonts.medium, fontSize: 14 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontFamily: fonts.semibold, fontSize: 13 },
  input: {
    minHeight: 52,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: space.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  inputText: { flex: 1, fontFamily: fonts.regular, fontSize: 17, color: colors.text, paddingVertical: 12 },
  prefix: { fontFamily: fonts.semibold, fontSize: 17, color: colors.text },
  stepperValue: { fontFamily: fonts.display, fontSize: 32, color: colors.text },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
});
