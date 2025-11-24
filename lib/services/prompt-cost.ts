import OpenAI from 'openai';
import {
  clampCategory,
  clampComplexity,
  costForCategory,
  type CreditQuote,
} from './credits';

const openaiClient =
  process.env.OPENAI_KEY && process.env.OPENAI_KEY.trim().length > 0
    ? new OpenAI({ apiKey: process.env.OPENAI_KEY })
    : null;

export async function estimatePromptCredits(prompt: string): Promise<CreditQuote> {
  // Fallback if no key
  if (!openaiClient) {
    const category = clampCategory('build');
    const complexity = clampComplexity('medium');
    return {
      category,
      complexity,
      cost: costForCategory(category, complexity),
    };
  }

  try {
    const completion = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 50,
      messages: [
        {
          role: 'system',
          content:
            'You classify a user request for an AI app builder. Respond ONLY with compact JSON: {"category":"build|edit|preview","complexity":"low|medium|high"}. ' +
            'Category build = new app/large generation, edit = small change/refinement, preview = run/deploy without major code changes.',
        },
        {
          role: 'user',
          content: `Request: ${prompt.slice(0, 2000)}`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    let parsed: { category?: string; complexity?: string } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const category = clampCategory(parsed.category);
    const complexity = clampComplexity(parsed.complexity);
    return {
      category,
      complexity,
      cost: costForCategory(category, complexity),
    };
  } catch (error) {
    console.warn('[PromptCost] Falling back due to OpenAI error:', error);
    const category = clampCategory('build');
    const complexity = clampComplexity('medium');
    return {
      category,
      complexity,
      cost: costForCategory(category, complexity),
    };
  }
}
