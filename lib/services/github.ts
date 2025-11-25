import path from 'path';
import fs from 'fs/promises';
import { getPlainServiceToken } from '@/lib/services/tokens';
import { getProjectById, updateProject } from '@/lib/services/project';
import { getProjectService, upsertProjectServiceConnection, updateProjectServiceData } from '@/lib/services/project-services';
import {
  ensureGitRepository,
  ensureGitConfig,
  initializeMainBranch,
  addOrUpdateRemote,
  commitAll,
  pushToRemote,
  checkoutOrCreateBranch,
  ensureInitialCommit,
} from '@/lib/services/git';
import type { GitHubUserInfo, CreateRepoOptions, GitHubRepositoryInfo } from '@/types/shared';

class GitHubError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GitHubError';
  }
}

async function githubFetch(token: string, endpoint: string, init?: RequestInit) {
  const baseUrl = 'https://api.github.com';
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'monmi-Next',
      ...init?.headers,
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const body: any = response.status === 204
    ? null
    : isJson
    ? await response.json().catch(() => null)
    : await response.text();

  if (!response.ok) {
    let message = 'GitHub API request failed';
    if (body) {
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object') {
        const errorMessage = (body as Record<string, unknown>).message;
        const errors = (body as Record<string, unknown>).errors;
        if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
          message = errorMessage;
        } else if (Array.isArray(errors) && errors.length > 0) {
          const aggregated = errors
            .map((err) => (err && typeof err === 'object' ? (err as Record<string, unknown>).message : null))
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .join(', ');
          if (aggregated) {
            message = aggregated;
          }
        } else {
          message = JSON.stringify(body);
        }
      }
    }
    throw new GitHubError(message, response.status);
  }

  return body;
}

export async function getGithubUser(): Promise<GitHubUserInfo> {
  const token = await getPlainServiceToken('github');
  if (!token) {
    throw new GitHubError('GitHub token not configured', 401);
  }

  const data = (await githubFetch(token, '/user')) as any;
  return {
    login: data.login,
    name: data.name,
    email: data.email,
  };
}

export async function checkRepositoryAvailability(repoName: string) {
  const token = await getPlainServiceToken('github');
  if (!token) {
    throw new GitHubError('GitHub token not configured', 401);
  }

  const user = await getGithubUser();
  try {
    await githubFetch(token, `/repos/${user.login}/${repoName}`);
    return { exists: true, username: user.login };
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) {
      return { exists: false, username: user.login };
    }
    throw error;
  }
}

