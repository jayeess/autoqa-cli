/**
 * Row shapes the dashboard reads from Supabase.
 *
 * These mirror the tables that `autoqa generate-matrix` and
 * `autoqa run` push to — kept column-for-column so the `select()`
 * calls stay lean and TypeScript can catch typos.
 */

/** A row from the `test_matrices` table. */
export interface TestMatrixRow {
  id: string;
  source_url: string;
  page_title: string | null;
  captured_at: string | null;
  generated_at: string;
  total_cases: number;
}

/** A row from the `bug_reports` table. */
export interface BugReportRow {
  id: string;
  test_id: string | null;
  test_title: string;
  describe_path: string | null;
  source_spec: string | null;
  status: 'failed' | 'timedOut' | 'interrupted' | string;
  expected: string | null;
  actual: string | null;
  duration_ms: number | null;
  run_at: string;
}

/** Aggregate counters shown in the Command Center stat cards. */
export interface DashboardStats {
  totalMatrices: number;
  totalCases: number;
  totalBugReports: number;
  lastRunAt: string | null;
}
