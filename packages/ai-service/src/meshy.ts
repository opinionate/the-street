const MESHY_API_URL = process.env.MESHY_API_URL || "https://api.meshy.ai";

export interface MeshyTaskStatus {
  taskId: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";
  progress: number;
  glbUrl?: string;
  thumbnailUrl?: string;
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
export async function startMeshPreview(description: string): Promise<string> {
  const res = await meshyFetch("/openapi/v2/text-to-3d", {
    method: "POST",
    body: JSON.stringify({
      mode: "preview",
      prompt: description,
      ai_model: "meshy-6",
      target_polycount: 30000,
    }),
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
