/**
 * POST /api/projects/[id]/preview/start
 * Launches the development server for a project and returns the preview URL.
 */

import { NextResponse } from 'next/server';
import { previewManager } from '@/lib/services/preview';
import { getProjectById } from '@/lib/services/project';
import { costForCategory } from '@/lib/services/credits';
import { deductUserCredits } from '@/lib/services/credits';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

export async function POST(
  _request: Request,
  { params }: RouteContext
) {
  try {
    const { project_id } = await params;
    const project = await getProjectById(project_id);
    if (!project) {
      return NextResponse.json(
        { success: false, error: 'Project not found' },
        { status: 404 }
      );
    }

    const skipCredits =
      process.env.DISABLE_PREVIEW_CREDITS === '1' ||
      process.env.SKIP_PREVIEW_CREDITS === '1' ||
      process.env.NODE_ENV !== 'production';

    if (!skipCredits) {
      // Deduct small preview credit charge (preview category, medium complexity)
      const previewCost = costForCategory('preview', 'medium');
      try {
        await deductUserCredits(
          project.userId,
          previewCost,
          'preview:start',
          project_id,
          { preview: true }
        );
      } catch (creditError) {
        const message =
          creditError instanceof Error ? creditError.message : 'Failed to deduct credits';
        const status = message.toLowerCase().includes('insufficient') ? 402 : 400;
        return NextResponse.json({ success: false, error: message }, { status });
      }
    } else {
      console.log(`[API] Skipping preview credit deduction for project ${project_id}`);
    }

    const preview = await previewManager.start(project_id);

    return NextResponse.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    console.error('[API] Failed to start preview:', error);
    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to start preview',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
