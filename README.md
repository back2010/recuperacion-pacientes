# Recuperación de Pacientes · Inteligencia Operativa

Código del Google Apps Script (web app + base en Google Sheets). Cada `push` a `main`
sube automáticamente el contenido de `src/` a tu proyecto de Apps Script con
[clasp](https://github.com/google/clasp) mediante GitHub Actions.

```
src/
  Code.gs           web app, sesión, permisos y endpoints
  Datos.gs          estructura del Sheets, configuración, instalación, caché
  Ingesta.gs        lectura del Excel de origen y consolidación
  Vencimientos.gs   causa de vencimiento, reasignados, alerta diaria
  Index.html        página principal
  appsscript.json   manifiesto (zona horaria, Drive API v3, web app)
  (faltan)          App.html, Estilos.html y el .gs con parseHist_, nrm_, auditarFolio_…
```

## ⚠️ Antes del primer push automático

`clasp push` **reemplaza** el proyecto completo: cualquier archivo que exista en Apps Script
y no esté en `src/` se borra. Por eso el workflow se detiene si faltan `App.html`,
`Estilos.html` o el archivo que define `parseHist_`, `nrm_`, `auditarFolio_`, `SYS_USER`,
`REGLAS_VERSION`, `PROC_LBL` y `CAL_LBL`. La forma más segura de traerlos todos es
`clasp pull` (paso 3).

Revisa también `src/appsscript.json`: si tu proyecto ya tiene un manifiesto distinto
(Configuración del proyecto → "Mostrar el archivo de manifiesto appsscript.json"),
copia el tuyo encima de este.

## Configuración (una sola vez)

1. **Activa la API de Apps Script** en tu cuenta: https://script.google.com/home/usersettings
2. **Instala clasp e inicia sesión** en tu computadora (Node 18+):
   ```bash
   npm install -g @google/clasp@2.4.2
   ```
   ```bash
   clasp login
   ```
   Esto crea `~/.clasprc.json` con tus credenciales.
3. **Trae los archivos faltantes** desde tu proyecto:
   - Copia el ID del script (Apps Script → Configuración del proyecto → ID de la secuencia de comandos)
     y ponlo en `.clasp.json`.
   ```bash
   git clone https://github.com/back2010/recuperacion-pacientes.git
   ```
   ```bash
   cd recuperacion-pacientes && clasp pull
   ```
   ```bash
   git add src && git commit -m "Archivos completos desde Apps Script" && git push
   ```
4. **Secretos del repo** (GitHub → Settings → Secrets and variables → Actions → New repository secret):

   | Secreto | Valor |
   |---|---|
   | `CLASPRC_JSON` | Contenido completo de `~/.clasprc.json` |
   | `SCRIPT_ID` | ID del script |
   | `DEPLOYMENT_ID` *(opcional)* | ID de la implementación web (Implementar → Gestionar implementaciones). Si lo pones, cada push actualiza también la URL `/exec`. |

## Flujo de trabajo

- Edita en `src/` (aquí, en GitHub o con Claude) → `git push` → en ~1 min el código está en Apps Script.
- **Pruebas:** usa la URL `/dev` (Implementar → Probar implementaciones); siempre muestra el último código subido.
- **Producción:** con `DEPLOYMENT_ID`, la URL `/exec` también se actualiza en cada push.
  Sin él, publica manualmente una nueva versión cuando quieras.
- Si cambias algo directo en el editor de Apps Script, tráelo con `clasp pull` y haz commit;
  si no, el siguiente push lo sobrescribe.
- Puedes relanzar la subida manualmente en la pestaña **Actions → Subir a Apps Script → Run workflow**.
