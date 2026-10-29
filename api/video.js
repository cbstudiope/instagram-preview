import { Readable } from 'node:stream';

// Trae el video desde Drive y lo reenvia al navegador desde tu propio dominio.
// Google entrega los bytes al servidor sin problema; lo que bloquea es la carga
// cross-origin desde el navegador. Al pasar por aqui el <video> lo ve como propio.

const CHUNK = 2 * 1024 * 1024;   // 2 MB por pedido: respuestas chicas y rapidas

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id || !/^[-\w]{10,}$/.test(id)) {
    return res.status(400).json({ error: 'Falta o es invalido el parametro ?id=' });
  }

  // Rango pedido por el navegador (si no manda, arrancamos del inicio)
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start = m ? parseInt(m[1], 10) : 0;
  const askedEnd = m && m[2] ? parseInt(m[2], 10) : null;
  const end = Math.min(askedEnd ?? start + CHUNK - 1, start + CHUNK - 1);

  const src = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;

  try {
    const upstream = await fetch(src, {
      headers: {
        Range: `bytes=${start}-${end}`,
        // Sin esto Drive a veces devuelve la pagina de advertencia en vez del archivo
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({ error: `Drive respondio ${upstream.status}` });
    }

    const type = upstream.headers.get('content-type') || '';

    // Si Drive devolvio HTML es la pantalla de antivirus o de permisos, no el video
    if (type.includes('text/html')) {
      return res.status(409).json({
        error: 'Drive no entrego el archivo. Revisa que este compartido como "cualquier persona con el enlace" y que no exceda el limite de tamano.',
      });
    }

    const range = upstream.headers.get('content-range');
    const len = upstream.headers.get('content-length');

    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader('Content-Type', type.startsWith('video/') ? type : 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (range) res.setHeader('Content-Range', range);
    if (len) res.setHeader('Content-Length', len);
    // Ojo: no reenviamos Content-Disposition, que es lo que forzaba la descarga

    if (req.method === 'HEAD' || !upstream.body) return res.end();

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
