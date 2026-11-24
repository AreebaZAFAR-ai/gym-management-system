import Constants from 'expo-constants';

export type BuildBrand = {
  id: string;
  name: string;
  short: string;
  city: string;
  primaryColor: string;
  payTo: { label: string; number: string; title: string };
  receptionWhatsapp: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as { brand?: BuildBrand; apiUrl?: string };

if (!extra.brand) throw new Error('Brand missing from app config. Build with GYM=<gym>.');

/** Brand baked in at build time from brands/<gym>.json. */
export const BRAND: BuildBrand = extra.brand;

/** API base URL, or "mock" for the built-in demo data. */
export const API_URL: string = extra.apiUrl ?? 'mock';
export const USE_MOCK_API = API_URL === 'mock' || API_URL === '';
