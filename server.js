const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { S3Client, DeleteObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const express = require("express");
const { Pool } = require("pg");

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_PASSWORD_SHA256 = process.env.ADMIN_PASSWORD_SHA256;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL;
const SITE_SLUG = slugify(process.env.SITE_SLUG || "hyungjuncho") || "hyungjuncho";
const PRIMARY_SITE_SLUG = "hyungjuncho";
const COOKIE_NAME = `${SITE_SLUG}_admin_session`;
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;

const defaultPublications = [];
const PRUNED_PUBLICATION_TITLES = new Set([
  "Human-AI Alignment in Real-Time Decision Support",
  "Designing Interfaces for Trust Calibration in AI Systems",
  "Explainable Policy Learning for Clinical Triage",
  "A Benchmark for Reasoning Transparency",
  "Human-Centered Evaluation of Generative Research Tools",
]);

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

const defaultProjects = [
  {
    id: "project-1",
    title: "Trust-Aware Scientific Assistant",
    venue: "Research System",
    summary: "An interface prototype for research workflows that exposes uncertainty, provenance, and verification cues.",
    description:
      "A longer project description can live here for future detail pages, editor notes, or expanded project context.",
    heroImage: "./hero.jpg",
    galleryImages: [],
  },
  {
    id: "project-2",
    title: "Public Interest Model Observatory",
    venue: "Monitoring",
    summary: "Ongoing work tracking behavioral drift and social impact patterns in deployed foundation models.",
    description:
      "This placeholder project gives the Projects tab enough visual structure before final images and copy are added.",
    heroImage: "./hero.jpg",
    galleryImages: [],
  },
];

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

const r2Configured = Boolean(
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET && R2_PUBLIC_BASE_URL
);

const r2Client = r2Configured
  ? new S3Client({
      region: "auto",
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

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

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function getScopedContentKey(key) {
  return `${SITE_SLUG}:${key}`;
}

function getProjectAssetKey(filename = "upload") {
  const extension = path.extname(filename).toLowerCase() || ".bin";
  const base = slugify(path.basename(filename, extension)) || "image";
  return `${SITE_SLUG}/projects/${Date.now()}-${crypto.randomUUID()}-${base}${extension}`;
}

function getPublicAssetUrl(key) {
  return `${String(R2_PUBLIC_BASE_URL).replace(/\/+$/, "")}/${key}`;
}

function getAssetKeyFromUrl(url) {
  const base = `${String(R2_PUBLIC_BASE_URL).replace(/\/+$/, "")}/`;
  if (!url.startsWith(base)) {
    return null;
  }

  return url.slice(base.length);
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
        (typeof item.id === "undefined" || typeof item.id === "string") &&
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

function validateProjects(payload) {
  if (!Array.isArray(payload)) {
    return false;
  }

  return payload.every((project) => {
    return (
      project &&
      typeof project.id === "string" &&
      typeof project.title === "string" &&
      typeof project.venue === "string" &&
      typeof project.summary === "string" &&
      typeof project.description === "string" &&
      Array.isArray(project.outputs) &&
      project.outputs.every(
        (output) =>
          output &&
          typeof output.label === "string" &&
          typeof output.doiUrl === "string" &&
          typeof output.pdfUrl === "string"
      ) &&
      typeof (project.videoUrl || "") === "string" &&
      typeof project.heroImage === "string" &&
      Array.isArray(project.galleryImages) &&
      project.galleryImages.every((image) => typeof image === "string")
    );
  });
}

function generateContentId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function flattenPublicationGroups(groups) {
  return groups.flatMap((group) =>
    group.items.map((item) => ({
      id: typeof item.id === "string" && item.id ? item.id : generateContentId("publication"),
      year: group.year,
      title: item.title,
      authors: item.authors,
      venue: item.venue,
      award: item.award || "",
    }))
  );
}

function groupPublicationItems(items) {
  const grouped = [];
  let current = null;

  items.forEach((item) => {
    if (!current || current.year !== item.year) {
      current = {
        year: item.year,
        items: [],
      };
      grouped.push(current);
    }

    current.items.push({
      id: item.id,
      title: item.title,
      authors: item.authors,
      venue: item.venue,
      award: item.award || "",
    });
  });

  return grouped;
}

async function loadSiteContent(key, fallbackValue) {
  const scopedKey = getScopedContentKey(key);
  const { rows } = await pool.query("SELECT value FROM site_content WHERE key = $1", [scopedKey]);
  if (rows.length > 0) {
    return rows[0].value;
  }

  if (SITE_SLUG === PRIMARY_SITE_SLUG) {
    const legacyRows = await pool.query("SELECT value FROM site_content WHERE key = $1", [key]);
    if (legacyRows.rows.length > 0) {
      await saveSiteContent(key, legacyRows.rows[0].value);
      return legacyRows.rows[0].value;
    }
  }

  return fallbackValue;
}

async function saveSiteContent(key, value) {
  await pool.query(
    `
      INSERT INTO site_content (key, value, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `,
    [getScopedContentKey(key), JSON.stringify(value)]
  );
}

async function loadAbout() {
  return loadSiteContent("about", defaultAbout);
}

async function saveAbout(about) {
  await saveSiteContent("about", about);
}

async function loadPublicationLibrary() {
  const { rows } = await pool.query(
    `
      SELECT id, publication_year, title, authors, venue, award
      FROM publications_master
      ORDER BY updated_at DESC, created_at DESC
    `
  );

  return rows.map((row) => ({
    id: row.id,
    year: row.publication_year,
    title: row.title,
    authors: row.authors,
    venue: row.venue,
    award: row.award || "",
  }));
}

async function savePublicationLibraryItems(items) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const item of items) {
      await client.query(
        `
          INSERT INTO publications_master (
            id,
            publication_year,
            title,
            authors,
            venue,
            award,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (id)
          DO UPDATE SET
            publication_year = EXCLUDED.publication_year,
            title = EXCLUDED.title,
            authors = EXCLUDED.authors,
            venue = EXCLUDED.venue,
            award = EXCLUDED.award,
            updated_at = NOW()
        `,
        [item.id, item.year, item.title, item.authors, item.venue, item.award || ""]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadLegacyPublicationsForSite() {
  const { rows } = await pool.query(
    `
      SELECT publication_year, title, authors, venue, award
      FROM publications
      WHERE site_slug = $1
      ORDER BY year_sort_order ASC, item_sort_order ASC
    `,
    [SITE_SLUG]
  );

  return rows.map((row) => ({
    id: generateContentId("publication"),
    year: row.publication_year,
    title: row.title,
    authors: row.authors,
    venue: row.venue,
    award: row.award || "",
  }));
}

async function loadPublications() {
  const selectedIds = await loadSiteContent("publication-ids", null);
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    const legacyPublications = await loadLegacyPublicationsForSite();
    if (legacyPublications.length > 0) {
      await savePublicationLibraryItems(legacyPublications);
      await saveSiteContent(
        "publication-ids",
        legacyPublications.map((item) => item.id)
      );
      return groupPublicationItems(legacyPublications);
    }
    return [];
  }

  const { rows } = await pool.query(
    `
      SELECT id, publication_year, title, authors, venue, award
      FROM publications_master
      WHERE id = ANY($1::text[])
    `,
    [selectedIds]
  );

  const itemMap = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        year: row.publication_year,
        title: row.title,
        authors: row.authors,
        venue: row.venue,
        award: row.award || "",
      },
    ])
  );

  const selectedItems = selectedIds.map((id) => itemMap.get(id)).filter(Boolean);
  const legacyPublications = await loadLegacyPublicationsForSite();
  if (legacyPublications.length > selectedItems.length) {
    await savePublicationLibraryItems(legacyPublications);
    await saveSiteContent(
      "publication-ids",
      legacyPublications.map((item) => item.id)
    );
    return groupPublicationItems(legacyPublications);
  }

  return groupPublicationItems(selectedItems);
}

