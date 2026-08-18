import type { Database } from './database.types.js';

export function tableName(): keyof Database['public']['Tables'] {
  return 'todos';
}
