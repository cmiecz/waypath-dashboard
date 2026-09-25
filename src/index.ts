import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createEventStore } from "./events/store.js";
import { MemoryEventStore } from "./events/store.js";
import { buildDemoBotEvents } from "./demo/sample.js";
import { SnapshotService } from "./github/snapshot.js";
import { mountRoutes } from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function main(): Promise<void> {
  const config = loadConfig();
  const { store, backend } = await createEventStore(config.databaseUrl);

  if (config.demoMode && store instanceof MemoryEventStore) {
    store.seed(buildDemoBotEvents());
  }

  const snapshot = new SnapshotService(config, store);
  snapshot.start();

  const app = express();

  // Capture raw body for webhook signature verification
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  app.use(express.static(path.join(root, "public")));

  const publicDir = path.join(root, "public");
  mountRoutes(app, {
    config,
    events: store,
    snapshot,
    eventBackend: backend,
    publicDir,
  });

  app.listen(config.port, "0.0.0.0", () => {
    console.log(
      `WayPath dashboard listening on 0.0.0.0:${config.port} (demo=${config.demoMode}, events=${backend})`,
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
