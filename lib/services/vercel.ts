import { getPlainServiceToken } from '@/lib/services/tokens';
import { upsertProjectServiceConnection, updateProjectServiceData, getProjectService } from '@/lib/services/project-services';
import { getProjectById } from '@/lib/services/project';
import { listEnvVars } from '@/lib/services/env';
import { validateProjectExists, getProjectGitHubRepo } from '@/lib/services/service-integration';
import type {
  CheckResult,
  VercelProjectResponse,
  VercelDeploymentsResponse,
  VercelProjectServiceData,
  DeploymentStatusResponse,
} from '@/types/shared';

const RENDER_API_BASE = 'https://api.render.com/v1';

class VercelError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'VercelError';
  }
}

async function vercelFetch<T = any>(
  token: string,
  endpoint: string,
  {
    method = 'GET',
    body,
    query,
  }: {
    method?: string;
    body?: any;
    query?: Record<string, string | undefined>;
  } = {},
): Promise<T> {
  const url = new URL(`${RENDER_API_BASE}${endpoint}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  let resolvedBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    headers['Content-Type'] = 'application/json';
    resolvedBody = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: resolvedBody,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new VercelError(errorText || `Render API request failed (${response.status})`, response.status);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

function normalizeDeploymentUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `https://${url}`;
}

interface VercelDomainResponse {
  domains?: Array<{
    name: string;
    apexName?: string;
  }>;
}

async function fetchProductionDomain(
  token: string,
  projectIdOrName: string,
  teamId?: string | null,
): Promise<string | null> {
  try {
    const response = await vercelFetch<VercelDomainResponse>(
      token,
      `/v9/projects/${encodeURIComponent(projectIdOrName)}/domains`,
      {
        method: 'GET',
        teamId,
      },
    );

    const domains = Array.isArray(response?.domains) ? response.domains : [];
    const vercelDomain =
      domains.find((domain) => domain?.apexName === 'vercel.app') ||
      domains.find((domain) => typeof domain?.name === 'string' && domain.name.endsWith('.vercel.app'));

    return vercelDomain?.name ?? null;
  } catch (error) {
    if (error instanceof VercelError && error.status === 404) {
      return null;
    }
    console.warn('[Vercel] Failed to fetch project domains:', error);
    return null;
  }
}

function createEmptyDeploymentResponse(
  overrides: Partial<DeploymentStatusResponse> = {},
): DeploymentStatusResponse {
  return {
    has_deployment: false,
    status: null,
    deployment_id: null,
    deployment_url: null,
    last_deployment_url: null,
    production_domain: null,
    inspector_url: null,
    vercel_configured: true,
    ...overrides,
  };
}

/**
 * Internal function to fetch GitHub repository details
 * Avoids circular dependency with github.ts
 */
async function getGithubRepositoryDetailsInternal(
  vercelToken: string,
  owner: string,
  repo: string,
): Promise<{ id: number; name: string; default_branch: string }> {
  // Import dynamically to avoid circular dependency
  const { getGithubRepositoryDetails } = await import('@/lib/services/github');
  return getGithubRepositoryDetails(owner, repo);
}

export async function checkVercelProjectAvailability(
  projectName: string,
  options?: { teamId?: string | null },
): Promise<CheckResult> {
  const token = await getPlainServiceToken('vercel');
  if (!token) {
    throw new VercelError('Vercel token not configured', 401);
  }

  // Render service names are per account; assume available to keep UX smooth.
  return { available: true };
}

async function fetchExistingProject(
  token: string,
  projectName: string,
  teamId?: string | null,
): Promise<VercelProjectResponse | null> {
  try {
    const project = await vercelFetch<VercelProjectResponse>(
      token,
      `/v9/projects/${encodeURIComponent(projectName)}`,
      {
        method: 'GET',
        teamId,
      },
    );
    return project;
  } catch (error) {
    if (error instanceof VercelError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function connectVercelProject(
  projectId: string,
  projectName: string,
  options?: { githubRepo?: string | null; teamId?: string | null },
) {
  const token = await getPlainServiceToken('vercel');
  if (!token) {
    throw new VercelError('Vercel token not configured', 401);
  }

  const project = await getProjectById(projectId);
  if (!project) {
    throw new VercelError('Project not found', 404);
  }

  const githubRepoInfo = await getProjectGitHubRepo(projectId);
  if (!githubRepoInfo) {
    throw new VercelError('GitHub repository not connected', 400);
  }

  const githubService = await getProjectService(projectId, 'github');
  const githubData = githubService?.serviceData as Record<string, any> | undefined;
  const branch =
    typeof githubData?.preview_branch === 'string' && githubData.preview_branch.length > 0
      ? githubData.preview_branch
      : typeof githubData?.default_branch === 'string' && githubData.default_branch.length > 0
      ? githubData.default_branch
      : 'main';

  const repoUrl = `https://github.com/${githubRepoInfo.owner}/${githubRepoInfo.repoName}`;
  const ownerId = process.env.RENDER_OWNER || undefined;
  const buildCommand = process.env.RENDER_BUILD_COMMAND || 'npm install && npm run build';
  const publishPath = process.env.RENDER_PUBLISH_PATH || 'out';
  const rootDir = process.env.RENDER_ROOT_DIR || '';

  const payload: Record<string, unknown> = {
    name: projectName,
    ownerId,
    serviceDetails: {
      type: 'static_site',
      repo: repoUrl,
      branch,
      buildCommand,
      publishPath,
      rootDir,
    },
  };

  const service = await vercelFetch<any>(token, '/services', {
    method: 'POST',
    body: payload,
  });

  const publishUrl =
    service?.serviceDetails?.staticSite?.publishUrl ||
    service?.serviceDetails?.staticSite?.url ||
    service?.serviceDetails?.url ||
    null;

  const serviceData: VercelProjectServiceData = {
    project_id: service?.id ?? null,
    project_name: service?.name ?? projectName,
    project_url: service?.dashboardUrl ?? null,
    github_repo: `${githubRepoInfo.owner}/${githubRepoInfo.repoName}`,
    team_id: ownerId ?? null,
    production_domain: publishUrl ?? null,
    connected_at: new Date().toISOString(),
    last_deployment_id: null,
    last_deployment_status: null,
    last_deployment_url: publishUrl ? normalizeDeploymentUrl(publishUrl) : null,
    last_deployment_at: null,
  };

  await upsertProjectServiceConnection(projectId, 'vercel', serviceData as Record<string, unknown>);
  return serviceData;
}

export async function triggerVercelDeployment(projectId: string) {
  const token = await getPlainServiceToken('vercel');
  if (!token) {
    throw new VercelError('Vercel token not configured', 401);
  }

  const service = await getProjectService(projectId, 'vercel');
  if (!service) {
    throw new VercelError('Vercel project not connected', 404);
  }

  const data = (service.serviceData ?? {}) as VercelProjectServiceData;
  if (!data.project_id) {
    throw new VercelError('Vercel project ID missing', 400);
  }

  const deployment = await vercelFetch<any>(
    token,
    `/services/${data.project_id}/deploys`,
    {
      method: 'POST',
      body: { clearCache: true },
    },
  );

  const deploymentUrl = normalizeDeploymentUrl(data.production_domain ?? data.last_deployment_url);
  const readyState = deployment?.status ?? 'QUEUED';

  await updateProjectServiceData(projectId, 'vercel', {
    last_deployment_id: deployment?.id ?? null,
    last_deployment_status: readyState,
    last_deployment_url: deploymentUrl,
    production_domain: data.production_domain ?? deploymentUrl,
    last_deployment_at: deployment?.createdAt
      ? new Date(deployment.createdAt).toISOString()
      : new Date().toISOString(),
  });

  return {
    success: true,
    deploymentId: deployment?.id ?? null,
    deploymentUrl,
    status: readyState,
    productionDomain: data.production_domain ?? deploymentUrl,
  };
}

export async function getCurrentDeploymentStatus(projectId: string) {
  const token = await getPlainServiceToken('vercel');
  if (!token) {
    return createEmptyDeploymentResponse({
      status: 'not_configured',
      vercel_configured: false,
    });
  }

  const service = await getProjectService(projectId, 'vercel');
  if (!service || !service.serviceData) {
    return createEmptyDeploymentResponse({ vercel_configured: false });
  }

  const data = service.serviceData as VercelProjectServiceData;
  if (!data.project_id) {
    return createEmptyDeploymentResponse({ vercel_configured: false });
  }

  const preferredDomain = data.production_domain || null;

  const deployments = await vercelFetch<any>(
    token,
    `/services/${data.project_id}/deploys`,
    {
      method: 'GET',
      query: { limit: '1' },
    },
  );

  const latest =
    (Array.isArray(deployments?.deploys) && deployments.deploys[0]) ||
    (Array.isArray(deployments) && deployments[0]) ||
    null;

  const status = latest?.status ?? data.last_deployment_status ?? null;
  const deploymentId = latest?.id ?? data.last_deployment_id ?? null;
  const deploymentUrl = normalizeDeploymentUrl(
    preferredDomain ||
      latest?.publishUrl ||
      latest?.url ||
      data.last_deployment_url,
  );
  const isActive =
    typeof status === 'string' &&
    ['queued', 'building', 'in_progress', 'deploying'].includes(status.toLowerCase());

  await updateProjectServiceData(projectId, 'vercel', {
    last_deployment_id: deploymentId,
    last_deployment_status: status,
    last_deployment_url: deploymentUrl,
    production_domain: preferredDomain ?? data.production_domain ?? null,
    last_deployment_at: latest?.createdAt
      ? new Date(latest.createdAt).toISOString()
      : data.last_deployment_at ?? new Date().toISOString(),
  });

  return {
    has_deployment: Boolean(isActive && deploymentId),
    status: status ?? null,
    last_deployment_url: deploymentUrl ?? null,
    deployment_id: deploymentId ?? null,
    inspector_url: null,
    deployment_url: deploymentUrl ?? null,
    production_domain: preferredDomain ?? null,
    vercel_configured: true,
  };
}
