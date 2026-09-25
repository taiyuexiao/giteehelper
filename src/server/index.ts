import express from "express";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";
import routes from "./routes.js";
import { seed } from "./seed.js";

seed();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.use("/api", routes);

const clientDir = path.resolve(process.cwd(), "dist/client");
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.use((_req, res) => res.sendFile(path.join(clientDir, "index.html")));
}

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : "internal error";
  res.status(500).json({ error: message });
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`GiteeHelper development server listening on http://127.0.0.1:${config.port}`);
});
