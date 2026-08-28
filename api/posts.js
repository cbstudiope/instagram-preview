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

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${db}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
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

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.message || 'Error de Notion' });
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
