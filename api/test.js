export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { db, key } = req.query;
  const NOTION_KEY = key || process.env.NOTION_KEY;

  if (!NOTION_KEY) {
    return res.status(200).json({ ok: false, step: 'token', error: 'No se recibió ningún token.' });
  }

  const headers = {
    Authorization: `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
  };

  // Step 1: verify token is valid
  try {
    const userRes = await fetch('https://api.notion.com/v1/users/me', { headers });
    if (!userRes.ok) {
      return res.status(200).json({
        ok: false,
        step: 'token',
        error: 'Token inválido. Asegúrate de copiar el token correcto de tu integración (empieza con ntn_).',
      });
    }
  } catch (e) {
    return res.status(200).json({ ok: false, step: 'token', error: 'Error al verificar el token: ' + e.message });
  }

  if (!db) {
    return res.status(200).json({ ok: true, step: 'token', message: 'Token válido.' });
  }

  // Step 2: verify database is accessible
  try {
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${db}`, { headers });
    const dbData = await dbRes.json();

    if (!dbRes.ok) {
      return res.status(200).json({
        ok: false,
        step: 'database',
        error:
          'Tu integración no tiene acceso a esta base de datos. ' +
          'Abre tu Content Planner en Notion → haz clic en ··· (arriba a la derecha) → Connections → agrega tu integración y vuelve a intentarlo.',
        notion_error: dbData.message,
      });
    }

    return res.status(200).json({ ok: true, step: 'database', db_title: dbData.title?.[0]?.plain_text || 'Base de datos encontrada' });
  } catch (e) {
    return res.status(200).json({ ok: false, step: 'database', error: 'Error al verificar la base de datos: ' + e.message });
  }
}
