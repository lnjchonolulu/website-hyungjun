const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const express = require("express");
const { Pool } = require("pg");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_PASSWORD_SHA256 = process.env.ADMIN_PASSWORD_SHA256;
const COOKIE_NAME = "hjc_admin_session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;

const defaultPublications = [
  {
    year: "2025",
    items: [
      {
        title: "Explainable Policy Learning for Clinical Triage",
        authors: "Hyungjun Cho, Coauthors",
        venue: "NeurIPS 2025",
        award: "",
      },
    ],
  },
  {
    year: "2024",
    items: [
      {
        title: "Human-AI Alignment in Real-Time Decision Support",
        authors: "Hyungjun Cho, Jiyeon Amy Seo, Woosuk Seo",
        venue: "CHI 2024",
        award: "Best Paper Honorable Mention Award (Top 5% of submissions)",
      },
      {
        title: "Designing Interfaces for Trust Calibration in AI Systems",
        authors: "Hyungjun Cho, Collaborators",
        venue: "DIS 2024",
        award: "",
      },
    ],
  },
  {
    year: "2023",
    items: [
      {
        title: "A Benchmark for Reasoning Transparency",
        authors: "Hyungjun Cho, Coauthors",
        venue: "ACL Findings 2023",
        award: "",
      },
      {
        title: "Human-Centered Evaluation of Generative Research Tools",
        authors: "Hyungjun Cho, Collaborators",
        venue: "UIST Adjunct 2023",
        award: "",
      },
    ],
  },
];

const defaultAbout = {
  education: [
    {
      degree:
        "Ph.D in Industrial Design, Korea Advanced Institute of Science and Technology (KAIST), Feb 2025",
      details: [
        "Dissertation: Design Speculations for Reimagining Human-Thing Relationships",
        "Committee: Tek-Jin Nam (Chair), Hwajung Hong, Changhee Lee, Heekyung Jung, Daisy Yoo",
      ],
    },
    {
      degree:
        "M.S in Industrial Design, Korea Advanced Institute of Science and Technology (KAIST), 2020",
      details: [],
    },
    {
      degree:
        "B.S in Industrial Design, Korea Advanced Institute of Science and Technology (KAIST), 2018",
      details: [],
    },
  ],
  researchInterests: ["Human-AI Interaction"],
  news: [
    { title: "Two papers accepted to DIS 2026", meta: "March 18, 2026" },
    { title: "Received Best Paper Honorable Mention Award 🏅at CHI 2026", meta: "March 8, 2026" },
    { title: "Two papers accepted to CHI 2026", meta: "Jan 15, 2026" },
    {
      title: "Organizing Restoring Human Authenticity in AI-MC Workshop at CHI 2026",
      meta: "Nov 21, 2025",
    },
    { title: "Joined the University of Florida as an Assistant Professor", meta: "Aug 16, 2025" },
    { title: "One paper accepted to RO-MAN 2025", meta: "June 9, 2025" },
    {
      title: "Joined as a visiting scholar at Kyoto University, Japan, working with Dr. Naomi Yamashita",
      meta: "May 26, 2025",
    },
    { title: "Organizing Design Knowledge in AI Workshops at DIS 2025", meta: "May 1, 2025" },
    { title: "Received Best Paper Honorable Mention Award 🏅at CHI 2025", meta: "April 26, 2025" },
  ],
  travel: [
    { title: "Attending DIS 2026 conference, Singapore", meta: "June 13-17, 2026" },
    { title: "Attending CHI 2026 conference, Barcelona, Spain", meta: "April 13-17, 2026" },
    { title: "Attending DIS 2025 conference, Funchal, Madeira", meta: "July 5-9, 2025" },
    { title: "Attending CHI 2025 conference, Yokohama, Japan", meta: "April 26 - May 1, 2024" },
    { title: "Attending DIS 2024 conference, Copenhagen, Denmark", meta: "July 1-5, 2024" },
    { title: "Attending CHI 2024 conference, Honolulu, US", meta: "May 11-16, 2024" },
    { title: "Attending Scalable HCI Symposium, Shenzhen, China", meta: "Jan 7-11, 2024" },
    { title: "Attending DIS 2023 conference, Pittsburgh, US", meta: "July 9-14, 2023" },
    { title: "Attending CHI 2023 conference, Hamburg, US", meta: "April 23-28, 2023" },
  ],
};

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required.");
}

