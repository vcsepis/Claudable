/**
 * Project Service - Project management logic
 */

import { prisma } from '@/lib/db/client';
import type { Project, CreateProjectInput, UpdateProjectInput } from '@/types/backend';
import fs from 'fs/promises';
import path from 'path';
import { normalizeModelId, getDefaultModelForCli } from '@/lib/constants/cliModels';
import { ensureUserCredits } from '@/lib/services/credits';
import { pushProjectToGitHub } from '@/lib/services/github';

const PROJECTS_DIR = process.env.PROJECTS_DIR || './data/projects';
const PROJECTS_DIR_ABSOLUTE = path.isAbsolute(PROJECTS_DIR)
  ? PROJECTS_DIR
  : path.resolve(process.cwd(), PROJECTS_DIR);

/**
 * Retrieve all projects (optionally scoped to a user)
 */
export async function getAllProjects(userId?: string): Promise<Project[]> {
  const where = userId ? { userId } : undefined;
  const projects = await prisma.project.findMany({
    where,
    orderBy: {
      lastActiveAt: 'desc',
    },
  });
  return projects.map(project => ({
    ...project,
    selectedModel: normalizeModelId(project.preferredCli ?? 'claude', project.selectedModel ?? undefined),
  })) as Project[];
}

/**
 * Count projects belonging to a user
 */
export async function countProjectsByUser(userId: string): Promise<number> {
  return prisma.project.count({ where: { userId } });
}

/**
 * Retrieve project by ID
 */
export async function getProjectById(id: string): Promise<Project | null> {
  const project = await prisma.project.findUnique({
    where: { id },
  });
  if (!project) return null;
 return {
    ...project,
    selectedModel: normalizeModelId(project.preferredCli ?? 'claude', project.selectedModel ?? undefined),
  } as Project;
}

/**
 * Create new project
 */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  const maxRetries = 3;
  const baseId = input.project_id || `project-${Date.now()}`;
  let currentId = baseId;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const projectPath = path.join(PROJECTS_DIR_ABSOLUTE, currentId);
      const userCredits = await ensureUserCredits(input.userId || 'anonymous');
      await fs.mkdir(projectPath, { recursive: true });

      const project = await prisma.project.create({
        data: {
          id: currentId,
          name: input.name,
          userId: input.userId || 'anonymous',
          description: input.description,
          initialPrompt: input.initialPrompt,
          repoPath: projectPath,
          preferredCli: input.preferredCli || 'claude',
          selectedModel: normalizeModelId(
            input.preferredCli || 'claude',
            input.selectedModel ?? getDefaultModelForCli(input.preferredCli || 'claude')
          ),
          status: 'idle',
          templateType: 'nextjs',
          lastActiveAt: new Date(),
          previewUrl: null,
          previewPort: null,
          creditBalance: userCredits,
        },
      });

      console.log(`[ProjectService] Created project: ${project.id}`);
      const normalizedProject: Project = {
        ...project,
        selectedModel: normalizeModelId(project.preferredCli ?? 'claude', project.selectedModel ?? undefined),
      } as Project;

      // Ensure GitHub preview branch exists immediately after project creation
      try {
        await pushProjectToGitHub(normalizedProject.id);
      } catch (pushError: any) {
        console.warn(`[ProjectService] Auto-create GitHub branch failed for ${normalizedProject.id}:`, pushError?.message || pushError);
      }

      return normalizedProject;
    } catch (error: any) {
      lastError = error;

      // Duplicate ID collision (concurrent requests with same id)
      if (error?.code === 'P2002' && attempt < maxRetries) {
        const suffix = Math.random().toString(36).slice(2, 7);
        const newId = `${baseId}-${suffix}`;
        console.warn(
          `[ProjectService] Duplicate project id "${currentId}", retrying with "${newId}" (attempt ${
            attempt + 1
          }/${maxRetries})`
        );
        currentId = newId;
        continue;
      }

      // Connection issues
      if (error?.code === 'P1001' || error?.code === 'P1008') {
        throw new Error('Database connection unavailable or timed out. Please retry.');
      }

      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Failed to create project after retries');
}

