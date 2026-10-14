import { EntityMetadata } from './types.js';

/**
 * Resolves a sync conflict between a local entity and an incoming entity using Last-Write-Wins (LWW).
 * 
 * Rules:
 * 1. The entity with the later `updatedAt` timestamp strictly wins.
 * 2. If `updatedAt` timestamps are identical:
 *    - If one has `isDeleted = true` and the other does not, deletion wins for safety.
 *    - Otherwise, incoming entity is preferred deterministically.
 */
export function resolveLWW<T extends EntityMetadata>(local: T, incoming: T): { winner: T; isUpdated: boolean } {
  const localTime = new Date(local.updatedAt).getTime();
  const incomingTime = new Date(incoming.updatedAt).getTime();

  if (incomingTime > localTime) {
    return { winner: incoming, isUpdated: true };
  }

  if (incomingTime < localTime) {
    return { winner: local, isUpdated: false };
  }

  // Identical timestamps tie-breaker
  if (incoming.isDeleted && !local.isDeleted) {
    return { winner: incoming, isUpdated: true };
  }

  if (!incoming.isDeleted && local.isDeleted) {
    return { winner: local, isUpdated: false };
  }

  // Pure identical tie: take incoming
  return { winner: incoming, isUpdated: true };
}