async function replacePublications(publications) {
  const items = flattenPublicationGroups(publications);
  await savePublicationLibraryItems(items);
  await saveSiteContent(
    "publication-ids",
    items.map((item) => item.id)
  );
}

async function purgePrunedPublications() {
  const { rows } = await pool.query(
    `
      SELECT id
      FROM publications_master
      WHERE title = ANY($1::text[])
    `,
    [[...PRUNED_PUBLICATION_TITLES]]
  );

  if (rows.length === 0) {
    await pool.query("DELETE FROM publications WHERE title = ANY($1::text[])", [[...PRUNED_PUBLICATION_TITLES]]);
    return;
  }

  const idsToRemove = rows.map((row) => row.id);
  await pool.query("DELETE FROM publications_master WHERE id = ANY($1::text[])", [idsToRemove]);
  await pool.query("DELETE FROM publications WHERE title = ANY($1::text[])", [[...PRUNED_PUBLICATION_TITLES]]);

  const selectionRows = await pool.query(
    `
      SELECT key, value
      FROM site_content
      WHERE key LIKE '%:publication-ids'
    `
  );

  for (const row of selectionRows.rows) {
    const currentIds = Array.isArray(row.value) ? row.value : [];
    const nextIds = currentIds.filter((id) => !idsToRemove.includes(id));
    if (nextIds.length !== currentIds.length) {
      await pool.query(
        `
          UPDATE site_content
          SET value = $2::jsonb, updated_at = NOW()
          WHERE key = $1
        `,
        [row.key, JSON.stringify(nextIds)]
      );
    }
  }
}

