import type pg from "pg";

const MIGRATIONS: { name: string; up: string }[] = [
  {
    name: "001_create_users",
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        clerk_id TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        private_key_encrypted TEXT NOT NULL,
        avatar_definition JSONB NOT NULL DEFAULT '{"avatarIndex": 0}',
        last_position JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ
      );
    `,
  },
  {
    name: "002_create_plots",
    up: `
      CREATE TABLE IF NOT EXISTS plots (
        uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id UUID NOT NULL REFERENCES users(id),
        neighborhood TEXT NOT NULL DEFAULT 'origin',
        ring INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (neighborhood, ring, position)
      );
    `,
  },
  {
    name: "003_create_world_objects",
    up: `
      CREATE TABLE IF NOT EXISTS world_objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plot_uuid UUID NOT NULL REFERENCES plots(uuid),
        name TEXT NOT NULL,
        description TEXT,
        tags TEXT[],
        object_definition JSONB NOT NULL,
        state_data JSONB NOT NULL DEFAULT '{}',
        render_cost NUMERIC NOT NULL,
        origin_x FLOAT NOT NULL,
        origin_y FLOAT NOT NULL,
        origin_z FLOAT NOT NULL,
        scale_x FLOAT NOT NULL DEFAULT 1,
        scale_y FLOAT NOT NULL DEFAULT 1,
        scale_z FLOAT NOT NULL DEFAULT 1,
        rotation_x FLOAT NOT NULL DEFAULT 0,
        rotation_y FLOAT NOT NULL DEFAULT 0,
        rotation_z FLOAT NOT NULL DEFAULT 0,
        rotation_w FLOAT NOT NULL DEFAULT 1,
        asset_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        modified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        modified_by UUID NOT NULL REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_world_objects_plot ON world_objects(plot_uuid);
      CREATE INDEX IF NOT EXISTS idx_world_objects_asset ON world_objects(asset_hash);
    `,
  },
  {
    name: "004_create_assets",
    up: `
      CREATE TABLE IF NOT EXISTS assets (
        content_hash TEXT PRIMARY KEY,
        creator_id UUID NOT NULL REFERENCES users(id),
        creator_public_key TEXT NOT NULL,
        signature TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        s3_key TEXT NOT NULL,
        file_size_bytes BIGINT NOT NULL,
        metadata JSONB NOT NULL DEFAULT '{}',
        dependencies TEXT[],
        adoption_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_assets_creator ON assets(creator_id);
    `,
  },
  {
    name: "005_create_plot_metrics",
    up: `
      CREATE TABLE IF NOT EXISTS plot_metrics (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plot_uuid UUID NOT NULL REFERENCES plots(uuid),
        visitor_id UUID NOT NULL REFERENCES users(id),
        entered_at TIMESTAMPTZ NOT NULL,
        exited_at TIMESTAMPTZ,
        dwell_seconds INTEGER,
        visit_type TEXT NOT NULL DEFAULT 'normal'
      );
      CREATE INDEX IF NOT EXISTS idx_plot_metrics_plot ON plot_metrics(plot_uuid);
      CREATE INDEX IF NOT EXISTS idx_plot_metrics_visitor ON plot_metrics(visitor_id);
      CREATE INDEX IF NOT EXISTS idx_plot_metrics_entered ON plot_metrics(entered_at);
    `,
  },
  {
    name: "006_create_chat_messages",
    up: `
      CREATE TABLE IF NOT EXISTS chat_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        sender_id UUID NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        position_x FLOAT NOT NULL,
        position_y FLOAT NOT NULL,
        position_z FLOAT NOT NULL,
        neighborhood TEXT NOT NULL,
        ring INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_messages_location
        ON chat_messages(neighborhood, ring, created_at);
    `,
  },
  {
    name: "007_create_staging_objects",
    up: `
      CREATE TABLE IF NOT EXISTS staging_objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        creator_id UUID NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        description TEXT,
        tags TEXT[],
        object_definition JSONB NOT NULL,
        state_data JSONB NOT NULL DEFAULT '{}',
        render_cost NUMERIC NOT NULL,
        origin_x FLOAT NOT NULL,
        origin_y FLOAT NOT NULL,
        origin_z FLOAT NOT NULL,
        scale_x FLOAT NOT NULL DEFAULT 1,
        scale_y FLOAT NOT NULL DEFAULT 1,
        scale_z FLOAT NOT NULL DEFAULT 1,
        rotation_x FLOAT NOT NULL DEFAULT 0,
        rotation_y FLOAT NOT NULL DEFAULT 0,
        rotation_z FLOAT NOT NULL DEFAULT 0,
        rotation_w FLOAT NOT NULL DEFAULT 1,
        asset_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_staging_objects_creator ON staging_objects(creator_id);
    `,
  },
  {
    name: "008_create_moderation_log",
    up: `
      CREATE TABLE IF NOT EXISTS moderation_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        moderator_id UUID NOT NULL REFERENCES users(id),
        target_type TEXT NOT NULL,
        target_id UUID NOT NULL,
        action TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `,
  },
  {
    name: "009_create_generated_objects",
    up: `
      CREATE TABLE IF NOT EXISTS generated_objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        prompt TEXT NOT NULL,
        tags TEXT[],
        object_definition JSONB NOT NULL,
        preview_task_id TEXT,
        refine_task_id TEXT,
        glb_url TEXT,
        thumbnail_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by TEXT NOT NULL DEFAULT 'dev-user',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_generated_objects_status ON generated_objects(status);
      CREATE INDEX IF NOT EXISTS idx_generated_objects_created ON generated_objects(created_at DESC);
    `,
  },
  {
    name: "010_create_daemons",
    up: `
      CREATE TABLE IF NOT EXISTS daemons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plot_uuid UUID NOT NULL REFERENCES plots(uuid),
        owner_id UUID NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        description TEXT,
        daemon_definition JSONB NOT NULL,
        appearance JSONB NOT NULL,
        behavior JSONB NOT NULL,
        position_x FLOAT NOT NULL DEFAULT 0,
        position_y FLOAT NOT NULL DEFAULT 0,
        position_z FLOAT NOT NULL DEFAULT 0,
        rotation FLOAT NOT NULL DEFAULT 0,
        is_active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_daemons_plot ON daemons(plot_uuid);
      CREATE INDEX IF NOT EXISTS idx_daemons_owner ON daemons(owner_id);
    `,
  },
];

export async function runMigrations(pool: pg.Pool): Promise<void> {
  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  const { rows } = await pool.query("SELECT name FROM _migrations");
  const applied = new Set(rows.map((r: { name: string }) => r.name));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    console.log(`Running migration: ${migration.name}`);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.up);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
        migration.name,
      ]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
