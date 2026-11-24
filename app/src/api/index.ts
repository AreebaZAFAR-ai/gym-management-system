import { API_URL, USE_MOCK_API } from '../config';
import { createHttpApi } from './http';
import { createMockApi } from './mock';
import type { GymApi } from './types';

export * from './types';

let unauthorizedHandler: () => void = () => {};

/** Called by the session provider so any 401 signs the person out. */
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

export const api: GymApi = USE_MOCK_API
  ? createMockApi(() => unauthorizedHandler())
  : createHttpApi(API_URL, () => unauthorizedHandler());
