export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { pageId, db, key } = req.body || {};

  if (!pageId || !db) {
    return res.status(400).json({ error: 'Faltan pageId o db' });
  }

  const NOTION_KEY = key || process.env.NOTION_KEY;
  if (!NOTION_KEY) return res.status(500).json({ error: 'Falta el API key de Notion' });

  const headers = {
    Authorization: `Bearer ${NOTION_KEY}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Un estado "pendiente" menciona aprobación pero no es la aprobación en sí
  const esPendiente = (s) => {
    const t = norm(s);
    return /\b(falta|sin|pendiente|esperando|espera|por)\b/.test(t);
  };

  try {
    // 1. Leer el esquema para descubrir cómo se llama el estado aprobado
    //    (así funciona aunque cada estudiante nombre sus opciones distinto)
    const schemaRes = await fetch(`https://api.notion.com/v1/databases/${db}`, { headers });
    const schema = await schemaRes.json();

    if (!schemaRes.ok) {
      return res.status(schemaRes.status).json({ error: schema.message || 'No se pudo leer la base de datos' });
    }

    const props = schema.properties || {};

    // Preferimos una propiedad llamada "Estado"; si no, la primera de tipo status/select
    const candidates = Object.entries(props).filter(
      ([, v]) => v.type === 'status' || v.type === 'select'
    );
    const chosen =
      candidates.find(([name]) => norm(name) === 'estado') ||
      candidates.find(([name]) => norm(name).includes('estado')) ||
      candidates[0];

    if (!chosen) {
      return res.status(400).json({ error: 'La base de datos no tiene una propiedad de estado.' });
    }

    const [propName, propDef] = chosen;
    const options = (propDef.type === 'status' ? propDef.status : propDef.select)?.options || [];

    // 2. Elegir la opción que representa "aprobado"
    const approved =
      options.find((o) => /\baprobad[oa]\b/.test(norm(o.name)) && !esPendiente(o.name)) ||
      options.find((o) => norm(o.name).includes('aprob') && !esPendiente(o.name));

    if (!approved) {
      return res.status(400).json({
        error:
          `No encontré una opción de estado que signifique "aprobado" en la propiedad "${propName}". ` +
          `Opciones disponibles: ${options.map((o) => o.name).join(', ') || '(ninguna)'}.`,
      });
    }

    // 3. Actualizar la página
    const payload =
      propDef.type === 'status'
        ? { [propName]: { status: { name: approved.name } } }
        : { [propName]: { select: { name: approved.name } } };

    const updRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ properties: payload }),
    });
    const updData = await updRes.json();

    if (!updRes.ok) {
      return res.status(updRes.status).json({ error: updData.message || 'No se pudo actualizar el estado' });
    }

    return res.status(200).json({ success: true, estado: approved.name });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
