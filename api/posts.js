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

  // Helper: query a known database ID
  async function queryDatabase(dbId) {
    const response = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        filter: {
          property: 'Plataforma',
          multi_select: { contains: 'Instagram' },
        },
        sorts: [
          {
            property: 'Fecha',
            direction: sort === 'desc' ? 'descending' : 'ascending',
          },
        ],
        page_size: 100,
      }),
    });
    return { response, data: await response.json() };
  }

  // Helper: search for a child database inside a page
  async function findChildDatabase(pageId) {
    const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'GET',
      headers: notionHeaders,
    });
    if (!response.ok) return null;
    const data = await response.json();
    const dbBlock = (data.results || []).find(
      (b) => b.type === 'child_database'
    );
    return dbBlock ? dbBlock.id : null;
  }

  try {
    // First attempt: treat the ID as a database
    let { response, data } = await queryDatabase(db);

    // If Notion says it can't find it as a database, maybe it's a page containing a DB
    if (!response.ok && data.code === 'object_not_found') {
      const childDbId = await findChildDatabase(db);
      if (childDbId) {
        const retry = await queryDatabase(childDbId);
        response = retry.response;
        data = retry.data;
      }
    }

    if (!response.ok) {
      const msg = data.message || 'Error de Notion';
      // Friendlier message for the common case
      if (data.code === 'object_not_found') {
        return res.status(403).json({
          error:
            'No se encontró la base de datos. Asegúrate de haber conectado la integración a tu Content Planner (Paso 3) y de haber pegado la URL correcta (Paso 4).',
        });
      }
      return res.status(response.status).json({ error: msg });
    }

    const posts = data.results.map((page) => {
      const coverFiles = page.properties.Cover?.files || [];
      const imageUrl =
        coverFiles[0]?.file?.url ||
        coverFiles[0]?.external?.url ||
        null;

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

    return res.status(200).json({ posts });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
