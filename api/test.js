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
    'Content-Type': 'application/json',
  };

  // Step 1: verify token is valid via /users/me
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

  // Step 2: verify database access using the EXACT same query the widget uses
  try {
    const queryRes = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ page_size: 1 }), // minimal query, no filters
    });
    const queryData = await queryRes.json();

    if (!queryRes.ok) {
      // Friendly error based on Notion's error code
      if (queryData.code === 'object_not_found') {
        return res.status(200).json({
          ok: false,
          step: 'database',
          error:
            'La integración no tiene acceso a esta base de datos. ' +
            'En tu Content Planner: haz clic en ··· (arriba a la derecha) → Connections → agrega tu integración. Luego vuelve a verificar.',
          notion_code: queryData.code,
          notion_error: queryData.message,
        });
      }
      if (queryData.code === 'unauthorized') {
        return res.status(200).json({
          ok: false,
          step: 'database',
          error: 'Token sin permisos para esta base de datos. Verifica que el token pertenece al mismo workspace donde está tu Content Planner.',
          notion_code: queryData.code,
        });
      }
      return res.status(200).json({
        ok: false,
        step: 'database',
        error: queryData.message || 'Error desconocido al acceder a la base de datos.',
        notion_code: queryData.code,
      });
    }

    return res.status(200).json({
      ok: true,
      step: 'database',
      message: 'Conexión exitosa.',
      results_count: queryData.results?.length ?? 0,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, step: 'database', error: 'Error de red: ' + e.message });
  }
}