function normalizeProjectOutputs(project) {
  if (Array.isArray(project.outputs)) {
    return project.outputs.map((output, index) => ({
      label: output.label || `Paper ${index + 1}`,
      doiUrl: output.doiUrl || "",
      pdfUrl: output.pdfUrl || "",
    }));
  }

  const legacyOutputs = [];
  if (project.doiUrl || project.pdfUrl) {
    legacyOutputs.push({
      label: "Paper 1",
      doiUrl: project.doiUrl || "",
      pdfUrl: project.pdfUrl || "",
    });
  }

  return legacyOutputs;
}

function normalizeProject(project) {
  return {
    id: project.id || generateContentId("project"),
    title: project.title,
    venue: project.venue,
    summary: project.summary,
    description: project.description,
    outputs: normalizeProjectOutputs(project),
    videoUrl:
      project.videoUrl ||
      (Array.isArray(project.outputs)
        ? project.outputs.find((output) => output.videoUrl)?.videoUrl || ""
        : ""),
    heroImage: project.heroImage || "",
    galleryImages: Array.isArray(project.galleryImages) ? project.galleryImages : [],
  };
}

async function loadProjectLibrary() {
  const { rows } = await pool.query(
    `
      SELECT id, title, venue, summary, description, outputs, doi_url, pdf_url, video_url, hero_image, gallery_images
      FROM projects_master
      ORDER BY updated_at DESC, created_at DESC
    `
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    venue: row.venue,
    summary: row.summary,
    description: row.description,
    outputs: normalizeProjectOutputs({
      outputs: Array.isArray(row.outputs) ? row.outputs : [],
      doiUrl: row.doi_url || "",
      pdfUrl: row.pdf_url || "",
    }),
    videoUrl: row.video_url || "",
    heroImage: row.hero_image || "",
    galleryImages: Array.isArray(row.gallery_images) ? row.gallery_images : [],
  }));
}

