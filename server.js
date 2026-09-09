const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
// --- Connexion PostgreSQL ---
// Coolify fournit l'URL de connexion via la variable DATABASE_URL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Les bases internes Coolify ne demandent pas de SSL.
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

// --- Réglages par défaut ---
const DEFAULT_SETTINGS = { targetRank: "Émeraude 4", endDate: "2026-10-22" };

// --- Création des tables au démarrage (idempotent) ---
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS entries (
      id         BIGSERIAL PRIMARY KEY,
      pts        INTEGER NOT NULL,
      entry_date DATE NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      target_rank TEXT NOT NULL,
      end_date    DATE NOT NULL,
      CONSTRAINT single_row CHECK (id = 1)
    );
  `);
  await pool.query(
    `INSERT INTO settings (id, target_rank, end_date)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO NOTHING;`,
    [DEFAULT_SETTINGS.targetRank, DEFAULT_SETTINGS.endDate]
  );
  console.log("Base initialisée.");
}

// --- Healthcheck ---
app.get("/api/health", (req, res) => res.json({ ok: true }));

// --- Réglages ---
app.get("/api/settings", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT target_rank, to_char(end_date,'YYYY-MM-DD') AS end_date FROM settings WHERE id = 1"
    );
    const s = rows[0] || DEFAULT_SETTINGS;
    res.json({ targetRank: s.target_rank, endDate: s.end_date });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db_error" });
  }
});

app.put("/api/settings", async (req, res) => {
  const { targetRank, endDate } = req.body || {};
  if (!targetRank || !endDate) return res.status(400).json({ error: "missing_fields" });
  try {
    await pool.query(
      "UPDATE settings SET target_rank = $1, end_date = $2 WHERE id = 1",
      [targetRank, endDate]
    );
    res.json({ targetRank, endDate });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db_error" });
  }
});

// --- Relevés ---
app.get("/api/entries", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, pts, to_char(entry_date,'YYYY-MM-DD') AS date FROM entries ORDER BY entry_date ASC"
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db_error" });
  }
});

// Ajoute ou remplace le relevé d'une date (un seul par jour).
app.post("/api/entries", async (req, res) => {
  const { pts, date } = req.body || {};
  const ptsInt = parseInt(pts, 10);
  if (Number.isNaN(ptsInt) || !date) return res.status(400).json({ error: "invalid" });
  try {
    const { rows } = await pool.query(
      `INSERT INTO entries (pts, entry_date) VALUES ($1, $2)
       ON CONFLICT (entry_date) DO UPDATE SET pts = EXCLUDED.pts
       RETURNING id, pts, to_char(entry_date,'YYYY-MM-DD') AS date;`,
      [ptsInt, date]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db_error" });
  }
});

app.delete("/api/entries/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM entries WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "db_error" });
  }
});

const PORT = process.env.PORT || 3000;
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
  })
  .catch((e) => {
    console.error("Échec init base :", e);
    process.exit(1);
  });
