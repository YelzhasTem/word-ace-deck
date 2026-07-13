import { supabase } from "@/integrations/supabase/client";

type DbError = { message: string; code?: string };
type DbRowsResult<T> = { data: T[] | null; error: DbError | null };
type DbWriteResult<T> = { data?: T[] | null; error: DbError | null };

type DbQuery<T> = PromiseLike<DbRowsResult<T>> & {
  select(columns?: string): DbQuery<T>;
  eq(column: string, value: unknown): DbQuery<T>;
  gte(column: string, value: unknown): DbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): DbQuery<T>;
  limit(count: number): DbQuery<T>;
  insert(values: unknown): PromiseLike<DbWriteResult<T>>;
  upsert(values: unknown, options?: { onConflict?: string }): PromiseLike<DbWriteResult<T>>;
  update(values: unknown): DbQuery<T>;
  delete(): DbQuery<T>;
};

type AccountLearningDb = {
  from<T = Record<string, unknown>>(table: string): DbQuery<T>;
};

export function accountLearningDb() {
  return supabase as unknown as AccountLearningDb;
}
