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
        and: [
          { property: 'Plataforma', multi_select: { contains: 'Instagram' } },
          { property: 'Cover', files: { is_not_empty: true } },
        ],
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

  // Convierte links de Google Drive en URLs de imagen directa.
  // Los links normales de Drive (/file/d/ID/view) devuelven una página HTML,
  // no una imagen, así que un <img> no los puede mostrar.
  function normalizeImageUrl(url) {
    if (!url) return null;

    // Ya es una imagen directa de Google — no tocar
    if (/googleusercontent\.com/i.test(url)) return url;

    // Solo transformamos links de Drive / Docs
    if (!/^https?:\/\/(drive|docs)\.google\.com\//i.test(url)) return url;

    const id =
      (url.match(/\/file\/d\/([-\w]{10,})/) || [])[1] ||   // /file/d/ID/view
      (url.match(/[?&]id=([-\w]{10,})/) || [])[1] ||        // ?id=ID (open, uc, thumbnail)
      (url.match(/\/d\/([-\w]{10,})/) || [])[1];            // /d/ID

    return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : url;
  }

  // Convierte el link de Contenido en una URL que se pueda cargar en un iframe.
  // Canva bloquea sus páginas normales en iframe: solo funciona la variante ?embed.
  // Drive usa /preview como endpoint oficial de reproducción.
  function buildEmbed(url) {
    if (!url) return { embedUrl: null, embedType: null };

    // Archivo de video directo (subido a Notion, o cualquier URL que termine en video):
    // lo reproducimos con un <video> propio, sin iframe y con un solo juego de controles.
    if (/\.(mp4|mov|webm|m4v)(\?|$)/i.test(url)) {
      return { embedUrl: url, embedType: 'file-video' };
    }

    const canva = url.match(/canva\.com\/design\/([-\w]+)(?:\/([-\w]+))?/i);
    if (canva) {
      const token = canva[2] && !/^(view|edit|watch)$/i.test(canva[2]) ? canva[2] : null;
      const path  = token ? `${canva[1]}/${token}` : canva[1];
      return { embedUrl: `https://www.canva.com/design/${path}/view?embed`, embedType: 'canva' };
    }

    if (/^https?:\/\/(drive|docs)\.google\.com\//i.test(url)) {
      const id =
        (url.match(/\/file\/d\/([-\w]{10,})/) || [])[1] ||
        (url.match(/[?&]id=([-\w]{10,})/) || [])[1] ||
        (url.match(/\/d\/([-\w]{10,})/) || [])[1];
      if (id) {
        return {
          embedUrl: `https://drive.google.com/file/d/${id}/preview`,
          embedType: 'drive',
          // Bytes crudos del archivo: permite usar un <video> propio en vez
          // del reproductor de Drive (que en iOS duplica los controles).
          directUrl: `/api/video?id=${id}`,   // pasa por nuestro proxy
        };
      }
    }

    const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([-\w]{6,})/i);
    if (yt) return { embedUrl: `https://www.youtube-nocookie.com/embed/${yt[1]}`, embedType: 'video' };

    const vimeo = url.match(/vimeo\.com\/(\d{6,})/i);
    if (vimeo) return { embedUrl: `https://player.vimeo.com/video/${vimeo[1]}`, embedType: 'video' };

    return { embedUrl: null, embedType: 'link' };
  }

  // Lee un link sin importar si la propiedad es tipo URL, Archivos y multimedia,
  // o texto con un enlace pegado dentro.
  function readLinkProp(prop) {
    if (!prop) return null;
    if (prop.url) return prop.url;                         // tipo URL
    const f = (prop.files || [])[0];                       // tipo Archivos y multimedia
    if (f) return f.external?.url || f.file?.url || null;
    const text = (prop.rich_text || []).map((t) => t.plain_text).join('').trim();
    if (text && /^https?:\/\//i.test(text)) return text;   // tipo texto con URL
    return null;
  }

  function readCaption(props) {
    const p = props.Caption || props.caption;
    if (!p) return null;
    const parts = p.rich_text || p.title || [];
    const text = parts.map((t) => t.plain_text).join('').trim();
    return text || null;
  }

  function mapPosts(results) {
    return results
      .map((page) => {
      const coverFiles = page.properties.Cover?.files || [];
      const imageUrl = normalizeImageUrl(
        coverFiles[0]?.file?.url || coverFiles[0]?.external?.url || null
      );
      const contenidoUrl = readLinkProp(page.properties.Contenido);
      const { embedUrl, embedType, directUrl } = buildEmbed(contenidoUrl);
      return {
        id: page.id,
        name: page.properties.Name?.title?.[0]?.plain_text || 'Sin título',
        imageUrl,
        caption: readCaption(page.properties),
        fecha: page.properties.Fecha?.date?.start || null,
        contenidoUrl,
        embedUrl,
        embedType,
        directUrl: directUrl || null,
        estado: page.properties.Estado?.status?.name || null,
        pilar: page.properties.Pilar?.select?.name || null,
        notionUrl: `https://www.notion.so/${page.id.replace(/-/g, '')}`,
      };
      })
      // Safety net: si la query cayó a un nivel sin filtro, igual excluimos
      // los posts que no tienen imagen en Cover
      .filter((post) => Boolean(post.imageUrl));
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
