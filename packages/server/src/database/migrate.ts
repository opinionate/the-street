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
  {
    name: "011_create_daemon_memories",
    up: `
      CREATE TABLE IF NOT EXISTS daemon_memories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daemon_id UUID NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
        player_id UUID REFERENCES users(id),
        other_daemon_id UUID REFERENCES daemons(id) ON DELETE SET NULL,
        memory_type TEXT NOT NULL DEFAULT 'conversation',
        summary TEXT NOT NULL,
        mood TEXT NOT NULL DEFAULT 'neutral',
        interaction_count INTEGER NOT NULL DEFAULT 1,
        last_interaction TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_daemon_memories_daemon ON daemon_memories(daemon_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_memories_player ON daemon_memories(daemon_id, player_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_memories_daemon_pair ON daemon_memories(daemon_id, other_daemon_id);

      ALTER TABLE daemons ADD COLUMN IF NOT EXISTS current_mood TEXT NOT NULL DEFAULT 'neutral';
      ALTER TABLE daemons ADD COLUMN IF NOT EXISTS total_interactions INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: "012_daemon_relationships_and_memory_upsert",
    up: `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daemon_memories_unique_player
        ON daemon_memories(daemon_id, player_id) WHERE player_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daemon_memories_unique_daemon
        ON daemon_memories(daemon_id, other_daemon_id) WHERE other_daemon_id IS NOT NULL;

      ALTER TABLE daemon_memories ADD COLUMN IF NOT EXISTS player_name TEXT;
      ALTER TABLE daemon_memories ADD COLUMN IF NOT EXISTS sentiment TEXT NOT NULL DEFAULT 'neutral';
      ALTER TABLE daemon_memories ADD COLUMN IF NOT EXISTS gossip JSONB NOT NULL DEFAULT '[]';
    `,
  },
  {
    name: "013_create_avatar_history",
    up: `
      CREATE TABLE IF NOT EXISTS avatar_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        avatar_definition JSONB NOT NULL,
        mesh_description TEXT,
        meshy_task_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_avatar_history_user ON avatar_history(user_id, created_at DESC);
    `,
  },
  {
    name: "014_avatar_history_thumbnail",
    up: `
      ALTER TABLE avatar_history ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
    `,
  },
  {
    name: "015_daemon_mesh_columns",
    up: `
      ALTER TABLE daemons ADD COLUMN IF NOT EXISTS mesh_description TEXT;
      ALTER TABLE daemons ADD COLUMN IF NOT EXISTS meshy_task_id TEXT;
      ALTER TABLE daemons ADD COLUMN IF NOT EXISTS rig_task_id TEXT;
      ALTER TABLE daemons ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
    `,
  },
  {
    name: "016_daemon_memory_summaries",
    up: `
      CREATE TABLE IF NOT EXISTS daemon_memory_summaries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daemon_id UUID NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_name TEXT NOT NULL,
        summary TEXT NOT NULL,
        sentiment TEXT NOT NULL DEFAULT 'neutral',
        interaction_count INTEGER NOT NULL DEFAULT 0,
        topic_history JSONB NOT NULL DEFAULT '[]',
        gossip JSONB NOT NULL DEFAULT '[]',
        nickname TEXT,
        last_interaction TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_daemon_memory_summaries_daemon ON daemon_memory_summaries(daemon_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daemon_memory_summaries_unique ON daemon_memory_summaries(daemon_id, target_id);
    `,
  },
  {
    name: "017_add_user_role",
    up: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
      CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    `,
  },
  {
    name: "018_local_asset_cache",
    up: `
      ALTER TABLE avatar_history ADD COLUMN IF NOT EXISTS assets_cached BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE daemons ADD COLUMN IF NOT EXISTS assets_cached BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE generated_objects ADD COLUMN IF NOT EXISTS assets_cached BOOLEAN NOT NULL DEFAULT false;
    `,
  },
  {
    name: "019_custom_animations",
    up: `
      CREATE TABLE IF NOT EXISTS custom_animations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type TEXT NOT NULL CHECK (entity_type IN ('avatar', 'daemon')),
        entity_id TEXT NOT NULL,
        slot TEXT NOT NULL,
        original_filename TEXT,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(entity_type, entity_id, slot)
      );
    `,
  },
  {
    name: "020_avatar_uploads",
    up: `
      CREATE TABLE IF NOT EXISTS avatar_uploads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        original_filename TEXT NOT NULL,
        file_size_bytes INTEGER NOT NULL,
        bone_space TEXT NOT NULL DEFAULT 'mixamo',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_avatar_uploads_user ON avatar_uploads(user_id, created_at DESC);
    `,
  },
  {
    name: "021_daemon_nullable_plot",
    up: `
      ALTER TABLE daemons ALTER COLUMN plot_uuid DROP NOT NULL;
      ALTER TABLE daemons DROP CONSTRAINT IF EXISTS daemons_plot_uuid_fkey;
      ALTER TABLE daemons ADD CONSTRAINT daemons_plot_uuid_fkey
        FOREIGN KEY (plot_uuid) REFERENCES plots(uuid) ON DELETE SET NULL;
    `,
  },
  {
    name: "022_create_personality_manifests",
    up: `
      CREATE TABLE IF NOT EXISTS personality_manifests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daemon_id UUID NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
        version INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        voice_description TEXT NOT NULL,
        backstory TEXT NOT NULL,
        compiled_system_prompt TEXT NOT NULL,
        compiled_token_count INTEGER NOT NULL,
        compiled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        interests TEXT[] NOT NULL DEFAULT '{}',
        dislikes TEXT[] NOT NULL DEFAULT '{}',
        mutable_traits JSONB NOT NULL DEFAULT '[]',
        available_emotes JSONB NOT NULL DEFAULT '[]',
        crowd_affinity FLOAT NOT NULL DEFAULT 0,
        territoriality FLOAT NOT NULL DEFAULT 0,
        conversation_length TEXT NOT NULL DEFAULT 'moderate'
          CHECK (conversation_length IN ('brief', 'moderate', 'extended')),
        initiates_conversation BOOLEAN NOT NULL DEFAULT false,
        max_conversation_turns INTEGER NOT NULL DEFAULT 10,
        max_daily_calls INTEGER NOT NULL DEFAULT 200,
        daily_budget_resets_at TEXT NOT NULL DEFAULT '00:00',
        remember_visitors BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_personality_manifests_daemon
        ON personality_manifests(daemon_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_personality_manifests_daemon_version
        ON personality_manifests(daemon_id, version);
    `,
  },
  {
    name: "023_create_conversation_sessions",
    up: `
      CREATE TABLE IF NOT EXISTS conversation_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daemon_id UUID NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL,
        participant_type TEXT NOT NULL CHECK (participant_type IN ('visitor', 'daemon')),
        started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        ended_at TIMESTAMPTZ,
        turn_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'ended_natural', 'ended_timeout', 'ended_budget',
                            'ended_departed', 'ended_context_limit')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_sessions_daemon
        ON conversation_sessions(daemon_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_sessions_daemon_status
        ON conversation_sessions(daemon_id, status);
      CREATE INDEX IF NOT EXISTS idx_conversation_sessions_participant
        ON conversation_sessions(participant_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_sessions_started
        ON conversation_sessions(started_at);
    `,
  },
  {
    name: "024_create_daemon_activity_log",
    up: `
      CREATE TABLE IF NOT EXISTS daemon_activity_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daemon_id UUID NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN (
          'conversation_turn', 'conversation_summary', 'manifest_amendment',
          'manifest_recompile', 'behavior_event', 'inter_daemon_event',
          'budget_warning', 'inference_failure'
        )),
        timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
        actors JSONB NOT NULL DEFAULT '[]',
        tokens_in INTEGER,
        tokens_out INTEGER,
        model_used TEXT,
        inference_latency_ms INTEGER,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_daemon_activity_log_daemon
        ON daemon_activity_log(daemon_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_activity_log_daemon_type
        ON daemon_activity_log(daemon_id, type);
      CREATE INDEX IF NOT EXISTS idx_daemon_activity_log_timestamp
        ON daemon_activity_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_daemon_activity_log_daemon_timestamp
        ON daemon_activity_log(daemon_id, timestamp);
    `,
  },
  {
    name: "025_create_daemon_creation_drafts",
    up: `
      CREATE TABLE IF NOT EXISTS daemon_creation_drafts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        admin_id UUID NOT NULL REFERENCES users(id),
        character_upload_id UUID,
        emote_upload_ids UUID[] NOT NULL DEFAULT '{}',
        admin_prompt TEXT,
        expanded_fields JSONB,
        expansion_status TEXT NOT NULL DEFAULT 'none'
          CHECK (expansion_status IN ('none', 'processing', 'ready', 'failed')),
        max_conversation_turns INTEGER NOT NULL DEFAULT 10,
        max_daily_calls INTEGER NOT NULL DEFAULT 200,
        daily_budget_resets_at TEXT NOT NULL DEFAULT '00:00',
        remember_visitors BOOLEAN NOT NULL DEFAULT true,
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN ('draft', 'finalized', 'abandoned')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_daemon_creation_drafts_admin
        ON daemon_creation_drafts(admin_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_creation_drafts_status
        ON daemon_creation_drafts(status);
    `,
  },
  {
    name: "026_create_daemon_asset_uploads",
    up: `
      CREATE TABLE IF NOT EXISTS daemon_asset_uploads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daemon_id UUID REFERENCES daemons(id) ON DELETE SET NULL,
        upload_type TEXT NOT NULL CHECK (upload_type IN ('character', 'emote')),
        fbx_filename TEXT NOT NULL,
        label TEXT,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        conversion_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (conversion_status IN ('pending', 'processing', 'ready', 'failed')),
        gltf_asset_id TEXT,
        validation_errors JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_daemon_asset_uploads_daemon
        ON daemon_asset_uploads(daemon_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_asset_uploads_conversion_status
        ON daemon_asset_uploads(conversion_status);
    `,
  },
  {
    name: "027_create_daemon_placements",
    up: `
      CREATE TABLE IF NOT EXISTS daemon_placements (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daemon_id UUID NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
        plot_uuid UUID NOT NULL REFERENCES plots(uuid) ON DELETE CASCADE,
        spawn_x FLOAT NOT NULL DEFAULT 0,
        spawn_y FLOAT NOT NULL DEFAULT 0,
        spawn_z FLOAT NOT NULL DEFAULT 0,
        facing_direction FLOAT NOT NULL DEFAULT 0,
        roam_radius FLOAT NOT NULL DEFAULT 5,
        interaction_range FLOAT NOT NULL DEFAULT 10,
        active BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daemon_placements_daemon
        ON daemon_placements(daemon_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_placements_plot
        ON daemon_placements(plot_uuid);
      CREATE INDEX IF NOT EXISTS idx_daemon_placements_active
        ON daemon_placements(active);
    `,
  },
  {
    name: "028_create_daemon_visitor_impressions",
    up: `
      CREATE TABLE IF NOT EXISTS daemon_visitor_impressions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daemon_id UUID NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        visit_count INTEGER NOT NULL DEFAULT 1,
        last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
        impression TEXT NOT NULL DEFAULT '',
        relationship_valence TEXT NOT NULL DEFAULT 'neutral'
          CHECK (relationship_valence IN ('hostile', 'neutral', 'warm', 'trusted')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daemon_visitor_impressions_unique
        ON daemon_visitor_impressions(daemon_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_visitor_impressions_daemon
        ON daemon_visitor_impressions(daemon_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_visitor_impressions_last_seen
        ON daemon_visitor_impressions(daemon_id, last_seen);
    `,
  },
  {
    name: "029_create_daemon_relationships",
    up: `
      CREATE TABLE IF NOT EXISTS daemon_relationships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        daemon_id UUID NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
        target_daemon_id UUID NOT NULL REFERENCES daemons(id) ON DELETE CASCADE,
        target_daemon_name TEXT NOT NULL,
        interaction_count INTEGER NOT NULL DEFAULT 0,
        last_interaction TIMESTAMPTZ NOT NULL DEFAULT now(),
        relationship TEXT NOT NULL DEFAULT '',
        relational_valence TEXT NOT NULL DEFAULT 'neutral'
          CHECK (relational_valence IN ('rival', 'neutral', 'allied', 'subordinate', 'dominant')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_daemon_relationships_unique
        ON daemon_relationships(daemon_id, target_daemon_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_relationships_daemon
        ON daemon_relationships(daemon_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_relationships_target
        ON daemon_relationships(target_daemon_id);
    `,
  },
  {
    name: "030_create_daemon_activity_log_archive",
    up: `
      CREATE TABLE IF NOT EXISTS daemon_activity_log_archive (
        LIKE daemon_activity_log INCLUDING ALL
      );
      CREATE INDEX IF NOT EXISTS idx_daemon_activity_log_archive_daemon
        ON daemon_activity_log_archive(daemon_id);
      CREATE INDEX IF NOT EXISTS idx_daemon_activity_log_archive_timestamp
        ON daemon_activity_log_archive(timestamp);
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
