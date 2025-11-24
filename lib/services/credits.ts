import { prisma } from '@/lib/db/client';

const DEFAULT_USER_CREDITS = 1000;
const COST_RANGES = {
  build: { min: 15, max: 25 },
  edit: { min: 3, max: 5 },
  preview: { min: 1, max: 2 },
} as const;

export type CreditCategory = keyof typeof COST_RANGES;
export type CreditComplexity = 'low' | 'medium' | 'high';

export interface CreditQuote {
  category: CreditCategory;
  complexity: CreditComplexity;
  cost: number;
}

export async function ensureUserCredits(userId: string): Promise<number> {
  const record = await prisma.userCredit.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      balance: DEFAULT_USER_CREDITS,
    },
    select: { balance: true },
  });
  return record.balance;
}

export async function getUserCreditBalance(userId: string): Promise<number> {
  const record = await prisma.userCredit.findUnique({
    where: { userId },
    select: { balance: true },
  });
  if (!record) {
    return ensureUserCredits(userId);
  }
  return record.balance;
}

export async function getProjectCreditBalance(projectId: string): Promise<number> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true },
  });
  if (!project) {
    throw new Error('Project not found');
  }
  return getUserCreditBalance(project.userId);
}

export async function deductUserCredits(
  userId: string,
  amount: number,
  reason: string,
  projectId?: string,
  metadata?: Record<string, unknown>
): Promise<number> {
  const normalized = Math.abs(Math.round(amount));
  if (normalized <= 0) {
    throw new Error('Amount must be positive');
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.userCredit.findUnique({
      where: { userId },
      select: { balance: true },
    });
    const currentBalance = existing?.balance ?? DEFAULT_USER_CREDITS;
    const nextBalance = currentBalance - normalized;
    if (nextBalance < 0) {
      throw new Error('Insufficient credits');
    }

    await tx.userCredit.upsert({
      where: { userId },
      update: { balance: nextBalance, updatedAt: new Date() },
      create: { userId, balance: nextBalance },
    });

    await tx.userCreditLedger.create({
      data: {
        userId,
        projectId,
        delta: -normalized,
        balanceAfter: nextBalance,
        reason: reason.slice(0, 255),
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    // Keep project.creditBalance in sync for display convenience
    if (projectId) {
      await tx.project.updateMany({
        where: { id: projectId },
        data: { creditBalance: nextBalance, updatedAt: new Date() },
      });
    } else {
      await tx.project.updateMany({
        where: { userId },
        data: { creditBalance: nextBalance, updatedAt: new Date() },
      });
    }

    return nextBalance;
  });

  return result;
}

export function costForCategory(category: CreditCategory, complexity: CreditComplexity): number {
  const range = COST_RANGES[category];
  const factor =
    complexity === 'low' ? 0 : complexity === 'medium' ? 0.5 : 1;
  const value = Math.round(range.min + (range.max - range.min) * factor);
  return Math.max(range.min, Math.min(range.max, value));
}

export function clampCategory(category?: string | null): CreditCategory {
  if (category === 'edit') return 'edit';
  if (category === 'preview' || category === 'deploy') return 'preview';
  return 'build';
}

export function clampComplexity(value?: string | null): CreditComplexity {
  if (value === 'low' || value === 'medium' || value === 'high') return value;
  return 'medium';
}
