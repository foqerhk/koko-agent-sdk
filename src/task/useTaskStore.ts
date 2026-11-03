import { useEffect, useState } from 'react';
import { TaskStore } from './TaskStore';
import type { TaskStoreSnapshot } from './types';

export function useTaskStore(): TaskStoreSnapshot {
  const [snap, setSnap] = useState<TaskStoreSnapshot>(() => TaskStore.snapshot());
  useEffect(() => TaskStore.subscribe(setSnap), []);
  return snap;
}
