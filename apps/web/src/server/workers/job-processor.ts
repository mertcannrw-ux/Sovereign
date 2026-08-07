/**
 * Background job processor.
 *
 * Runs outside the web request/response cycle — typically invoked by a
 * scheduler (e.g. cron, queue consumer) or called directly from a mutation.
 *
 * GENERATED CODE NEVER RUNS IN THE NEXT.JS PROCESS.
 * The job processor only orchestrates provider calls, validation, and
 * snapshot persistence.  Generated files, preview builds, function
 * execution, and agent runs all happen in isolated E2B sandboxes or
 * dedicated worker runtimes.
 */

import { getDb } from '@/lib/db';

// ─── Types ────────────────────────────────────────────────

interface ChatGenerationPayload {
  projectId: string;
  provider: string;
  model: string;
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
  apiKey: string;
  baseUrl?: string;
}

interface DeploymentPayload {
  projectId: string;
  snapshotId: string;
}

// ─── Phase helpers ────────────────────────────────────────

/**
 * Update the job's result with a progress phase.
 * The SSE streaming endpoint polls for these phases and emits
 * named events to the client.
 */
async function setPhase(jobId: string, phase: string): Promise<void> {
  await getDb().backgroundJob.update({
    where: { id: jobId },
    data: { result: { phase } },
  });
}

// ─── Processor ────────────────────────────────────────────

/**
 * Process a background job by type.
 *
 * @param jobId - The BackgroundJob record id to process.
 */
export async function processJob(jobId: string): Promise<void> {
  try {
    // ── 1. Claim the job (atomically transition QUEUED → RUNNING) ──
    const job = await getDb().backgroundJob.update({
      where: { id: jobId, status: 'QUEUED' },
      data: {
        status: 'RUNNING',
        attempts: { increment: 1 },
        lockedAt: new Date(),
      },
    });

    // ── 2. Dispatch by type ──────────────────────────────────────
    switch (job.type) {
      case 'chat_generation':
        await processChatGeneration(jobId, job.payload as unknown as ChatGenerationPayload);
        break;

      case 'deployment':
        await processDeployment(jobId, job.payload as unknown as DeploymentPayload);
        break;

      default:
        // Unknown job type — fail immediately.
        await getDb().backgroundJob.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            lastErrorCode: 'UNSUPPORTED_JOB_TYPE',
            result: { error: `Unsupported job type: ${job.type}` },
          },
        });
        return;
    }

    // ── 3. Mark succeeded ────────────────────────────────────────
    await getDb().backgroundJob.update({
      where: { id: jobId },
      data: { status: 'SUCCEEDED' },
    });
  } catch (error: unknown) {
    // ── 4. Catch-all: mark failed with error details ─────────────
    const errorCode = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';

    try {
      await getDb().backgroundJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          lastErrorCode: errorCode,
          result: { error: errorMessage },
        },
      });
    } catch (updateError: unknown) {
      // Logging surface — the original error is the primary failure.
      console.error(
        `[job-processor] Failed to update job ${jobId} after processing error:`,
        updateError,
      );
    }

    // Re-throw so the caller (scheduler / queue) can apply its own
    // retry and dead-letter logic.
    throw error;
  }
}

// ─── Chat generation ──────────────────────────────────────

async function processChatGeneration(
  jobId: string,
  _payload: ChatGenerationPayload,
): Promise<void> {
  await setPhase(jobId, 'generating');

  // TODO: Call the AI provider.
  // const provider = getProvider(payload.provider);
  // const result = await provider.complete({
  //   model: payload.model,
  //   messages: payload.messages,
  //   apiKey: payload.apiKey,
  // });
  // Placeholder — provider call simulated.
  const responseContent = '# Placeholder AI response';
  const tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  await setPhase(jobId, 'validating');

  // TODO: Validate the generated output.
  // const diagnostics = validateGeneration(responseContent);

  await setPhase(jobId, 'building');

  // TODO: Apply validated changes as a new snapshot.
  // const fileChanges = parseFileDiffsFromResponse(responseContent);
  // if (fileChanges.length > 0) {
  //   await createVersion(payload.projectId, null, fileChanges);
  // }

  // Store the result.
  await getDb().backgroundJob.update({
    where: { id: jobId },
    data: {
      result: {
        phase: 'complete',
        response: responseContent,
        tokenUsage,
      },
    },
  });
}

// ─── Deployment ───────────────────────────────────────────

async function processDeployment(jobId: string, _payload: DeploymentPayload): Promise<void> {
  await setPhase(jobId, 'building');

  // TODO: Implement deployment pipeline.
  // 1. Validate snapshot exists.
  // 2. Run build in E2B sandbox.
  // 3. Upload to Vercel via scoped credentials.
  // 4. Record Vercel project / deployment IDs.

  await getDb().backgroundJob.update({
    where: { id: jobId },
    data: {
      result: {
        phase: 'complete',
        status: 'deployed',
        // url: deploymentUrl,
      },
    },
  });
}
