// Lista las imagenes de una carpeta de Drive para armar el carrusel.
// Usa una clave de API de Google (GOOGLE_API_KEY en Vercel). La clave no da
// permisos: solo identifica quien consulta, asi que sirve para cualquier
// carpeta compartida como "cualquier persona con el enlace".

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { folder } = req.query;

  if (!folder || !/^[-\w]{10,}$/.test(folder)) {
    return res.status(400).json({ error: 'Falta o es invalido el parametro ?folder=' });
  }

  const KEY = process.env.GOOGLE_API_KEY;
  if (!KEY) {
    return res.status(500).json({
      error: 'Falta la variable GOOGLE_API_KEY en Vercel. Sin ella no puedo leer carpetas de Drive.',
    });
  }

  const q = `'${folder}' in parents and trashed = false and (mimeType contains 'image/' or mimeType contains 'video/')`;
  const url =
    'https://www.googleapis.com/drive/v3/files' +
    `?q=${encodeURIComponent(q)}` +
    '&fields=files(id,name,mimeType)' +
    '&pageSize=200' +
    `&key=${KEY}`;

  try {
    const r = await fetch(url);
    const data = await r.json();

    if (!r.ok) {
      const msg = data.error?.message || `Drive respondio ${r.status}`;
      if (r.status === 403) {
        return res.status(403).json({
          error:
            'Drive rechazo la consulta. Revisa que la carpeta este compartida como "cualquier persona con el enlace" ' +
            'y que la API de Drive este habilitada para tu clave. Detalle: ' + msg,
        });
      }
      if (r.status === 404) {
        return res.status(404).json({ error: 'No se encontro la carpeta en Drive.' });
      }
      return res.status(r.status).json({ error: msg });
    }

    const files = data.files || [];

    // Orden natural: 2 antes que 10 (el orden alfabetico los invierte)
    const numOf = (name) => {
      const m = name.match(/\d+/);
      return m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER;
    };
    files.sort((a, b) => numOf(a.name) - numOf(b.name) || a.name.localeCompare(b.name));

    const images = files.map((f) => {
      const isVideo = (f.mimeType || '').startsWith('video/');
      return {
        id: f.id,
        name: f.name,
        kind: isVideo ? 'video' : 'image',
        // Drive genera miniatura tambien para video: mostramos su fotograma
        url: `https://drive.google.com/thumbnail?id=${f.id}&sz=w1200`,
        // Para video, a donde ir al tocarlo
        link: isVideo ? `https://drive.google.com/file/d/${f.id}/view` : null,
        // Reproductor incrustado, se carga solo al tocar play
        embed: isVideo ? `https://drive.google.com/file/d/${f.id}/preview` : null,
      };
    });

    return res.status(200).json({ images });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
