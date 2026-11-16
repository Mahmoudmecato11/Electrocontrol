import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  DEFAULT_PCB_PRICING,
  DEFAULT_SITE_DATA,
  type InquiryItem,
  type InquiryStatus,
  type SiteStoreData,
} from './src/shared/siteData.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'site-data.json');
const UPLOADS_DIR = path.resolve(__dirname, 'public', 'uploads');
const ASSETS_IMAGES_DIR = path.resolve(__dirname, 'src', 'assets', 'images');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function loadStore(): SiteStoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<SiteStoreData>;
      return {
        config: {
          ...DEFAULT_SITE_DATA.config,
          ...(parsed.config ?? {}),
          pcbPricing: {
            ...DEFAULT_PCB_PRICING,
            ...(parsed.config?.pcbPricing ?? {}),
          },
        },
        services: Array.isArray(parsed.services) ? parsed.services : DEFAULT_SITE_DATA.services,
        projects: Array.isArray(parsed.projects) ? parsed.projects : DEFAULT_SITE_DATA.projects,
        inquiries: Array.isArray(parsed.inquiries) ? parsed.inquiries : DEFAULT_SITE_DATA.inquiries,
        media: Array.isArray(parsed.media) && parsed.media.length > 0 ? parsed.media : DEFAULT_SITE_DATA.media,
        adminPassword: parsed.adminPassword || DEFAULT_SITE_DATA.adminPassword,
      };
    }
  } catch (err) {
    console.error('Failed to read site-data.json, initializing defaults:', err);
  }
  saveStore(DEFAULT_SITE_DATA);
  return structuredClone(DEFAULT_SITE_DATA);
}

function saveStore(data: SiteStoreData): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

const activeTokens = new Set<string>();

