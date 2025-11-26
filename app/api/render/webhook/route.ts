import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/client';
import { updateProjectServiceData } from '@/lib/services/project-services';

/**
 * Render Webhook receiver
 * Configure Render to POST deployment events here.
 */
export async function POST(request: Request) {
  let payload: any = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  // Extract identifiers Render commonly sends
  const serviceId =
    payload?.service?.id ||
    payload?.service_id ||
    payload?.id ||
    null;
  const deploy = payload?.deploy || payload?.deployment || payload || null;

  if (!serviceId) {
    return NextResponse.json({ success: false, error: 'Missing service id' }, { status: 400 });
  }

  try {
    // Find the project connection that matches this Render service
    const connections = await prisma.projectServiceConnection.findMany({
      where: { provider: 'vercel' },
    });

    const match = connections.find((c) => {
      try {
        const data = JSON.parse(c.serviceData || '{}');
        return data?.project_id === serviceId;
      } catch {
        return false;
      }
    });

    if (!match) {
      return NextResponse.json({ success: false, error: 'Service not mapped to any project' }, { status: 404 });
    }

    const projectId = match.projectId;
    const serviceData = (() => {
      try {
        return JSON.parse(match.serviceData || '{}');
      } catch {
        return {};
      }
    })();

    // Update deployment info from webhook
    const status = deploy?.status ?? payload?.status ?? null;
    const deploymentId = deploy?.id ?? payload?.deploy_id ?? serviceData.last_deployment_id ?? null;
    const deploymentUrl =
      deploy?.deployUrl ||
      deploy?.url ||
      deploy?.publishUrl ||
      payload?.deployment_url ||
      serviceData.last_deployment_url ||
      serviceData.production_domain ||
      null;

    await updateProjectServiceData(projectId, 'vercel', {
      last_deployment_id: deploymentId,
      last_deployment_status: status,
      last_deployment_url: deploymentUrl,
      production_domain: serviceData.production_domain ?? deploymentUrl ?? null,
      last_deployment_at: deploy?.createdAt
        ? new Date(deploy.createdAt).toISOString()
        : new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Render webhook] failed', error);
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
