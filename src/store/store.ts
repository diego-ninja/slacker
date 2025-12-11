// ABOUTME: Interface definition for event state storage
// ABOUTME: Abstracts storage implementation for testability

import type { StatusEvent } from '../types.js';

export interface StateStore {
  upsert(event: StatusEvent): void;
  getActive(): StatusEvent[];
  get(id: string): StatusEvent | null;
  deactivate(id: string): void;
  prune(olderThan: Date): number;
  close(): void;
}
