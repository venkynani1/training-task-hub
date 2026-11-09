import { neon } from "@neondatabase/serverless";

let _sql: ReturnType<typeof neon> | null = null;
let schemaReady: Promise<void> | null = null;

function client() {
  if (!_sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Add a Neon database in Vercel → Storage.");
    _sql = neon(url);
  }
  return _sql;
}

async function ensureSchema() {
  const sql = client();
  await sql`CREATE TABLE IF NOT EXISTS trainings (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    trainer TEXT DEFAULT '',
    requested_by TEXT DEFAULT '',
    mode TEXT DEFAULT '',
    location TEXT DEFAULT '',
    start_date DATE,
    end_date DATE,
    start_time TEXT DEFAULT '',
    end_time TEXT DEFAULT '',
    skip_weekends BOOLEAN DEFAULT TRUE,
    status_override TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`ALTER TABLE trainings ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'Demand Based'`;
  await sql`UPDATE trainings SET start_time = '15:00', end_time = '16:00'
            WHERE category = 'Masterclass' AND (start_time <> '15:00' OR end_time <> '16:00')`;
  await sql`CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    due_date DATE,
    priority TEXT DEFAULT 'Medium',
    status TEXT DEFAULT 'To do',
    source TEXT DEFAULT 'manual',
    email_subject TEXT DEFAULT '',
    email_from TEXT DEFAULT '',
    email_date TEXT DEFAULT '',
    email_body TEXT DEFAULT '',
    checklist JSONB DEFAULT '[]'::jsonb,
    training_id INTEGER REFERENCES trainings(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS participants (
    id SERIAL PRIMARY KEY,
    training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
    emp_id TEXT DEFAULT '',
    name TEXT NOT NULL,
    email TEXT DEFAULT ''
  )`;
  await sql`CREATE TABLE IF NOT EXISTS attendance (
    training_id INTEGER NOT NULL REFERENCES trainings(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    present BOOLEAN NOT NULL,
    PRIMARY KEY (participant_id, day)
  )`;
  await removeDuplicateTrainings(); // clean up copies left by earlier double imports
}

/**
 * Removes repeat copies of a training (same name ignoring case/spacing, same section, same start date;
 * undated rows are left alone so half-typed rows aren't merged).
 * Keeps the oldest copy, moves linked tasks onto it, and only deletes copies with no participants or attendance.
 */
export async function removeDuplicateTrainings(): Promise<number> {
  const sql = client();
  const dupes = (await sql`
    WITH keyed AS (
      SELECT id, lower(regexp_replace(trim(name), '\s+', ' ', 'g')) AS n,
             COALESCE(category, 'Demand Based') AS c, start_date AS sd
      FROM trainings WHERE start_date IS NOT NULL
    ), ranked AS (
      SELECT id, min(id) OVER (PARTITION BY n, c, sd) AS keep_id FROM keyed
    )
    SELECT r.id, r.keep_id FROM ranked r
    WHERE r.id <> r.keep_id
      AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.training_id = r.id)
      AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.training_id = r.id)`) as { id: number; keep_id: number }[];
  for (const d of dupes) {
    await sql`UPDATE tasks SET training_id = ${d.keep_id} WHERE training_id = ${d.id}`;
    await sql`DELETE FROM trainings WHERE id = ${d.id}`;
  }
  return dupes.length;
}

/** Tagged-template SQL that makes sure tables exist before the first query. */
export async function q<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<T[]> {
  if (!schemaReady) schemaReady = ensureSchema().catch((e) => { schemaReady = null; throw e; });
  await schemaReady;
  return (await client()(strings, ...values)) as T[];
}
