const MESHY_API_URL = process.env.MESHY_API_URL || "https://api.meshy.ai";
const POLL_INTERVAL = 5000; // 5 seconds
const MAX_POLL_TIME = 120000; // 2 minutes

interface MeshyTaskResponse {
  result: string;
  model_urls?: {
    glb?: string;
  };
  status: "SUCCEEDED" | "FAILED" | "PENDING" | "IN_PROGRESS";
  task_id: string;
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

async function pollTask(taskId: string): Promise<MeshyTaskResponse> {
  const start = Date.now();

  while (Date.now() - start < MAX_POLL_TIME) {
    const res = await meshyFetch(`/openapi/v2/text-to-3d/${taskId}`);
    if (!res.ok) {
      throw new Error(`Meshy poll failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as MeshyTaskResponse;

    if (data.status === "SUCCEEDED") return data;
    if (data.status === "FAILED") {
      throw new Error(`Meshy task failed: ${data.result}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }

  throw new Error("Meshy generation timed out");
}

export async function generateMesh(
  description: string
): Promise<{ glbUrl: string; taskId: string }> {
  // Stage 1: Create preview task
  const previewRes = await meshyFetch("/openapi/v2/text-to-3d", {
    method: "POST",
    body: JSON.stringify({
      mode: "preview",
      prompt: description,
      ai_model: "meshy-4",
      enable_pbr: true,
      target_polycount: 30000,
    }),
  });

  if (!previewRes.ok) {
    const err = await previewRes.text();
    throw new Error(`Meshy preview creation failed: ${previewRes.status} ${err}`);
  }

  const previewData = (await previewRes.json()) as { result: string };
  const previewTaskId = previewData.result;

  // Poll preview to completion
  const previewResult = await pollTask(previewTaskId);

  // Stage 2: Create refine task
  const refineRes = await meshyFetch("/openapi/v2/text-to-3d", {
    method: "POST",
    body: JSON.stringify({
      mode: "refine",
      preview_task_id: previewResult.task_id,
      enable_pbr: true,
      target_polycount: 30000,
    }),
  });

  if (!refineRes.ok) {
    const err = await refineRes.text();
    throw new Error(`Meshy refine creation failed: ${refineRes.status} ${err}`);
  }

  const refineData = (await refineRes.json()) as { result: string };
  const refineTaskId = refineData.result;

  // Poll refine to completion
  const refineResult = await pollTask(refineTaskId);

  const glbUrl = refineResult.model_urls?.glb;
  if (!glbUrl) {
    throw new Error("Meshy did not return a GLB URL");
  }

  return { glbUrl, taskId: refineTaskId };
}
