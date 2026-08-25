# Bike Dashboard

Dashboard privado para rutas ciclistas de Apple Fitness/Salud. La exportación ZIP se analiza dentro del navegador: el archivo completo no se sube y el servidor solo recibe entrenamientos de ciclismo, métricas y trazados GPS.

## Desarrollo local

Requiere Node.js 24 o posterior.

```bash
cp .env.example .env
npm install
npm run dev
```

Abre `http://localhost:5173`. Para el primer acceso usa el valor de `BOOTSTRAP_TOKEN`; después se registra una passkey con Touch ID.

Comprobaciones:

```bash
npm run check
```

## Importar desde Apple Fitness

1. En el iPhone abre Salud, toca tu foto y selecciona **Exportar todos los datos de salud**.
2. Lleva `export.zip` al Mac sin descomprimirlo.
3. En Bike Dashboard abre **Importar**, selecciona el ZIP, revisa la vista previa y sincroniza.

El navegador hace dos pasadas en streaming por `export.xml`, conserva solo ciclismo y asocia los GPX de `workout-routes`. Una importación completa reemplaza de forma transaccional el conjunto anterior.

## Sincronización automática con Health Auto Export

El servidor acepta exportaciones JSON v2 de entrenamientos en:

```text
POST https://bike.example.com/api/auto-export/workouts
Authorization: Bearer <HEALTH_AUTO_EXPORT_TOKEN>
```

Los envíos son incrementales e idempotentes: el UUID de HealthKit actualiza la misma salida y nunca borra el histórico. Solo se guardan entrenamientos de ciclismo. Se normalizan kilómetros, millas, velocidad, energía, desnivel, pulso, potencia, cadencia y ruta GPS al mismo contrato interno que usa el importador ZIP.

Para generar una credencial de 256 bits y el enlace que crea la automatización en el iPhone:

```bash
npm run autoexport:setup
```

Si `.env` ya contiene `HEALTH_AUTO_EXPORT_TOKEN`, el comando reutiliza esa credencial. El enlace configura Health Auto Export con JSON v2, solo ciclismo (tipo HealthKit `13`), rutas, métricas por minuto, peticiones por lotes, rango **Since Last Sync** y sincronización cada hora. El enlace contiene la credencial y no debe compartirse.

Después de instalar la app:

1. Añade al `.env` del VPS la línea que muestra el comando y redespliega/reinicia el contenedor.
2. Abre el enlace generado en Safari del iPhone y autoriza a Health Auto Export a leer entrenamientos, rutas y métricas necesarias.
3. En la automatización **Bike Dashboard**, ejecuta **Manual Export** con un rango corto. La respuesta correcta muestra `accepted`, `created`, `updated` e `ignored`.
4. Para recuperar el histórico, ejecuta una segunda exportación manual con el rango deseado. Mantén activados Background App Refresh y las peticiones por lotes.

Las automatizaciones de iOS no tienen horario garantizado y no pueden leer Salud mientras el iPhone está bloqueado. Cargar el teléfono, abrir la app periódicamente y añadir su widget mejora la regularidad. La importación ZIP sigue disponible como respaldo; recuerda que una importación ZIP completa reemplaza el conjunto almacenado por el contenido de ese ZIP.

## Producción

El Compose espera el dominio público en `BIKE_DOMAIN` y puede conectarse a una red externa de Traefik mediante `TRAEFIK_NETWORK`. En el directorio superior al checkout debe existir un `.env` con:

```dotenv
BOOTSTRAP_TOKEN=un-token-largo-y-aleatorio
HEALTH_AUTO_EXPORT_TOKEN=otro-token-independiente-de-64-caracteres
BACKUP_AGE_RECIPIENT=age1...
```

Los datos quedan en el directorio `data` situado junto al checkout; los backups SQLite cifrados con age, en `backups`. Se conservan los siete últimos. La clave privada de age no debe almacenarse en el VPS.

Despliegue:

```bash
chmod +x scripts/deploy-vps.sh
cp .deploy.env.example .deploy.env
# Edita .deploy.env con tu host, ruta, dominio y red de Traefik.
./scripts/deploy-vps.sh
```

El token de activación solo se necesita para registrar la primera passkey. Guárdalo en un gestor de contraseñas y conserva también los códigos de recuperación que se muestran una única vez.
