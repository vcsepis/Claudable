import { NextRequest, NextResponse } from 'next/server';
import { ensureUserCredits, getUserCreditBalance } from '@/lib/services/credits';

export async function GET(request: NextRequest) {
  try {
    const userId =
      request.nextUrl.searchParams.get('user_id') ||
      request.nextUrl.searchParams.get('userId') ||
      request.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    await ensureUserCredits(userId);
    const balance = await getUserCreditBalance(userId);

    return NextResponse.json({
      success: true,
      data: { balance, userId },
    });
  } catch (error) {
    console.error('[API] Failed to fetch user credits:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch user credits',
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
