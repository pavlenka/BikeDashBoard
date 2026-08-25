import path from "node:path";

try {
  process.loadEnvFile?.();
} catch {
  // Production injects environment variables through Docker Compose.
}

const isProduction = process.env.NODE_ENV === "production";

export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "127.0.0.1",
  databasePath:
    process.env.DATABASE_PATH === ":memory:"
      ? ":memory:"
      : path.resolve(process.env.DATABASE_PATH ?? "./data/bike-dashboard.sqlite"),
  rpId: process.env.RP_ID ?? "localhost",
  rpName: process.env.RP_NAME ?? "Bike Dashboard",
  rpOrigin: process.env.RP_ORIGIN ?? "http://localhost:5173",
  bootstrapToken: process.env.BOOTSTRAP_TOKEN ?? "",
  healthAutoExportToken: process.env.HEALTH_AUTO_EXPORT_TOKEN ?? "",
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  backupDir: path.resolve(process.env.BACKUP_DIR ?? "./backups"),
  backupAgeRecipient: process.env.BACKUP_AGE_RECIPIENT ?? "",
};

if (isProduction && !config.bootstrapToken) {
  throw new Error("BOOTSTRAP_TOKEN is required in production");
}