export async function createRepository(options: CreateRepoOptions) {
  const token = await getPlainServiceToken('github');
  if (!token) {
    throw new GitHubError('GitHub token not configured', 401);
  }

  const payload = {
    name: options.repoName,
    description: options.description ?? '',
    private: options.private ?? false,
    auto_init: false,
  };

  try {
    const repo = await githubFetch(token, '/user/repos', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    return repo as any;
  } catch (error) {
    if (error instanceof GitHubError && error.status === 422) {
      throw new GitHubError(`Repository name "${options.repoName}" is unavailable or already exists.`, error.status);
    }
    throw error;
  }
}

function resolveProjectRepoPath(projectId: string, repoPath?: string | null) {
  if (repoPath) {
    return path.isAbsolute(repoPath) ? repoPath : path.resolve(process.cwd(), repoPath);
  }
  return path.resolve(process.cwd(), process.env.PROJECTS_DIR || './data/projects', projectId);
}

function sanitizeBranchName(source: string | null | undefined, fallback: string) {
  const base = (source ?? '').trim() || fallback;
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return cleaned || `project-${fallback}`;
}

function sanitizeRepoName(source: string | null | undefined, fallback: string) {
  const base = (source ?? '').trim() || fallback;
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || `project-${fallback}`;
}

function sanitizeVercelProjectName(source: string | null | undefined, fallback: string) {
  const base = (source ?? '').trim() || fallback;
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return cleaned || `project-${fallback}`;
}

export async function ensureProjectRepository(projectId: string, repoPath?: string | null) {
  const resolved = resolveProjectRepoPath(projectId, repoPath);
  await fs.mkdir(resolved, { recursive: true });
  return resolved;
}

export async function getGithubRepositoryDetails(owner: string, repo: string): Promise<GitHubRepositoryInfo> {
  const token = await getPlainServiceToken('github');
  if (!token) {
    throw new GitHubError('GitHub token not configured', 401);
  }

  try {
    const data = (await githubFetch(token, `/repos/${owner}/${repo}`)) as any;
    if (!data || typeof data.id !== 'number') {
      throw new GitHubError('GitHub repository not found', 404);
    }

    return {
      id: data.id,
      name: data.name,
      full_name: data.full_name,
      owner: {
        login: data.owner?.login ?? owner,
        id: typeof data.owner?.id === 'number' ? data.owner.id : null,
      },
      default_branch: data.default_branch,
    };
  } catch (error) {
    if (error instanceof GitHubError) {
      if (error.status === 404) {
        throw new GitHubError('GitHub repository not found', 404);
      }
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new GitHubError(`Failed to fetch repository metadata: ${message}`);
  }
}

export async function connectProjectToGitHub(projectId: string, options: CreateRepoOptions) {
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error('Project not found');
  }

  const token = await getPlainServiceToken('github');
  if (!token) {
    throw new GitHubError('GitHub token not configured', 401);
  }

  const user = await getGithubUser();
  const repo = await createRepository(options);

  const repoPath = await ensureProjectRepository(projectId, project.repoPath);
  ensureGitRepository(repoPath);
  const repoUrl = repo.html_url as string;
  const cloneUrl = repo.clone_url as string;
  const defaultBranch = repo.default_branch as string;

  await updateProject(projectId, { repoPath });

  const userName = user.name || user.login;
  const userEmail = user.email || `${user.login}@users.noreply.github.com`;

  ensureGitConfig(repoPath, userName, userEmail);
  initializeMainBranch(repoPath);

  const authenticatedUrl = cloneUrl.replace('https://', `https://${user.login}:${token}@`);
  addOrUpdateRemote(repoPath, 'origin', authenticatedUrl);
  commitAll(repoPath, 'Initial commit - connected to GitHub');

  await upsertProjectServiceConnection(projectId, 'github', {
    repo_url: repoUrl,
    repo_name: options.repoName,
    clone_url: cloneUrl,
    default_branch: defaultBranch,
    owner: user.login,
  });

  return {
    repo_url: repoUrl,
    clone_url: cloneUrl,
    default_branch: defaultBranch,
    owner: user.login,
  };
}

export async function pushProjectToGitHub(projectId: string) {
  try {
    const project = await getProjectById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const envToken = process.env.GITHUB_OAUTH_CLIENT_ID?.trim() || process.env.GITHUB_TOKEN?.trim() || null;
    const token = (await getPlainServiceToken('github')) ?? envToken;
    if (!token) {
      throw new GitHubError('GitHub token not configured', 401);
    }

    const service = await getProjectService(projectId, 'github');
    const data = service?.serviceData as Record<string, any> | undefined;

    const repoFromEnv = process.env.GITHUB_REPO?.trim();
    const ownerFromEnv = process.env.GITHUB_OWNER?.trim();
    const user = await getGithubUser();

    let cloneUrl: string | undefined = typeof data?.clone_url === 'string' ? data.clone_url : undefined;
    let owner: string | undefined = typeof data?.owner === 'string' ? data.owner : undefined;
    let defaultBranch: string | undefined =
      typeof data?.default_branch === 'string' && data.default_branch.trim().length > 0
        ? data.default_branch
        : 'main';
    let repoName: string | undefined =
      typeof data?.repo_name === 'string' && data.repo_name.trim().length > 0
        ? data.repo_name
        : undefined;

    // Always create/use a dedicated repo per project on the authenticated user's account
    const normalizedRepoName = sanitizeRepoName(repoName ?? project.name ?? projectId, projectId);
    owner = ownerFromEnv || owner || user.login;
    repoName = normalizedRepoName;

    cloneUrl = cloneUrl || `https://github.com/${owner}/${repoName}.git`;

    // Ensure repository exists (create if missing when using env fallback)
    try {
      if (owner && repoName) {
        await getGithubRepositoryDetails(owner, repoName);
      }
    } catch (repoCheckError) {
      if (repoCheckError instanceof GitHubError && repoCheckError.status === 404 && repoName) {
        const created = await createRepository({ repoName });
        cloneUrl = created?.clone_url ?? cloneUrl;
        owner = created?.owner?.login ?? owner ?? user.login;
        defaultBranch = created?.default_branch ?? defaultBranch ?? 'main';
      } else {
        throw repoCheckError;
      }
    }

    const repoPath = await ensureProjectRepository(projectId, project.repoPath);
    ensureGitRepository(repoPath);
    // Push to main branch for dedicated per-project repo
    const branchName = sanitizeBranchName(defaultBranch || 'main', projectId);
    const authenticatedUrl = String(cloneUrl).replace('https://', `https://${owner}:${token}@`);
    const userName = user.name || user.login;
    const userEmail = user.email || `${user.login}@users.noreply.github.com`;
    ensureGitConfig(repoPath, userName, userEmail);
    addOrUpdateRemote(repoPath, 'origin', authenticatedUrl);
    checkoutOrCreateBranch(repoPath, branchName);
    const committed = commitAll(repoPath, `Update from monmi (${branchName})`);
    if (!committed) {
      // Ensure branch exists remotely even if there are no new changes
      ensureInitialCommit(repoPath, 'chore: ensure main branch exists');
    }

    pushToRemote(repoPath, 'origin', branchName);

    await updateProjectServiceData(projectId, 'github', {
      last_pushed_at: new Date().toISOString(),
      last_pushed_branch: branchName,
      default_branch: defaultBranch,
      repo_name: repoName,
      owner,
      clone_url: cloneUrl,
    });

    // Auto-connect and deploy to Vercel (best-effort, non-blocking)
    await (async () => {
      try {
        // Skip if no Vercel token configured
        const vercelToken = await getPlainServiceToken('vercel');
        if (!vercelToken) {
          return;
        }
        if (!repoName || !owner) {
          return;
        }
        const { connectVercelProject, triggerVercelDeployment } = await import('@/lib/services/vercel');
        const vercelService = await getProjectService(projectId, 'vercel');
        const vercelProjectName = sanitizeVercelProjectName(repoName || project.name, projectId);
        if (!vercelService) {
          await connectVercelProject(projectId, vercelProjectName, {
            githubRepo: `${owner}/${repoName}`,
          });
        }
        await triggerVercelDeployment(projectId);
      } catch (deployError) {
        console.warn('[GitHubService] Auto deploy to Vercel skipped:', deployError);
      }
    })();
  } catch (error) {
    if (error instanceof GitHubError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new GitHubError(`Failed to push project to GitHub: ${message}`);
  }
}
