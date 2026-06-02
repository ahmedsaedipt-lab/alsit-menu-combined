/* ============================================================
   Al-Sit menu · MULTI-BRANCH server (one app, two menus)
   ------------------------------------------------------------
   Branch 1  (root):
     GET  /                  -> menu page
     GET  /admin             -> admin dashboard
     GET  /api/menu          -> branch 1 menu JSON
     POST /api/menu          -> overwrite branch 1 menu  (admin)
     POST /api/login         -> { ok:true } if password correct
     POST /api/upload        -> image upload -> { url:"/uploads/.." }
     GET  /uploads/<file>    -> branch 1 uploaded image

   Branch 2  (prefix /branch2):
     GET  /branch2           -> menu page
     GET  /branch2/admin     -> admin dashboard
     GET  /branch2/api/menu  -> branch 2 menu JSON
     POST /branch2/api/menu  -> overwrite branch 2 menu (admin)
     POST /branch2/api/login -> { ok:true }
     POST /branch2/api/upload-> image upload -> { url:"/branch2/uploads/.." }
     GET  /branch2/uploads/<file> -> branch 2 uploaded image

   Shared static assets (logos, video) live in /public and are
   served from the site root (e.g. /logo-256.png).
   ============================================================ */
const express = require("express");
const multer  = require("multer");
const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");

const app  = express();
const PORT = process.env.PORT || 8000;
const HOST = "0.0.0.0";

app.set("trust proxy", 1);

const ROOT       = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_ROOT  = path.join(ROOT, "data");
const UPLOAD_ROOT= path.join(ROOT, "uploads");

// One shared admin password (override with env). You can also use
// ADMIN_PASSWORD_BRANCH1 / ADMIN_PASSWORD_BRANCH2 for separate passwords.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "alsit2026";

// ---- branch registry -------------------------------------------
const BRANCHES = {
  branch1: {
    base: "",                                   // served at site root
    dataFile: path.join(DATA_ROOT, "branch1", "menu.json"),
    backupDir: path.join(DATA_ROOT, "branch1", ".backups"),
    uploadDir: path.join(UPLOAD_ROOT, "branch1"),
    password: process.env.ADMIN_PASSWORD_BRANCH1 || ADMIN_PASSWORD,
  },
  branch2: {
    base: "/branch2",
    dataFile: path.join(DATA_ROOT, "branch2", "menu.json"),
    backupDir: path.join(DATA_ROOT, "branch2", ".backups"),
    uploadDir: path.join(UPLOAD_ROOT, "branch2"),
    password: process.env.ADMIN_PASSWORD_BRANCH2 || ADMIN_PASSWORD,
  },
};

// make sure upload dirs exist
Object.values(BRANCHES).forEach(b => {
  if (!fs.existsSync(b.uploadDir)) fs.mkdirSync(b.uploadDir, { recursive: true });
});

// ---- middleware -------------------------------------------------
app.use(express.json({ limit: "1mb" }));

// ---- helpers ----------------------------------------------------
function readMenu(branch){
  try { return JSON.parse(fs.readFileSync(branch.dataFile, "utf8")); }
  catch (e){ return null; }
}
function writeMenu(branch, obj){
  try {
    if (!fs.existsSync(branch.backupDir)) fs.mkdirSync(branch.backupDir, { recursive: true });
    if (fs.existsSync(branch.dataFile)){
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.copyFileSync(branch.dataFile, path.join(branch.backupDir, `menu.${stamp}.json`));
    }
  } catch (e){ /* non-fatal */ }
  fs.writeFileSync(branch.dataFile, JSON.stringify(obj, null, 2), "utf8");
}
function makeRequireAdmin(branch){
  return function(req, res, next){
    const pass = req.get("x-admin-pass") || (req.body && req.body.password);
    if (pass && pass === branch.password) return next();
    return res.status(401).json({ ok:false, error:"unauthorized" });
  };
}

// ---- upload config (shared) ------------------------------------
const ALLOWED_MIME = new Set(["image/jpeg","image/png","image/webp","image/gif"]);
const EXT_BY_MIME  = { "image/jpeg":".jpg", "image/png":".png", "image/webp":".webp", "image/gif":".gif" };
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter(req, file, cb){
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new Error("نوع الملف غير مدعوم. استخدم JPG / PNG / WEBP / GIF."));
  }
});

