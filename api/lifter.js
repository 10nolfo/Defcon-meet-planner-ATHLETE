export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { username } = req.query;
  if (!username) return res.status(400).json({ error: 'Missing username parameter' });

  try {
    const url = `https://www.openipf.org/api/liftercsv/${encodeURIComponent(username)}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'text/csv' }
    });

    if (!response.ok) throw new Error(`OpenIPF returned ${response.status}`);
    const csvText = await response.text();

    // Parse CSV
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));

    const rows = lines.slice(1).map(line => {
      const values = [];
      let current = '';
      let inQuotes = false;
      for (const char of line) {
        if (char === '"') { inQuotes = !inQuotes; }
        else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
        else { current += char; }
      }
      values.push(current.trim());

      const row = {};
      headers.forEach((h, i) => { row[h] = values[i] || ''; });
      return row;
    });

    // Keep only Raw+SBD rows
    const competitions = rows
      .filter(r => r.Event === 'SBD' && r.Equipment === 'Raw')
      .map(r => ({
        date: r.Date || '—',
        meet: r.MeetName || '—',
        location: [r.MeetTown, r.MeetCountry].filter(Boolean).join(', ') || '—',
        bodyweight: parseFloat(r.BodyweightKg) || null,
        weightClass: r.WeightClassKg || '—',
        squat: parseFloat(r.Best3SquatKg) > 0 ? parseFloat(r.Best3SquatKg) : null,
        bench: parseFloat(r.Best3BenchKg) > 0 ? parseFloat(r.Best3BenchKg) : null,
        deadlift: parseFloat(r.Best3DeadliftKg) > 0 ? parseFloat(r.Best3DeadliftKg) : null,
        total: parseFloat(r.TotalKg) > 0 ? parseFloat(r.TotalKg) : null,
        place: r.Place && !isNaN(r.Place) ? parseInt(r.Place) : null,
        federation: r.Federation || '—',
        dots: parseFloat(r.Dots) || null,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    // Best lifts across all competitions
    const best = {
      squat: Math.max(0, ...competitions.map(c => c.squat || 0)) || null,
      bench: Math.max(0, ...competitions.map(c => c.bench || 0)) || null,
      deadlift: Math.max(0, ...competitions.map(c => c.deadlift || 0)) || null,
      total: Math.max(0, ...competitions.map(c => c.total || 0)) || null,
    };

    // Category from most recent competition
    const latest = rows.find(r => r.Event === 'SBD' && r.Equipment === 'Raw') || rows[0] || {};
    const name = latest.Name ? latest.Name.replace(/ #\d+$/, '') : username;
    const gender = latest.Sex === 'M' ? 'M' : latest.Sex === 'F' ? 'F' : null;

    return res.status(200).json({
      name,
      username,
      gender,
      category: latest.WeightClassKg ? `-${latest.WeightClassKg}kg` : '—',
      federation: 'IPF',
      openipfUrl: `https://www.openipf.org/u/${username}`,
      bestLifts: best,
      competitions,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
