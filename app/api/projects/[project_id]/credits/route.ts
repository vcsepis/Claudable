import { NextRequest, NextResponse } from 'next/server';
import { getProjectCreditBalance } from '@/lib/services/credits';

interface RouteContext {
  params: Promise<{ project_id: string }>;
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { project_id } = await params;
    const balance = await getProjectCreditBalance(project_id);
    return NextResponse.json({ success: true, data: { balance } });
  } catch (error) {
    console.error('[API] Failed to fetch project credits:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch credits',
      },
      { status: 400 }
    );
  }
}

// Disallow client-driven credit mutation to avoid tampering
export async function POST() {
  return NextResponse.json(
    { success: false, error: 'Direct credit mutations are not allowed.' },
    { status: 405 }
  );
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