function createSessionToken(): string {
  const token = crypto.randomBytes(24).toString('hex');
  activeTokens.add(token);
  return token;
}

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  const token = req.header('x-admin-token');
  if (!token || !activeTokens.has(token)) {
    res.status(401).json({ error: 'غير مصرح. يرجى تسجيل الدخول للوحة التحكم.' });
    return;
  }
  next();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.use('/uploads', express.static(UPLOADS_DIR));
  app.use('/src/assets/images', express.static(ASSETS_IMAGES_DIR));

  // Public site content
  app.get('/api/site', (_req, res) => {
    const store = loadStore();
    res.json({
      config: store.config,
      services: store.services,
      projects: store.projects,
      media: store.media,
    });
  });

  // Admin auth
  app.post('/api/auth/login', (req, res) => {
    const { password } = (req.body ?? {}) as { password?: string };
    const store = loadStore();
    if (!password || password !== store.adminPassword) {
      res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
      return;
    }
    const token = createSessionToken();
    res.json({ ok: true, token });
  });

  app.post('/api/auth/verify', (req, res) => {
    const token = req.header('x-admin-token');
    if (token && activeTokens.has(token)) {
      res.json({ ok: true });
      return;
    }
    res.status(401).json({ ok: false });
  });

  app.post('/api/auth/password', requireAdmin, (req, res) => {
    const { newPassword } = (req.body ?? {}) as { newPassword?: string };
    if (!newPassword || newPassword.trim().length < 4) {
      res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل' });
      return;
    }
    const store = loadStore();
    store.adminPassword = newPassword.trim();
    saveStore(store);
    res.json({ ok: true });
  });

  // Update public site config / services / projects
  app.put('/api/site', requireAdmin, (req, res) => {
    const body = (req.body ?? {}) as Partial<SiteStoreData>;
    const store = loadStore();

    if (body.config) {
      store.config = { ...store.config, ...body.config };
    }
    if (Array.isArray(body.services)) {
      store.services = body.services;
    }
    if (Array.isArray(body.projects)) {
      store.projects = body.projects;
    }
    if (Array.isArray(body.media)) {
      store.media = body.media;
    }

    saveStore(store);
    res.json({
      config: store.config,
      services: store.services,
      projects: store.projects,
      media: store.media,
    });
  });

  app.post('/api/site/reset', requireAdmin, (_req, res) => {
    const current = loadStore();
    const resetData: SiteStoreData = {
      ...structuredClone(DEFAULT_SITE_DATA),
      inquiries: current.inquiries,
      adminPassword: current.adminPassword,
    };
    saveStore(resetData);
    res.json({
      config: resetData.config,
      services: resetData.services,
      projects: resetData.projects,
      media: resetData.media,
    });
  });

  // Image upload endpoint for real user photos
  app.post('/api/upload', requireAdmin, (req, res) => {
    const { filename, dataUrl, label } = (req.body ?? {}) as {
      filename?: string;
      dataUrl?: string;
      label?: string;
    };

    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'بيانات الصورة غير صالحة' });
      return;
    }

    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      res.status(400).json({ error: 'يرجى رفع صورة بصيغة PNG أو JPG أو WEBP فقط' });
      return;
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      res.status(400).json({ error: 'حجم الصورة يتجاوز الحد المسموح (5 ميجابايت)' });
      return;
    }

    const safeBase = (filename || 'photo')
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 40);
    const outName = `${safeBase || 'upload'}_${Date.now()}.${ext}`;
    const outPath = path.join(UPLOADS_DIR, outName);
    fs.writeFileSync(outPath, buffer);

    const url = `/uploads/${outName}`;
    const store = loadStore();
    const asset = {
      id: `m-${Date.now()}`,
      label: label?.trim() || filename || 'صورة مرفوعة',
      url,
      uploadedAt: new Date().toISOString().slice(0, 10),
    };
    store.media = [asset, ...store.media];
    saveStore(store);

    res.json({ asset, media: store.media });
  });

  // Client quote / inspection requests
  app.get('/api/inquiries', requireAdmin, (_req, res) => {
    const store = loadStore();
    res.json({ inquiries: store.inquiries });
  });

  app.post('/api/inquiries', (req, res) => {
    const body = (req.body ?? {}) as Partial<InquiryItem>;
    const name = (body.name || '').trim();
    const phone = (body.phone || '').trim();
    const requestType = (body.requestType || '').trim();
    const details = (body.details || '').trim();

    if (!name || !phone || !details) {
      res.status(400).json({ error: 'يرجى كتابة الاسم ورقم الهاتف وتفاصيل الطلب' });
      return;
    }

    const store = loadStore();
    const item: InquiryItem = {
      id: `inq-${Date.now()}`,
      name,
      company: (body.company || '').trim(),
      phone,
      email: (body.email || '').trim(),
      requestType: requestType || 'استفسار عام',
      details,
      status: 'جديد',
      notes: '',
      createdAt: new Date().toISOString(),
    };

    store.inquiries = [item, ...store.inquiries];
    saveStore(store);
    res.status(201).json({ inquiry: item });
  });

  app.patch('/api/inquiries/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const { status, notes } = (req.body ?? {}) as { status?: InquiryStatus; notes?: string };
    const store = loadStore();
    const idx = store.inquiries.findIndex((i) => i.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'الطلب غير موجود' });
      return;
    }
    if (status) {
      store.inquiries[idx].status = status;
    }
    if (typeof notes === 'string') {
      store.inquiries[idx].notes = notes;
    }
    saveStore(store);
    res.json({ inquiry: store.inquiries[idx] });
  });

  app.delete('/api/inquiries/:id', requireAdmin, (req, res) => {
    const { id } = req.params;
    const store = loadStore();
    store.inquiries = store.inquiries.filter((i) => i.id !== id);
    saveStore(store);
    res.json({ ok: true });
  });

  // Vite or static serving
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd && fs.existsSync(path.resolve(__dirname, 'vite.config.ts'))) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const portArgIdx = process.argv.indexOf('--port');
  const cliPort = portArgIdx !== -1 ? Number(process.argv[portArgIdx + 1]) : NaN;
  const envPort =
    process.env.PORT && process.env.PORT !== process.env.NGINX_PORT
      ? Number(process.env.PORT)
      : NaN;
  const PORT = cliPort || envPort || Number(process.env.DEFAULT_APP_PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Electro Control server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
