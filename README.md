# Recuperación de Pacientes · Inteligencia Operativa

Código del Google Apps Script. Cada cambio que se sube a `main` dentro de `src/` se copia
solo a tu Apps Script (GitHub Actions + [clasp](https://github.com/google/clasp)).

- **Subir a Apps Script** (`deploy.yml`): automático en cada push a `src/`.
- **Traer desde Apps Script** (`traer.yml`): manual (Actions → Run workflow). Copia al repo
  lo que hoy está en tu script, por ejemplo si editaste algo directo en el editor.

## Conexión (una sola vez, todo en el navegador)

1. Abre **Google Cloud Shell**: https://shell.cloud.google.com (con la misma cuenta de Google del script).
2. Escribe y presiona Enter:
   ```bash
   npx -y @google/clasp@3.4.1 login --no-localhost
   ```
3. Abre el enlace que aparece, elige tu cuenta y acepta los permisos.
   Al final el navegador muestra "No se puede acceder a este sitio": **es normal**.
   Copia la dirección completa de esa página (empieza con `http://localhost:8888/?...`),
   pégala en Cloud Shell y presiona Enter.
4. Muestra tus credenciales y cópialas completas (de `{` a `}`):
   ```bash
   cat ~/.clasprc.json
   ```
5. En GitHub: este repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `CLASPRC_JSON`
   - Secret: lo que copiaste.
6. En GitHub: **Actions → Traer desde Apps Script → Run workflow**. Esto copia al repo los
   archivos que faltan (App.html, Estilos.html, etc.).

Esas credenciales dan acceso a tus proyectos de Apps Script: no las compartas ni las pegues en otro lugar.

## Pruebas y producción

- **Pruebas:** la URL `/dev` (Implementar → Probar implementaciones) siempre muestra el último código.
- **Producción (`/exec`):** opcional. Agrega el secreto `DEPLOYMENT_ID` (Implementar → Gestionar
  implementaciones → ID) y cada push también actualizará la URL publicada.

## Importante

Subir a Apps Script **reemplaza todo el proyecto** con lo que hay en `src/`. Si editas algo
directo en el editor de Apps Script, corre primero "Traer desde Apps Script"; si no, se pierde
en el siguiente push. Por seguridad, la subida se detiene si faltan archivos que el código necesita.
