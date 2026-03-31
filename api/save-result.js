// API Endpoint: Save result to Vercel KV
import { kv } from '@vercel/kv';

// Simple secret token validation (not bulletproof, but hides from casual users)
const SECRET_TOKEN = process.env.BROWSERLESS_SECRET || 'x7k9m2p4q8w1';

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate secret token from header
  const clientToken = req.headers['x-browserless-token'];
  if (clientToken !== SECRET_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { email, apiKey, status, durationMs, proxyUsed, note, timestamp } = req.body;

    // Validate required fields
    if (!email || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Create result object
    const result = {
      email,
      apiKey: apiKey || null,
      status,
      durationMs: durationMs || null,
      proxyUsed: proxyUsed || false,
      note: note || null,
      timestamp: timestamp || new Date().toISOString(),
    };

    // Save to KV with unique key
    const key = `result:${timestamp}:${email}`;
    await kv.set(key, result);

    // Also save to sorted set for easy querying
    await kv.zadd('results', {
      score: Date.now(),
      member: JSON.stringify(result),
    });

    console.log('[save-result] Saved:', key);
    res.status(200).json({ success: true, key });
  } catch (error) {
    console.error('[save-result] Error:', error);
    res.status(500).json({ error: error.message });
  }
}