async function saveProjectLibraryItems(projects) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const project of projects.map(normalizeProject)) {
      await client.query(
        `
          INSERT INTO projects_master (
            id,
            title,
            venue,
            summary,
            description,
            outputs,
            doi_url,
            pdf_url,
            video_url,
            hero_image,
            gallery_images,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11::jsonb, NOW())
          ON CONFLICT (id)
          DO UPDATE SET
            title = EXCLUDED.title,
            venue = EXCLUDED.venue,
            summary = EXCLUDED.summary,
            description = EXCLUDED.description,
            outputs = EXCLUDED.outputs,
            doi_url = EXCLUDED.doi_url,
            pdf_url = EXCLUDED.pdf_url,
            video_url = EXCLUDED.video_url,
            hero_image = EXCLUDED.hero_image,
            gallery_images = EXCLUDED.gallery_images,
            updated_at = NOW()
        `,
        [
          project.id,
          project.title,
          project.venue,
          project.summary,
          project.description,
          JSON.stringify(project.outputs),
          project.outputs[0]?.doiUrl || "",
          project.outputs[0]?.pdfUrl || "",
          project.videoUrl || "",
          project.heroImage,
          JSON.stringify(project.galleryImages),
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function loadLegacyProjectsForSite() {
  if (SITE_SLUG === PRIMARY_SITE_SLUG) {
    const legacyRows = await pool.query("SELECT value FROM site_content WHERE key = 'projects'");
    if (legacyRows.rows.length > 0 && Array.isArray(legacyRows.rows[0].value)) {
      return legacyRows.rows[0].value.map(normalizeProject);
    }
  }

  const scopedRows = await pool.query("SELECT value FROM site_content WHERE key = $1", [getScopedContentKey("projects")]);
  if (scopedRows.rows.length > 0 && Array.isArray(scopedRows.rows[0].value)) {
    return scopedRows.rows[0].value.map(normalizeProject);
  }

  return [];
}

async function loadProjects() {
  const selectedIds = await loadSiteContent("project-ids", null);
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    const legacyProjects = await loadLegacyProjectsForSite();
    if (legacyProjects.length > 0) {
      await saveProjects(legacyProjects);
      return legacyProjects;
    }
    return [];
  }

  const { rows } = await pool.query(
    `
      SELECT id, title, venue, summary, description, outputs, doi_url, pdf_url, video_url, hero_image, gallery_images
      FROM projects_master
      WHERE id = ANY($1::text[])
    `,
    [selectedIds]
  );

  const projectMap = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        title: row.title,
        venue: row.venue,
        summary: row.summary,
        description: row.description,
        outputs: normalizeProjectOutputs({
          outputs: Array.isArray(row.outputs) ? row.outputs : [],
          doiUrl: row.doi_url || "",
          pdfUrl: row.pdf_url || "",
        }),
        videoUrl: row.video_url || "",
        heroImage: row.hero_image || "",
        galleryImages: Array.isArray(row.gallery_images) ? row.gallery_images : [],
      },
    ])
  );

  const selectedProjects = selectedIds.map((id) => projectMap.get(id)).filter(Boolean);
  const legacyProjects = await loadLegacyProjectsForSite();
  if (legacyProjects.length > selectedProjects.length) {
    await saveProjects(legacyProjects);
    return legacyProjects;
  }

  return selectedProjects;
}

async function saveProjects(projects) {
  const normalized = projects.map(normalizeProject);
  await saveProjectLibraryItems(normalized);
  await saveSiteContent(
    "project-ids",
    normalized.map((project) => project.id)
  );
}

