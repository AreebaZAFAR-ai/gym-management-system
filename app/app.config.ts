/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * White-label build config (spec §12).
 *
 *   GYM=ironhouse API_URL=https://api.example.pk npx eas-cli build
 *
 * Reads brands/<GYM>.json for name, colour, gym ID and bundle ID, and
 * brands/<GYM>/icon.png + splash.png for images. Pay-to details and grace
 * days come from the server at runtime, so the owner can change them.
 * Leave API_URL unset (or "mock") to run against the built-in demo data.
 */

type BrandFile = {
  id: string;
  name: string;
  short: string;
  city: string;
  primaryColor: string;
  bundleId: string;
  payTo: { label: string; number: string; title: string };
  receptionWhatsapp: string;
};

const gym = process.env.GYM ?? 'ironhouse';
const brandPath = path.join(__dirname, 'brands', `${gym}.json`);
if (!fs.existsSync(brandPath)) {
  throw new Error(`No brand file at brands/${gym}.json. See README "Adding a gym".`);
}
const brand: BrandFile = JSON.parse(fs.readFileSync(brandPath, 'utf8'));

const brandAsset = (file: string, fallback: string) =>
  fs.existsSync(path.join(__dirname, 'brands', gym, file)) ? `./brands/${gym}/${file}` : fallback;

const icon = brandAsset('icon.png', './assets/images/icon.png');
const splash = brandAsset('splash.png', './assets/images/splash-icon.png');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: brand.name,
  slug: `gym-${brand.id}`,
  version: '1.0.0',
  orientation: 'portrait',
  icon,
  scheme: brand.id,
  userInterfaceStyle: 'light',
  backgroundColor: '#F2F3F1',
  ios: {
    bundleIdentifier: brand.bundleId,
    supportsTablet: false,
    icon,
  },
  android: {
    package: brand.bundleId,
    adaptiveIcon: {
      backgroundColor: '#F2F3F1',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: 'single',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      'expo-splash-screen',
      { backgroundColor: '#F2F3F1', image: splash, imageWidth: 120 },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'The camera scans member check-in codes at the door.',
        recordAudioAndroid: false,
        barcodeScannerEnabled: true,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Choose a screenshot of your fee payment to send to reception.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: false,
    reactCompiler: true,
  },
  extra: {
    brand: {
      id: brand.id,
      name: brand.name,
      short: brand.short,
      city: brand.city,
      primaryColor: brand.primaryColor,
      payTo: brand.payTo,
      receptionWhatsapp: brand.receptionWhatsapp,
    },
    apiUrl: process.env.API_URL ?? 'mock',
  },
});
