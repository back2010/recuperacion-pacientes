# Recuperación de Pacientes · Inteligencia Operativa

Código del Google Apps Script. Cada cambio que se sube a `main` dentro de `src/` se copia
solo a tu Apps Script (GitHub Actions + [clasp](https://github.com/google/clasp)).

- **Subir a Apps Script** (`deploy.yml`): automático en cada push a `src/`.
- **Traer desde Apps Script** (`traer.yml`): manual (Actions → Run workflow). Copia al repo
  lo que hoy está en tu script, por ejemplo si editaste algo directo en el editor.

## Conexión (una sola vez, todo en el navegador)

El cliente OAuth público de clasp ya no funciona ("The OAuth client was not found"),
así que se usa uno propio:

1. **Proyecto de Google Cloud:** https://console.cloud.google.com/projectcreate → nombre `clasp-rp` → Crear.
2. **Activar la API:** https://console.cloud.google.com/apis/library/script.googleapis.com → Habilitar.
3. **Pantalla de consentimiento:** https://console.cloud.google.com/auth/overview → Comenzar.
   Nombre `clasp-rp`, tu correo, público **Externo**, aceptar y Crear.
   Luego en **Público** → Usuarios de prueba → agregar tu correo.
4. **Cliente:** https://console.cloud.google.com/auth/clients → Crear cliente →
   tipo **App de escritorio** → Crear → **Descargar JSON**.
5. **Cloud Shell** (https://shell.cloud.google.com): menú ⋮ → Subir → elige el JSON. Después:
   ```bash
   mv ~/client_secret_*.json ~/creds.json
   ```
   ```bash
   npx -y @google/clasp@3.4.1 login --no-localhost --creds ~/creds.json
   ```
   Abre el enlace, autoriza ("Google no verificó esta app" → Avanzado → Ir a clasp-rp), y pega en la
   terminal la dirección de la página final que no carga (`http://localhost:8888/?...code=...`).
6. Copia la llave:
   ```bash
   cat ~/.clasprc.json
   ```
7. GitHub → Settings → Secrets and variables → Actions → New repository secret:
   `CLASPRC_JSON` = lo que copiaste.
8. GitHub → Actions → **Traer desde Apps Script** → Run workflow (trae App.html y lo demás).

Esas credenciales dan acceso a tus proyectos de Apps Script: no las compartas ni las pegues en otro lugar.

## Pruebas y producción

- **Pruebas:** la URL `/dev` (Implementar → Probar implementaciones) siempre muestra el último código.
- **Producción (`/exec`):** opcional. Agrega el secreto `DEPLOYMENT_ID` (Implementar → Gestionar
  implementaciones → ID) y cada push también actualizará la URL publicada.

## Importante

Subir a Apps Script **reemplaza todo el proyecto** con lo que hay en `src/`. Si editas algo
directo en el editor de Apps Script, corre primero "Traer desde Apps Script"; si no, se pierde
en el siguiente push. Por seguridad, la subida se detiene si faltan archivos que el código necesita.