/**
 * Update project
 */
export async function updateProject(
  id: string,
  input: UpdateProjectInput
): Promise<Project> {
  const existing = await prisma.project.findUnique({
    where: { id },
    select: { preferredCli: true },
  });
  const targetCli = input.preferredCli ?? existing?.preferredCli ?? 'claude';
  const normalizedModel = input.selectedModel
    ? normalizeModelId(targetCli, input.selectedModel)
    : undefined;

  // Prevent client-driven credit mutations
  const { creditBalance: _ignoredCreditBalance, ...safeInput } = input as Record<string, unknown>;

  const project = await prisma.project.update({
    where: { id },
    data: {
      ...(safeInput as UpdateProjectInput),
      ...(input.selectedModel
        ? { selectedModel: normalizedModel }
        : {}),
      updatedAt: new Date(),
    },
  });

  console.log(`[ProjectService] Updated project: ${id}`);
  return {
    ...project,
    selectedModel: normalizeModelId(project.preferredCli ?? 'claude', project.selectedModel ?? undefined),
  } as Project;
}

/**
 * Delete project
 */
export async function deleteProject(id: string): Promise<void> {
  // Delete project directory
  const project = await getProjectById(id);
  if (project?.repoPath) {
    try {
      await fs.rm(project.repoPath, { recursive: true, force: true });
    } catch (error) {
      console.warn(`[ProjectService] Failed to delete project directory:`, error);
    }
  }

  // Delete project from database (related data automatically deleted via Cascade)
  await prisma.project.delete({
    where: { id },
  });

  console.log(`[ProjectService] Deleted project: ${id}`);
}

/**
 * Update project activity time
 */
export async function updateProjectActivity(id: string): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: {
      lastActiveAt: new Date(),
    },
  });
}

/**
 * Update project status
 */
export async function updateProjectStatus(
  id: string,
  status: 'idle' | 'running' | 'stopped' | 'error'
): Promise<void> {
  await prisma.project.update({
    where: { id },
    data: {
      status,
      updatedAt: new Date(),
    },
  });
  console.log(`[ProjectService] Updated project status: ${id} -> ${status}`);
}

export interface ProjectCliPreference {
  preferredCli: string;
  fallbackEnabled: boolean;
  selectedModel: string | null;
}

export async function getProjectCliPreference(projectId: string): Promise<ProjectCliPreference | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      preferredCli: true,
      fallbackEnabled: true,
      selectedModel: true,
    },
  });

  if (!project) {
    return null;
  }

  return {
    preferredCli: project.preferredCli ?? 'claude',
    fallbackEnabled: project.fallbackEnabled ?? false,
    selectedModel: normalizeModelId(project.preferredCli ?? 'claude', project.selectedModel ?? undefined),
  };
}

export async function updateProjectCliPreference(
  projectId: string,
  input: Partial<ProjectCliPreference>
): Promise<ProjectCliPreference> {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
    select: { preferredCli: true },
  });
  const targetCli = input.preferredCli ?? existing?.preferredCli ?? 'claude';

  const result = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.preferredCli ? { preferredCli: input.preferredCli } : {}),
      ...(typeof input.fallbackEnabled === 'boolean'
        ? { fallbackEnabled: input.fallbackEnabled }
        : {}),
      ...(input.selectedModel
        ? { selectedModel: normalizeModelId(targetCli, input.selectedModel) }
        : input.selectedModel === null
        ? { selectedModel: null }
        : {}),
      updatedAt: new Date(),
    },
    select: {
      preferredCli: true,
      fallbackEnabled: true,
      selectedModel: true,
    },
  });

  return {
    preferredCli: result.preferredCli ?? 'claude',
    fallbackEnabled: result.fallbackEnabled ?? false,
    selectedModel: normalizeModelId(result.preferredCli ?? 'claude', result.selectedModel ?? undefined),
  };
}
