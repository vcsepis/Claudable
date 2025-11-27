import { getPlainServiceToken } from '@/lib/services/tokens';
import { upsertProjectServiceConnection, updateProjectServiceData, getProjectService } from '@/lib/services/project-services';
import { getProjectById } from '@/lib/services/project';
import { validateProjectExists, getProjectGitHubRepo } from '@/lib/services/service-integration';
import type {
  CheckResult,
  VercelProjectResponse,
  VercelDeploymentsResponse,
  VercelProjectServiceData,
  DeploymentStatusResponse,
} from '@/types/shared';

const RAILWAY_GQL = 'https://backboard.railway.app/graphql/v2';

class VercelError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'VercelError';
  }
}

async function vercelFetch<T = any>(
  token: string,
  path: string,
  options?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: any; teamId?: string | null }
): Promise<T> {
  const url = new URL(`https://api.vercel.com${path}`);
  if (options?.teamId) {
    url.searchParams.set('teamId', options.teamId);
  }

  const response = await fetch(url.toString(), {
    method: options?.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new VercelError(text || `Vercel API request failed (${response.status})`, response.status);
  }

  if (!response.ok) {
    const msg = json?.error?.message || json?.message || text;
    throw new VercelError(msg || `Vercel API request failed (${response.status})`, response.status);
  }

  return json as T;
}

async function railwayFetch<T = any>(token: string, query: string, variables?: Record<string, any>): Promise<T> {
  const response = await fetch(RAILWAY_GQL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await response.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new VercelError(text || `Railway API request failed (${response.status})`, response.status);
  }

  if (!response.ok || json.errors) {
    const msg = json?.errors?.map((e: any) => e?.message).join('; ') || JSON.stringify(json);
    throw new VercelError(msg || `Railway API request failed (${response.status})`, response.status);
  }

  return json.data as T;
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
    throw new VercelError('Railway token not configured', 401);
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

  const repoSlug = `${githubRepoInfo.owner}/${githubRepoInfo.repoName}`;
  const workspaceId = process.env.RAILWAY_WORKSPACE_ID || undefined;
  const railwayProjectId =
    process.env.RAILWAY_PROJECT_ID ||
    (await (async () => {
      const projectCreateMutation = `
        mutation ProjectCreate($name: String!, $workspaceId: String) {
          projectCreate(name: $name, workspaceId: $workspaceId) {
            id
            name
          }
        }
      `;
      const projectResp = await railwayFetch<{ projectCreate: any }>(token, projectCreateMutation, {
        name: projectName,
        workspaceId: workspaceId || null,
      });
      return projectResp?.projectCreate?.id ?? null;
    })());

  if (!railwayProjectId) {
    throw new VercelError('Failed to create or resolve Railway project', 500);
  }

  // Step 2: create service from GitHub repo/branch
  const serviceCreateMutation = `
    mutation CreateService($input: ServiceCreateInput!) {
      serviceCreate(input: $input) {
        id
        name
        url
        domains { name }
        project { id name }
      }
    }
  `;

  const input: Record<string, any> = {
    projectId: railwayProjectId,
    name: projectName,
    source: {
      repo: repoSlug,
      branch,
    },
  };

  const serviceResp = await railwayFetch<{ serviceCreate: any }>(token, serviceCreateMutation, {
    input,
  });

  const service = serviceResp?.serviceCreate;
  const serviceId = service?.id ?? null;
  if (!serviceId) {
    throw new VercelError('Failed to create Railway service (missing id)', 500);
  }

  const publishUrl =
    service?.domains?.[0]?.name ||
    service?.url ||
    null;

  const serviceData: VercelProjectServiceData = {
    project_id: serviceId,
    project_name: service?.name ?? projectName,
    project_url: service?.url ?? null,
    github_repo: `${githubRepoInfo.owner}/${githubRepoInfo.repoName}`,
    team_id: null,
    production_domain: publishUrl ? (publishUrl.startsWith('http') ? publishUrl : `https://${publishUrl}`) : null,
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
    throw new VercelError('Railway token not configured', 401);
  }

  const service = await getProjectService(projectId, 'vercel');
  if (!service) {
    throw new VercelError('Railway service not connected', 404);
  }

  const data = (service.serviceData ?? {}) as VercelProjectServiceData;
  if (!data.project_id) {
    throw new VercelError('Railway service ID missing', 400);
  }

  // Railway auto-deploys on push; explicitly request a new deployment if supported
  const deployMutation = `
    mutation TriggerDeploy($serviceId: String!) {
      deploymentCreate(input: { serviceId: $serviceId }) {
        id
        status
        url
      }
    }
  `;

  const deployResp = await railwayFetch<{ deploymentCreate: any }>(token, deployMutation, {
    serviceId: data.project_id,
  });

  const deployment = deployResp?.deploymentCreate ?? null;

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

  const statusQuery = `
    query ServiceStatus($id: String!) {
      service(id: $id) {
        id
        name
        url
        domains { name }
        deployments(first: 1) {
          edges {
            node {
              id
              status
              url
              updatedAt
            }
          }
        }
      }
    }
  `;

  const resp = await railwayFetch<any>(token, statusQuery, { id: data.project_id });
  const serviceData = resp?.service;
  const latest = serviceData?.deployments?.edges?.[0]?.node ?? null;
  const status = latest?.status ?? data.last_deployment_status ?? null;
  const deploymentId = latest?.id ?? data.last_deployment_id ?? null;
  const serviceUrl = serviceData?.url || serviceData?.domains?.[0]?.name || null;
  const deploymentUrl = normalizeDeploymentUrl(
    preferredDomain ||
      serviceUrl ||
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
    production_domain: preferredDomain || (serviceUrl ? normalizeDeploymentUrl(serviceUrl) : null),
    last_deployment_at: latest?.updatedAt
      ? new Date(latest.updatedAt).toISOString()
      : data.last_deployment_at ?? new Date().toISOString(),
  });

  return {
    has_deployment: Boolean(isActive && deploymentId),
    status: status ?? null,
    last_deployment_url: deploymentUrl ?? null,
    deployment_id: deploymentId ?? null,
    inspector_url: null,
    deployment_url: deploymentUrl ?? null,
    production_domain: preferredDomain || (serviceUrl ? normalizeDeploymentUrl(serviceUrl) : null),
    vercel_configured: true,
  };
}
