const MESHY_API_URL = process.env.MESHY_API_URL || "https://api.meshy.ai";

export interface MeshyTaskStatus {
  taskId: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  progress: number;
  glbUrl?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface RiggingTaskStatus {
  taskId: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  progress: number;
  riggedGlbUrl?: string;
  walkAnimUrl?: string;
  runAnimUrl?: string;
  error?: string;
}

export interface AnimationTaskStatus {
  taskId: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  progress: number;
  animationGlbUrl?: string;
  error?: string;
}

interface MeshyApiResponse {
  result: string;
  model_urls?: {
    glb?: string;
    fbx?: string;
    obj?: string;
    usdz?: string;
  };
  thumbnail_url?: string;
  status: "SUCCEEDED" | "FAILED" | "PENDING" | "IN_PROGRESS";
  task_id: string;
  progress: number;
}

function getApiKey(): string {
  const key = process.env.MESHY_API_KEY;
  if (!key) throw new Error("MESHY_API_KEY environment variable is required");
  return key;
}

async function meshyFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const apiKey = getApiKey();
  return fetch(`${MESHY_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

/** Start a Meshy preview task (fast, ~30-60s). Returns the task ID. */
export async function startMeshPreview(
  description: string,
  poseMode?: "t-pose" | "a-pose",
): Promise<string> {
  // Append pose instruction for rigging compatibility
  const poseSuffix = poseMode === "a-pose"
    ? " Standing in a relaxed A-pose with arms slightly away from the body."
    : poseMode === "t-pose"
      ? " Standing in a T-pose with arms straight out to the sides."
      : "";

  // Meshy enforces 800 char max; truncate at sentence boundary if needed
  let prompt = description;
  const maxLen = 780 - poseSuffix.length;
  if (prompt.length > maxLen) {
    prompt = prompt.slice(0, maxLen).replace(/\s+\S*$/, "") + ".";
  }
  prompt += poseSuffix;

  const body: Record<string, unknown> = {
    mode: "preview",
    prompt,
    ai_model: "meshy-6",
    target_polycount: 30000,
  };
  if (poseMode) {
    body.pose_mode = poseMode;
  }

  const res = await meshyFetch("/openapi/v2/text-to-3d", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meshy preview creation failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { result: string };
  return data.result;
}

/** Poll a Meshy task for its current status. Returns status + GLB URL when done. */
export async function pollMeshTask(taskId: string): Promise<MeshyTaskStatus> {
  const res = await meshyFetch(`/openapi/v2/text-to-3d/${taskId}`);
  if (!res.ok) {
    throw new Error(`Meshy poll failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as MeshyApiResponse;

  const result: MeshyTaskStatus = {
    taskId: data.task_id,
    status: data.status,
    progress: data.progress ?? 0,
  };

  if (data.status === "SUCCEEDED") {
    result.glbUrl = data.model_urls?.glb;
    result.thumbnailUrl = data.thumbnail_url;
  }

  if (data.status === "FAILED") {
    result.error = data.result;
  }

  return result;
}

/** Start a Meshy refine task from a completed preview. Returns the refine task ID. */
export async function startMeshRefine(previewTaskId: string): Promise<string> {
  const res = await meshyFetch("/openapi/v2/text-to-3d", {
    method: "POST",
    body: JSON.stringify({
      mode: "refine",
      preview_task_id: previewTaskId,
      target_polycount: 30000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meshy refine creation failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { result: string };
  return data.result;
}

/** Full synchronous generation: preview → refine → return GLB URL. */
export async function generateMesh(
  description: string
): Promise<{ glbUrl: string; taskId: string }> {
  const POLL_INTERVAL = 5000;
  const MAX_POLL_TIME = 120000;

  async function waitForTask(taskId: string): Promise<MeshyTaskStatus> {
    const start = Date.now();
    while (Date.now() - start < MAX_POLL_TIME) {
      const status = await pollMeshTask(taskId);
      if (status.status === "SUCCEEDED") return status;
      if (status.status === "FAILED") {
        throw new Error(`Meshy task failed: ${status.error}`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));
    }
    throw new Error("Meshy generation timed out");
  }

  // Stage 1: Preview
  const previewTaskId = await startMeshPreview(description);
  const previewResult = await waitForTask(previewTaskId);

  // Stage 2: Refine
  const refineRes = await meshyFetch("/openapi/v2/text-to-3d", {
    method: "POST",
    body: JSON.stringify({
      mode: "refine",
      preview_task_id: previewResult.taskId,
      target_polycount: 30000,
    }),
  });

  if (!refineRes.ok) {
    const err = await refineRes.text();
    throw new Error(`Meshy refine creation failed: ${refineRes.status} ${err}`);
  }

  const refineData = (await refineRes.json()) as { result: string };
  const refineResult = await waitForTask(refineData.result);

  const glbUrl = refineResult.glbUrl;
  if (!glbUrl) {
    throw new Error("Meshy did not return a GLB URL");
  }

  return { glbUrl, taskId: refineResult.taskId };
}

/** Start auto-rigging a completed mesh task. Returns the rig task ID. */
export async function startRigging(inputTaskId: string): Promise<string> {
  const res = await meshyFetch("/openapi/v1/rigging", {
    method: "POST",
    body: JSON.stringify({
      input_task_id: inputTaskId,
      height_meters: 1.8,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meshy rigging creation failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { result: string };
  return data.result;
}

/** Poll a rigging task for its current status. */
export async function pollRiggingTask(taskId: string): Promise<RiggingTaskStatus> {
  const res = await meshyFetch(`/openapi/v1/rigging/${taskId}`);
  if (!res.ok) {
    throw new Error(`Meshy rigging poll failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    id: string;
    status: RiggingTaskStatus["status"];
    progress?: number;
    result?: {
      rigged_character_glb_url?: string;
      basic_animations?: {
        walking_glb_url?: string;
        running_glb_url?: string;
      };
    };
    task_error?: { message?: string };
  };

  const result: RiggingTaskStatus = {
    taskId: data.id,
    status: data.status,
    progress: data.progress ?? 0,
  };

  if (data.status === "SUCCEEDED" && data.result) {
    result.riggedGlbUrl = data.result.rigged_character_glb_url;
    result.walkAnimUrl = data.result.basic_animations?.walking_glb_url;
    result.runAnimUrl = data.result.basic_animations?.running_glb_url;
  }

  if (data.status === "FAILED") {
    result.error = data.task_error?.message || "Rigging failed";
  }

  return result;
}

/** Start a custom animation on a rigged character. Returns the animation task ID. */
export async function startAnimation(rigTaskId: string, actionId: number): Promise<string> {
  const res = await meshyFetch("/openapi/v1/animations", {
    method: "POST",
    body: JSON.stringify({
      rig_task_id: rigTaskId,
      action_id: actionId,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Meshy animation creation failed: ${res.status} ${err}`);
  }

  const data = (await res.json()) as { result: string };
  return data.result;
}

/** Poll an animation task for its current status. */
export async function pollAnimationTask(taskId: string): Promise<AnimationTaskStatus> {
  const res = await meshyFetch(`/openapi/v1/animations/${taskId}`);
  if (!res.ok) {
    throw new Error(`Meshy animation poll failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    id: string;
    status: AnimationTaskStatus["status"];
    progress?: number;
    result?: { animation_glb_url?: string };
    task_error?: { message?: string };
  };

  const result: AnimationTaskStatus = {
    taskId: data.id,
    status: data.status,
    progress: data.progress ?? 0,
  };

  if (data.status === "SUCCEEDED" && data.result) {
    result.animationGlbUrl = data.result.animation_glb_url;
  }

  if (data.status === "FAILED") {
    result.error = data.task_error?.message || "Animation failed";
  }

  return result;
}