async function ensureSchema() {
  const schemaPath = path.join(process.cwd(), "db", "schema.sql");
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  await pool.query(schemaSql);
  await pool.query("ALTER TABLE publications ADD COLUMN IF NOT EXISTS site_slug TEXT");
  await pool.query("UPDATE publications SET site_slug = $1 WHERE site_slug IS NULL OR site_slug = ''", [PRIMARY_SITE_SLUG]);
  await pool.query("CREATE INDEX IF NOT EXISTS publications_site_year_sort_idx ON publications (site_slug, year_sort_order, item_sort_order)");
  await pool.query("ALTER TABLE projects_master ADD COLUMN IF NOT EXISTS outputs JSONB NOT NULL DEFAULT '[]'::jsonb");
  await pool.query("ALTER TABLE projects_master ADD COLUMN IF NOT EXISTS doi_url TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE projects_master ADD COLUMN IF NOT EXISTS pdf_url TEXT NOT NULL DEFAULT ''");
  await pool.query("ALTER TABLE projects_master ADD COLUMN IF NOT EXISTS video_url TEXT NOT NULL DEFAULT ''");
  await purgePrunedPublications();

  const publicationSelectionRows = await pool.query("SELECT COUNT(*)::int AS count FROM site_content WHERE key = $1", [
    getScopedContentKey("publication-ids"),
  ]);
  if (publicationSelectionRows.rows[0].count === 0) {
    const legacyPublications = await loadLegacyPublicationsForSite();
    if (legacyPublications.length > 0) {
      await savePublicationLibraryItems(legacyPublications);
      await saveSiteContent(
        "publication-ids",
        legacyPublications.map((item) => item.id)
      );
    } else {
      await replacePublications(defaultPublications);
    }
  }

  const selectedPublicationIds = await loadSiteContent("publication-ids", []);
  if (Array.isArray(selectedPublicationIds) && selectedPublicationIds.length > 0) {
    const publicationMasterRows = await pool.query(
      "SELECT COUNT(*)::int AS count FROM publications_master WHERE id = ANY($1::text[])",
      [selectedPublicationIds]
    );
    if (publicationMasterRows.rows[0].count < selectedPublicationIds.length) {
      const legacyPublications = await loadLegacyPublicationsForSite();
      if (legacyPublications.length > 0) {
        await savePublicationLibraryItems(legacyPublications);
        await saveSiteContent(
          "publication-ids",
          legacyPublications.map((item) => item.id)
        );
      }
    }
  }

  const aboutRows = await pool.query("SELECT COUNT(*)::int AS count FROM site_content WHERE key = $1", [getScopedContentKey("about")]);
  if (aboutRows.rows[0].count === 0) {
    if (SITE_SLUG === PRIMARY_SITE_SLUG) {
      await loadAbout();
    } else {
      await saveAbout(defaultAbout);
    }
  }

  const projectSelectionRows = await pool.query("SELECT COUNT(*)::int AS count FROM site_content WHERE key = $1", [
    getScopedContentKey("project-ids"),
  ]);
  if (projectSelectionRows.rows[0].count === 0) {
    const legacyProjects = await loadLegacyProjectsForSite();
    if (legacyProjects.length > 0) {
      await saveProjects(legacyProjects);
    } else {
      await saveProjects(defaultProjects);
    }
  }

  const selectedProjectIds = await loadSiteContent("project-ids", []);
  if (Array.isArray(selectedProjectIds) && selectedProjectIds.length > 0) {
    const projectMasterRows = await pool.query(
      "SELECT COUNT(*)::int AS count FROM projects_master WHERE id = ANY($1::text[])",
      [selectedProjectIds]
    );
    if (projectMasterRows.rows[0].count < selectedProjectIds.length) {
      const legacyProjects = await loadLegacyProjectsForSite();
      if (legacyProjects.length > 0) {
        await saveProjects(legacyProjects);
      }
    }
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
    const library = await loadPublicationLibrary();
    res.json({ publications, library });
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

app.get("/api/projects", async (_req, res) => {
  try {
    const projects = await loadProjects();
    const library = await loadProjectLibrary();
    res.json({ projects, library });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to load projects." });
  }
});

app.post("/api/projects/upload-url", authMiddleware, async (req, res) => {
  if (!r2Configured || !r2Client) {
    res.status(503).json({ error: "R2 storage is not configured yet." });
    return;
  }

  const filename = req.body?.filename;
  const contentType = req.body?.contentType;
  if (typeof filename !== "string" || typeof contentType !== "string") {
    res.status(400).json({ error: "filename and contentType are required." });
    return;
  }

  try {
    const key = getProjectAssetKey(filename);
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 60 * 5 });
    res.json({
      uploadUrl,
      publicUrl: getPublicAssetUrl(key),
      key,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to prepare upload." });
  }
});

app.post("/api/projects/delete-image", authMiddleware, async (req, res) => {
  if (!r2Configured || !r2Client) {
    res.status(503).json({ error: "R2 storage is not configured yet." });
    return;
  }

  const imageUrl = req.body?.imageUrl;
  if (typeof imageUrl !== "string") {
    res.status(400).json({ error: "imageUrl is required." });
    return;
  }

  const key = getAssetKeyFromUrl(imageUrl);
  if (!key) {
    res.status(400).json({ error: "Image URL does not belong to configured R2 storage." });
    return;
  }

  try {
    await r2Client.send(
      new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
      })
    );
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete image." });
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
    const library = await loadPublicationLibrary();
    res.json({ publications, library });
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

app.put("/api/projects", authMiddleware, async (req, res) => {
  const projects = req.body?.projects;

  if (!validateProjects(projects)) {
    res.status(400).json({ error: "Invalid project payload." });
    return;
  }

  try {
    await saveProjects(projects);
    res.json({ projects: await loadProjects(), library: await loadProjectLibrary() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save projects." });
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
