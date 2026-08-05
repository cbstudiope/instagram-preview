# Instagram Preview Widget — Instrucciones de deploy

## Lo que necesitas antes de empezar

- Cuenta en Vercel (gratis): https://vercel.com
- El API key de tu integración de Notion (ya lo tienes)
- El ID de tu base de datos de Notion (ver paso 3)

---

## Paso 1 — Conectar tu integración a la base de datos

1. Abre tu base de datos **Content Planner** en Notion
2. Haz clic en los tres puntos `...` (arriba a la derecha)
3. Ve a **Connections** → busca tu integración → haz clic en ella para conectarla

Sin este paso, el widget no podrá leer los datos.

---

## Paso 2 — Subir los archivos a Vercel

1. Ve a https://vercel.com y crea una cuenta (puedes usar tu cuenta de Google)
2. En el dashboard, haz clic en **Add New → Project**
3. Elige **Deploy from your computer** o arrastra la carpeta `instagram-preview`
4. Vercel detectará automáticamente que es un proyecto con funciones en `/api`
5. Haz clic en **Deploy**

---

## Paso 3 — Agregar el API key como variable de entorno

1. En Vercel, entra a tu proyecto → **Settings** → **Environment Variables**
2. Agrega esta variable:
   - **Name:** `NOTION_KEY`
   - **Value:** tu API key de Notion (`ntn_...`)
3. Haz clic en **Save**
4. Ve a **Deployments** → haz clic en los tres puntos del último deploy → **Redeploy**

---

## Paso 4 — Obtener el ID de tu base de datos

1. Abre tu base de datos **Content Planner** en Notion (en el navegador)
2. La URL se ve así:
   ```
   https://www.notion.so/Tu-Nombre/abc123def456...?v=...
   ```
3. El ID es la parte larga después del último `/` y antes del `?`
   (32 caracteres, con guiones o sin ellos)

---

## Paso 5 — Probar el widget

En el navegador, abre:
```
https://TU-PROYECTO.vercel.app?db=TU_DATABASE_ID
```

Si todo está bien, verás el grid con tus posts de Instagram.

---

## Paso 6 — Embeber en Notion

1. En cualquier página de Notion, escribe `/embed`
2. Pega la URL completa con el `?db=...`
3. Presiona Enter

El widget aparecerá dentro de Notion y se puede redimensionar.

---

## Para usar con otro cliente

Solo cambia el `?db=` en la URL por el ID de la base de datos del cliente.
La misma app funciona para todos.

---

## Campos que debe tener la base de datos

| Campo       | Tipo           | Requerido |
|-------------|----------------|-----------|
| Name        | Título         | Sí        |
| Fecha       | Fecha          | Sí        |
| Cover       | Files & Media  | Sí (imagen) |
| Plataforma  | Multi-select   | Sí (debe tener "Instagram") |
| Estado      | Status         | Opcional  |
| Pilar       | Select         | Opcional  |
| Contenido   | URL            | Opcional  |
