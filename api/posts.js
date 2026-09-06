export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { db, sort, key } = req.query;

  if (!db) {
    return res.status(400).json({ error: 'Falta el parámetro ?db=DATABASE_ID' });
  }

  const usingOwnKey = Boolean(key);
  const NOTION_KEY  = key || process.env.NOTION_KEY;

  if (!NOTION_KEY) {
    return res.status(500).json({ error: 'Falta el API key de Notion' });
  }

  const notionHeaders = {
    Authorization: `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  const sortDir = sort === 'desc' ? 'descending' : 'ascending';

  // Build query body with configurable filter and sort
  async function queryDb(dbId, useFilter, useSort) {
    const body = { page_size: 100 };
    if (useSort) {
      body.sorts = [{ property: 'Fecha', direction: sortDir }];
    }
    if (useFilter) {
      body.filter = {
        property: 'Plataforma',
        multi_select: { contains: 'Instagram' },
      };
    }
    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return { response, data };
  }

  // Try all fallback levels for a given DB id
  async function tryAllLevels(dbId) {
    // Level 1: filter + sort (ideal)
    let attempt = await queryDb(dbId, true, true);
    if (attempt.response.ok) return attempt;

    // Level 2: no filter + sort
    attempt = await queryDb(dbId, false, true);
    if (attempt.response.ok) return attempt;

    // Level 3: no filter + no sort (bare minimum, same as test endpoint)
    attempt = await queryDb(dbId, false, false);
    return attempt;
  }

  // Try to find a child database inside a page (fallback for page IDs)
  async function findChildDatabase(pageId) {
    const r = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'GET',
      headers: notionHeaders,
    });
    if (!r.ok) return null;
    const d = await r.json();
    const block = (d.results || []).find((b) => b.type === 'child_database');
    return block ? block.id : null;
  }

  function mapPosts(results) {
    return results.map((page) => {
      const coverFiles = page.properties.Cover?.files || [];
      const imageUrl =
        coverFiles[0]?.file?.url || coverFiles[0]?.external?.url || null;
      return {
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || 'Sin título',
        imageUrl,
        fecha: page.properties.Fecha?.date?.start || null,
        contenidoUrl: page.properties.Contenido?.url || null,
        estado: page.properties.Estado?.status?.name || null,
        pilar: page.properties.Pilar?.select?.name || null,
        notionUrl: `https://www.notion.so/${page.id.replace(/-/g, '')}`,
      };
    });
  }

  try {
    // Try all levels on the given ID
    let { response, data } = await tryAllLevels(db);

    // If all levels fail and it's object_not_found, try child database
    if (!response.ok && data.code === 'object_not_found') {
      const childDbId = await findChildDatabase(db);
      if (childDbId) {
        const childResult = await tryAllLevels(childDbId);
        response = childResult.response;
        data = childResult.data;
      }
    }

    if (!response.ok) {
      if (data.code === 'object_not_found') {
        if (!usingOwnKey) {
          return res.status(403).json({
            error:
              'El widget no recibió tu token de Notion, así que intentó con el token por defecto (que no tiene acceso a tu base de datos). Vuelve a generar tu link en /setup y asegúrate de copiarlo completo, incluyendo la parte &key=ntn_...',
          });
        }
        return res.status(403).json({
          error:
            'Tu integración no tiene acceso a esta base de datos. Abre tu Content Planner en Notion → ··· → Connections → agrega tu integración, y vuelve a cargar.',
        });
      }
      return res.status(response.status).json({ error: data.message || 'Error de Notion' });
    }

    return res.status(200).json({ posts: mapPosts(data.results) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
