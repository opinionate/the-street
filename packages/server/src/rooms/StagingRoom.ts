import colyseus from "colyseus";
const { Room } = colyseus;
type Client = InstanceType<typeof colyseus.Room>["clients"][number];
import { Schema, MapSchema, defineTypes } from "@colyseus/schema";
import { getPool } from "../database/pool.js";
import type { WorldObject } from "@the-street/shared";

export class StagingObjectSchema extends Schema {
  id: string = "";
  name: string = "";
  definition: string = ""; // JSON-serialized WorldObject
}
defineTypes(StagingObjectSchema, {
  id: "string",
  name: "string",
  definition: "string",
});

export class StagingRoomState extends Schema {
  objects = new MapSchema<StagingObjectSchema>();
}
defineTypes(StagingRoomState, {
  objects: { map: StagingObjectSchema },
});

export class StagingRoom extends Room<StagingRoomState> {
  private creatorId: string = "";

  override maxClients = 1; // only creator

  override onCreate(): void {
    this.setState(new StagingRoomState());

    this.onMessage("object_place", (client, data) =>
      this.handlePlace(client, data),
    );
    this.onMessage("object_remove", (client, data) =>
      this.handleRemove(client, data),
    );
    this.onMessage("object_update_state", (client, data) =>
      this.handleUpdateState(client, data),
    );
  }

  override async onAuth(
    _client: Client,
    options: { token: string; userId: string },
  ): Promise<{ userId: string }> {
    if (!options?.token || !options?.userId) {
      throw new Error("Authentication required");
    }
    return { userId: options.userId };
  }

  override async onJoin(
    _client: Client,
    _options?: unknown,
    auth?: { userId: string },
  ): Promise<void> {
    if (!auth) return;
    this.creatorId = auth.userId;

    // Load existing staging objects
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT id, name, object_definition FROM staging_objects WHERE creator_id = $1",
      [this.creatorId],
    );

    for (const row of rows) {
      const obj = new StagingObjectSchema();
      obj.id = row.id;
      obj.name = row.name;
      obj.definition = JSON.stringify(row.object_definition);
      this.state.objects.set(row.id, obj);
    }
  }

  private async handlePlace(
    _client: Client,
    data: { objectDefinition: WorldObject },
  ): Promise<void> {
    const pool = getPool();
    const obj = data.objectDefinition;

    const result = await pool.query(
      `INSERT INTO staging_objects
        (creator_id, name, description, tags, object_definition, render_cost,
         origin_x, origin_y, origin_z,
         scale_x, scale_y, scale_z,
         rotation_x, rotation_y, rotation_z, rotation_w, asset_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        this.creatorId,
        obj.name,
        obj.description,
        obj.tags,
        JSON.stringify(obj),
        obj.renderCost,
        obj.origin.x,
        obj.origin.y,
        obj.origin.z,
        obj.scale.x,
        obj.scale.y,
        obj.scale.z,
        obj.rotation.x,
        obj.rotation.y,
        obj.rotation.z,
        obj.rotation.w,
        obj.meshDefinition.type === "novel"
          ? obj.meshDefinition.assetHash
          : null,
      ],
    );

    const schema = new StagingObjectSchema();
    schema.id = result.rows[0].id;
    schema.name = obj.name;
    schema.definition = JSON.stringify(obj);
    this.state.objects.set(schema.id, schema);
  }

  private async handleRemove(
    _client: Client,
    data: { objectId: string },
  ): Promise<void> {
    await getPool().query(
      "DELETE FROM staging_objects WHERE id = $1 AND creator_id = $2",
      [data.objectId, this.creatorId],
    );
    this.state.objects.delete(data.objectId);
  }

  private async handleUpdateState(
    _client: Client,
    data: { objectId: string; stateKey: string; stateValue: unknown },
  ): Promise<void> {
    if (!/^[a-zA-Z0-9_]+$/.test(data.stateKey)) return;

    await getPool().query(
      `UPDATE staging_objects
       SET state_data = jsonb_set(state_data, $2::text[], $3::jsonb), modified_at = now()
       WHERE id = $1 AND creator_id = $4`,
      [
        data.objectId,
        [data.stateKey],
        JSON.stringify(data.stateValue),
        this.creatorId,
      ],
    );
  }
}
