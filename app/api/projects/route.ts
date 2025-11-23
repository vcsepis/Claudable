/**
 * Projects API Routes
 * GET /api/projects - Get all projects
 * POST /api/projects - Create new project
 */

import { NextRequest } from 'next/server';
import { getAllProjects, createProject, countProjectsByUser } from '@/lib/services/project';
import type { CreateProjectInput } from '@/types/backend';
import { serializeProjects, serializeProject } from '@/lib/serializers/project';
import { getDefaultModelForCli, normalizeModelId } from '@/lib/constants/cliModels';
import { createSuccessResponse, createErrorResponse, handleApiError } from '@/lib/utils/api-response';

/**
 * GET /api/projects
 * Get all projects list
 */
export async function GET(request: NextRequest) {
  try {
    const userId =
      request.nextUrl.searchParams.get('user_id') ??
      request.nextUrl.searchParams.get('userId') ??
      request.headers.get('x-user-id') ??
      undefined;

    if (!userId) {
      return createErrorResponse('user_id is required to fetch projects', undefined, 400);
    }

    const [projects, total] = await Promise.all([
      getAllProjects(userId),
      countProjectsByUser(userId),
    ]);

    return createSuccessResponse({
      items: serializeProjects(projects),
      total,
    });
  } catch (error) {
    return handleApiError(error, 'API', 'Failed to fetch projects');
  }
}

/**
 * POST /api/projects
 * Create new project
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const preferredCli = String(body.preferredCli || body.preferred_cli || 'claude').toLowerCase();
    const requestedModel = body.selectedModel || body.selected_model;
    const userId = body.userId || body.user_id;

    const input: CreateProjectInput = {
      project_id: body.project_id,
      name: body.name,
      userId,
      initialPrompt: body.initialPrompt || body.initial_prompt || '',
      preferredCli,
      selectedModel: normalizeModelId(preferredCli, requestedModel ?? getDefaultModelForCli(preferredCli)),
      description: body.description,
    };

    // Validation
    if (!input.project_id || !input.name || !input.userId) {
      return createErrorResponse('project_id, name, and userId are required', undefined, 400);
    }

    const project = await createProject(input);
    return createSuccessResponse(serializeProject(project), 201);
  } catch (error) {
    return handleApiError(error, 'API', 'Failed to create project');
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
