export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { db, sort, key } = req.query;

  if (!db) {
    return res.status(400).json({ error: 'Falta el parámetro ?db=DATABASE_ID' });
  }

  const NOTION_KEY = key || process.env.NOTION_KEY;

  if (!NOTION_KEY) {
    return res.status(500).json({ error: 'Falta el API key de Notion' });
  }

  const notionHeaders = {
    Authorization: `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  const sortDir = sort === 'desc' ? 'descending' : 'ascending';

  // Build query body — tries filtered first, falls back to unfiltered
  async function queryDb(dbId, useFilter) {
    const body = {
      page_size: 100,
      sorts: [{ property: 'Fecha', direction: sortDir }],
    };
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
    // 1. Try with Plataforma filter
    let { response, data } = await queryDb(db, true);

    // 2. If filter causes error, try without filter (property may not exist or have different name)
    if (!response.ok) {
      const noFilterAttempt = await queryDb(db, false);

      // 3. If even unfiltered fails and error is object_not_found, try child DB
      if (!noFilterAttempt.response.ok && noFilterAttempt.data.code === 'object_not_found') {
        const childDbId = await findChildDatabase(db);
        if (childDbId) {
          const childAttempt = await queryDb(childDbId, true);
          if (childAttempt.response.ok) {
            response = childAttempt.response;
            data = childAttempt.data;
          } else {
            const childNoFilter = await queryDb(childDbId, false);
            response = childNoFilter.response;
            data = childNoFilter.data;
          }
        } else {
          return res.status(403).json({
            error:
              'No se encontró la base de datos. Asegúrate de haber conectado la integración a tu Content Planner (Paso 3) y de haber pegado la URL correcta (Paso 4).',
          });
        }
      } else {
        response = noFilterAttempt.response;
        data = noFilterAttempt.data;
      }
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Error de Notion' });
    }

    return res.status(200).json({ posts: mapPosts(data.results) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
