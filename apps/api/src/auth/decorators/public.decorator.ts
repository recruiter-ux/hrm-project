import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as reachable WITHOUT a valid access token.
 *
 * JwtAuthGuard is registered globally, so every endpoint is protected by
 * default and you have to opt out explicitly. That is the safe direction: a
 * forgotten decorator locks an endpoint down rather than exposing it.
 *
 * Currently used only by login, refresh, and the health check.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
