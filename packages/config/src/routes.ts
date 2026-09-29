/** Canonical REST paths appended to the configured versioned API prefix. */
export const API_ROUTES = {
  health: '/health',
} as const;

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];
