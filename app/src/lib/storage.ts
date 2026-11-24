import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Secrets (token, check-in key) go to the phone's secure storage (Keychain / Keystore). */
export const secure = {
  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
    return SecureStore.getItemAsync(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') return void globalThis.localStorage?.setItem(key, value);
    await SecureStore.setItemAsync(key, value);
  },
  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') return void globalThis.localStorage?.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  },
};

/** Non-secret JSON cache (membership snapshot, exercises, offline queue). */
export const local = {
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async set<T>(key: string, value: T): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async remove(...keys: string[]): Promise<void> {
    await AsyncStorage.multiRemove(keys);
  },
};

export const KEYS = {
  token: 'auth.token',
  user: 'auth.user',
  checkinKey: 'checkin.key',
  membership: 'cache.membership',
  progress: 'cache.progress',
  exercises: 'cache.exercises',
  recentExercises: 'cache.recentExercises',
  todayPlan: 'cache.todayPlan',
  queue: 'queue.sessions',
  goal: 'local.goal',
} as const;

/** Everything tied to the signed-in person, wiped on log out. */
export const USER_CACHE_KEYS = [
  KEYS.membership,
  KEYS.progress,
  KEYS.recentExercises,
  KEYS.todayPlan,
  KEYS.queue,
  KEYS.goal,
];
