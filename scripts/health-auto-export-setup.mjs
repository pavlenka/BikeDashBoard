import { randomBytes } from "node:crypto";

const baseUrl = (process.argv[2] ?? process.env.BIKE_DASHBOARD_URL ?? "http://localhost:5173").replace(/\/$/, "");
let endpoint;
try {
  endpoint = new URL("/api/auto-export/workouts", baseUrl).toString();
} catch {
  console.error("Uso: npm run autoexport:setup -- https://tu-dominio.example");
  process.exit(1);
}

if (!endpoint.startsWith("https://") && !endpoint.startsWith("http://localhost")) {
  console.error("El autoexport debe usar HTTPS (excepto durante pruebas en localhost).");
  process.exit(1);
}

const configuredToken = process.env.HEALTH_AUTO_EXPORT_TOKEN?.trim();
const token = configuredToken || randomBytes(32).toString("hex");
if (token.length < 32) {
  console.error("HEALTH_AUTO_EXPORT_TOKEN debe tener al menos 32 caracteres.");
  process.exit(1);
}

const parameters = {
  url: endpoint,
  name: "Bike Dashboard",
  format: "json",
  datatype: "workouts",
  period: "lastsync",
  exportversion: "v2",
  includeroutes: "true",
  includeworkoutmetadata: "true",
  workoutsmetadatainterval: "minutes",
  workouttypes: "13",
  batchrequests: "true",
  syncinterval: "hours",
  syncquantity: "1",
  requesttimeout: "300",
  notifyonupdate: "false",
  notifywhenrun: "false",
  enabled: "true",
  headers: `Authorization,Bearer ${token}`,
};
const query = Object.entries(parameters)
  .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
  .join("&");

console.log("\n1. Añade esta línea al .env del servidor y reinicia el contenedor:\n");
console.log(`HEALTH_AUTO_EXPORT_TOKEN=${token}`);
console.log("\n2. Abre este enlace en Safari del iPhone después de instalar Health Auto Export:\n");
console.log(`com.HealthExport://automation?${query}`);
console.log("\n3. En la automatización creada, ejecuta Manual Export para comprobarla.");
console.log("No compartas la línea ni el enlace: ambos contienen la credencial del receptor.\n");
