// API Endpoint: Get all results from Vercel KV
import { kv } from '@vercel/kv';

// Simple secret token validation
const SECRET_TOKEN = process.env.BROWSERLESS_SECRET || 'x7k9m2p4q8w1';

export default async function handler(req, res) {
  // Only allow GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate secret token from header
  const clientToken = req.headers['x-browserless-token'];
  if (clientToken !== SECRET_TOKEN) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    // Get all results from sorted set
    const results = await kv.zrange('results', 0, -1, { rev: true });
    
    // Parse JSON strings
    const parsedResults = results.map(r => JSON.parse(r));

    console.log('[get-results] Retrieved', parsedResults.length, 'results');
    res.status(200).json({ success: true, results: parsedResults });
  } catch (error) {
    console.error('[get-results] Error:', error);
    res.status(500).json({ error: error.message, results: [] });
  }
}