// ---- HTML page serving (inject branch base) --------------------
function servePage(fileName){
  return function(branch){
    return function(req, res){
      let html;
      try { html = fs.readFileSync(path.join(PUBLIC_DIR, fileName), "utf8"); }
      catch (e){ return res.status(500).send("page missing"); }
      html = html.replace(/__BRANCH_BASE__/g, branch.base);
      res.set("Cache-Control", "no-store");
      res.type("html").send(html);
    };
  };
}
const serveIndex = servePage("index.html");
const serveAdmin = servePage("admin.html");

// ---- mount routes for one branch -------------------------------
function mountBranch(branch){
  const base = branch.base;            // "" or "/branch2"
  const requireAdmin = makeRequireAdmin(branch);

  // pages
  app.get(base === "" ? "/" : base, serveIndex(branch));
  app.get(base + "/admin", serveAdmin(branch));

  // public menu
  app.get(base + "/api/menu", (req, res) => {
    const data = readMenu(branch);
    if (!data) return res.status(500).json({ ok:false, error:"menu missing" });
    res.set("Cache-Control", "no-store");
    res.json(data);
  });

  // login
  app.post(base + "/api/login", (req, res) => {
    const pass = (req.body && req.body.password) || req.get("x-admin-pass");
    if (pass === branch.password) return res.json({ ok:true });
    res.status(401).json({ ok:false });
  });

  // save menu
  app.post(base + "/api/menu", requireAdmin, (req, res) => {
    const incoming = req.body && req.body.menu;
    if (!incoming || !Array.isArray(incoming.blocks)){
      return res.status(400).json({ ok:false, error:"invalid menu shape" });
    }
    try {
      writeMenu(branch, incoming);
      res.json({ ok:true, savedAt: new Date().toISOString() });
    } catch (e){
      res.status(500).json({ ok:false, error: String(e && e.message || e) });
    }
  });

  // upload (returns branch-aware url)
  app.post(base + "/api/upload", requireAdmin, (req, res) => {
    upload.single("image")(req, res, (err) => {
      if (err) return res.status(400).json({ ok:false, error: err.message });
      if (!req.file) return res.status(400).json({ ok:false, error:"no file" });
      try {
        const ext  = EXT_BY_MIME[req.file.mimetype] || ".bin";
        const id   = crypto.randomBytes(8).toString("hex");
        const name = `offer-${Date.now()}-${id}${ext}`;
        fs.writeFileSync(path.join(branch.uploadDir, name), req.file.buffer);
        res.json({ ok:true, url: base + "/uploads/" + name });
      } catch (e){
        res.status(500).json({ ok:false, error: String(e && e.message || e) });
      }
    });
  });

  // uploaded images
  app.use(base + "/uploads", express.static(branch.uploadDir, {
    maxAge: "30d",
    setHeaders(res){ res.set("Cache-Control", "public, max-age=2592000, immutable"); }
  }));
}

// IMPORTANT: mount branch2 (longer prefix) before branch1 root
mountBranch(BRANCHES.branch2);
mountBranch(BRANCHES.branch1);

// ---- shared static assets (logos, video) at root --------------
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, file){
    if (file.endsWith(".html")) res.set("Cache-Control", "no-store");
  }
}));

// ---- health check ----------------------------------------------
app.get("/health", (req, res) => res.json({ ok:true, ts: Date.now() }));

// ---- start ------------------------------------------------------
app.listen(PORT, HOST, () => {
  console.log(`\n  مقهى الست  ·  multi-branch menu server`);
  console.log(`  ──────────────────────────────────────`);
  console.log(`  branch 1 :  http://localhost:${PORT}/`);
  console.log(`  admin 1  :  http://localhost:${PORT}/admin`);
  console.log(`  branch 2 :  http://localhost:${PORT}/branch2`);
  console.log(`  admin 2  :  http://localhost:${PORT}/branch2/admin`);
  console.log(`  pass     :  ${ADMIN_PASSWORD}   (override with ADMIN_PASSWORD env)\n`);
});