if (!ADMIN_PASSWORD_SHA256) {
  throw new Error("ADMIN_PASSWORD_SHA256 is required.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(process.cwd(), { extensions: ["html"] }));

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timingSafeEqualHex(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createSessionToken() {
  const payload = base64UrlEncode(
    JSON.stringify({
      role: "admin",
      exp: Date.now() + SESSION_MAX_AGE_MS,
    })
  );

  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) {
    return false;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature || sign(payload) !== signature) {
    return false;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload));
    return parsed.role === "admin" && Number(parsed.exp) > Date.now();
  } catch (error) {
    return false;
  }
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) {
      return acc;
    }

    acc[rawKey] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function authMiddleware(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (!verifySessionToken(cookies[COOKIE_NAME])) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

function validatePublications(payload) {
  if (!Array.isArray(payload)) {
    return false;
  }

  return payload.every((group) => {
    if (!group || typeof group.year !== "string" || !Array.isArray(group.items)) {
      return false;
    }

    return group.items.every((item) => {
      return (
        item &&
        typeof item.title === "string" &&
        typeof item.authors === "string" &&
        typeof item.venue === "string" &&
        typeof item.award === "string"
      );
    });
  });
}

function validateAbout(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (
    !Array.isArray(payload.education) ||
    !Array.isArray(payload.researchInterests) ||
    !Array.isArray(payload.news) ||
    !Array.isArray(payload.travel)
  ) {
    return false;
  }

  const validEducation = payload.education.every((entry) => {
    return (
      entry &&
      typeof entry.degree === "string" &&
      Array.isArray(entry.details) &&
      entry.details.every((detail) => typeof detail === "string")
    );
  });

  const validSimpleList = (entries) =>
    entries.every((entry) => entry && typeof entry.title === "string" && typeof entry.meta === "string");

  return (
    validEducation &&
    payload.researchInterests.every((entry) => typeof entry === "string") &&
    validSimpleList(payload.news) &&
    validSimpleList(payload.travel)
  );
}

function groupRows(rows) {
  const grouped = [];
  let current = null;

  rows.forEach((row) => {
    if (!current || current.year !== row.publication_year) {
      current = {
        year: row.publication_year,
        items: [],
      };
      grouped.push(current);
    }

    current.items.push({
      title: row.title,
      authors: row.authors,
      venue: row.venue,
      award: row.award || "",
    });
  });

  return grouped;
}

async function replacePublications(publications) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM publications");

    let yearOrder = 0;
    for (const group of publications) {
      let itemOrder = 0;
      for (const item of group.items) {
        await client.query(
          `
            INSERT INTO publications (
              publication_year,
              year_sort_order,
              item_sort_order,
              title,
              authors,
              venue,
              award
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `,
          [group.year, yearOrder, itemOrder, item.title, item.authors, item.venue, item.award]
        );
        itemOrder += 1;
      }

      yearOrder += 1;
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadPublications() {
  const { rows } = await pool.query(`
    SELECT publication_year, title, authors, venue, award
    FROM publications
    ORDER BY year_sort_order ASC, item_sort_order ASC
  `);

  return groupRows(rows);
}

async function loadAbout() {
  const { rows } = await pool.query("SELECT value FROM site_content WHERE key = 'about'");
  if (rows.length === 0) {
    return defaultAbout;
  }

  return rows[0].value;
}

async function saveAbout(about) {
  await pool.query(
    `
      INSERT INTO site_content (key, value, updated_at)
      VALUES ('about', $1::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [JSON.stringify(about)]
  );
}

async function ensureSchema() {
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(schemaSql);

  const { rows } = await pool.query("SELECT COUNT(*)::int AS count FROM publications");
  if (rows[0].count === 0) {
    await replacePublications(defaultPublications);
  }

  const aboutRows = await pool.query("SELECT COUNT(*)::int AS count FROM site_content WHERE key = 'about'");
  if (aboutRows.rows[0].count === 0) {
    await saveAbout(defaultAbout);
  }
}

app.get("/api/health", async (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/session", (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  res.json({ authenticated: verifySessionToken(cookies[COOKIE_NAME]) });
});

app.post("/api/login", (req, res) => {
  const password = req.body?.password;
  if (typeof password !== "string") {
    res.status(400).json({ error: "Password is required." });
    return;
  }

  const hashed = sha256(password);
  if (!timingSafeEqualHex(hashed, ADMIN_PASSWORD_SHA256)) {
    res.status(401).json({ error: "Invalid password." });
    return;
  }

  const token = createSessionToken();
  const cookie = [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_MAX_AGE_MS / 1000)}`,
  ];

  if (process.env.NODE_ENV === "production") {
    cookie.push("Secure");
  }

  res.setHeader("Set-Cookie", cookie.join("; "));
  res.json({ ok: true });
});

app.post("/api/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`
  );
  res.json({ ok: true });
});

app.get("/api/publications", async (_req, res) => {
  try {
    const publications = await loadPublications();
    res.json({ publications });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load publications." });
  }
});

app.get("/api/about", async (_req, res) => {
  try {
    const about = await loadAbout();
    res.json({ about });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load about content." });
  }
});

app.put("/api/publications", authMiddleware, async (req, res) => {
  const nextPublications = req.body?.publications;

  if (!validatePublications(nextPublications)) {
    res.status(400).json({ error: "Invalid publication payload." });
    return;
  }

  try {
    await replacePublications(nextPublications);
    const publications = await loadPublications();
    res.json({ publications });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save publications." });
  }
});

app.put("/api/about", authMiddleware, async (req, res) => {
  const about = req.body?.about;

  if (!validateAbout(about)) {
    res.status(400).json({ error: "Invalid about payload." });
    return;
  }

  try {
    await saveAbout(about);
    res.json({ about: await loadAbout() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save about content." });
  }
});

app.get("/", (_req, res) => {
  res.sendFile(path.join(process.cwd(), "index.html"));
});

async function start() {
  await ensureSchema();
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
