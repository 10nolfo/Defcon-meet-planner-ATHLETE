export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Missing query parameter q' });

  try {
    const url = `https://www.openipf.org/api/search/rankings?q=${encodeURIComponent(q)}&limit=10`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) throw new Error(`OpenIPF returned ${response.status}`);
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
