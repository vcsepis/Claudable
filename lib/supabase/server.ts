import { createClient, type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';

let serverClient: SupabaseClient | null = null;
const channelCache = new Map<string, RealtimeChannel>();

function getSupabaseServerClient(): SupabaseClient | null {
  if (serverClient) return serverClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceKey) {
    console.warn('[SupabaseRealtime] Missing SUPABASE env, realtime broadcast disabled');
    return null;
  }

  serverClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  return serverClient;
}

async function ensureChannel(projectId: string): Promise<RealtimeChannel | null> {
  const client = getSupabaseServerClient();
  if (!client) return null;

  const channelName = `chat:${projectId}`;
  const existing = channelCache.get(channelName);
  if (existing) return existing;

  const channel = client.channel(channelName, {
    config: { broadcast: { ack: true } },
  });

  await new Promise<void>((resolve, reject) => {
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channelCache.set(channelName, channel);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reject(new Error(`Supabase channel ${channelName} failed: ${status}`));
      }
    });
  });

  return channel;
}

export async function broadcastSupabaseRealtime(
  projectId: string,
  event: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const channel = await ensureChannel(projectId);
    if (!channel) return;

    const { error } = await channel.send({
      type: 'broadcast',
      event,
      payload,
    });

    if (error) {
      console.warn('[SupabaseRealtime] Broadcast error:', error);
    }
  } catch (error) {
    console.warn('[SupabaseRealtime] Failed to broadcast:', error);
  }
}
