import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Calculator,
  Check,
  Copy,
  Eye,
  EyeOff,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Images,
  Inbox,
  LayoutDashboard,
  Lock,
  LogOut,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  Upload,
  Wrench,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  calculatePcbEstimate,
  DEFAULT_PCB_PRICING,
  type InquiryItem,
  type InquiryStatus,
  type MediaAsset,
  type PcbPricingConfig,
  type ProjectItem,
  type ServiceCategory,
  type ServiceItem,
  type SiteConfig,
} from '../shared/siteData';
import { ResilientImage } from './ResilientImage';
import { ImageLightbox, type LightboxImageItem } from './ImageLightbox';

interface AdminDashboardProps {
  config: SiteConfig;
  services: ServiceItem[];
  projects: ProjectItem[];
  media: MediaAsset[];
  onDataUpdated: (next: {
    config: SiteConfig;
    services: ServiceItem[];
    projects: ProjectItem[];
    media: MediaAsset[];
  }) => void;
  onBackToSite: () => void;
}

type AdminTab = 'inquiries' | 'services' | 'projects' | 'pcbPricing' | 'content' | 'media';

const TOKEN_STORAGE_KEY = 'ec_admin_token';
const INQUIRY_STATUSES: Array<'الكل' | InquiryStatus> = [
  'الكل',
  'جديد',
  'تحت المراجعة',
  'تم التسعير',
  'مكتمل',
];
const CATEGORIES: ServiceCategory[] = [
  'تصنيع PCB',
  'تحكم وأتمتة',
  'إنترنت الأشياء HMI',
];

const TAB_LABELS: Record<AdminTab, string> = {
  inquiries: 'الطلبات الواردة',
  services: 'إدارة الخدمات',
  projects: 'إدارة المشاريع السابقة',
  pcbPricing: 'تسعير PCB',
  content: 'محتوى الموقع والتواصل',
  media: 'مكتبة الصور والإعدادات',
};

function NumericField({
  value,
  onChangeValue,
  min = 0,
  max,
  integer = false,
  className = '',
  id,
}: {
  value: number;
  onChangeValue: (next: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  className?: string;
  id?: string;
}) {
  const [text, setText] = useState<string>(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(String(value));
    }
  }, [value, focused]);

  const commit = (raw: string) => {
    const cleaned = raw.trim().replace(',', '.');
    let parsed = cleaned === '' ? min : Number(cleaned);
    if (!Number.isFinite(parsed)) parsed = value;
    if (integer) parsed = Math.round(parsed);
    if (parsed < min) parsed = min;
    if (max !== undefined && parsed > max) parsed = max;
    setText(String(parsed));
    if (parsed !== value) onChangeValue(parsed);
  };

  return (
    <input
      id={id}
      type="text"
      inputMode={integer ? 'numeric' : 'decimal'}
      dir="ltr"
      value={text}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const nextRaw = e.target.value;
        if (!/^[0-9.,]*$/.test(nextRaw)) return;
        setText(nextRaw);
        const normalized = nextRaw.replace(',', '.');
        if (normalized !== '' && !normalized.endsWith('.')) {
          const parsed = Number(normalized);
          if (Number.isFinite(parsed)) {
            const clamped = integer ? Math.round(parsed) : parsed;
            if (clamped >= min && (max === undefined || clamped <= max)) {
              onChangeValue(clamped);
            }
          }
        }
      }}
      onBlur={() => {
        setFocused(false);
        commit(text);
      }}
      className={className}
    />
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('تعذر قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

export function AdminDashboard({
  config,
  services,
  projects,
  media,
  onDataUpdated,
  onBackToSite,
}: AdminDashboardProps) {
  const [token, setToken] = useState<string>(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '');
  const [authChecking, setAuthChecking] = useState<boolean>(Boolean(localStorage.getItem(TOKEN_STORAGE_KEY)));
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [activeTab, setActiveTab] = useState<AdminTab>('inquiries');
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Draft site data
  const [draftConfig, setDraftConfig] = useState<SiteConfig>(config);
  const [draftServices, setDraftServices] = useState<ServiceItem[]>(services);
  const [draftProjects, setDraftProjects] = useState<ProjectItem[]>(projects);
  const [draftMedia, setDraftMedia] = useState<MediaAsset[]>(media);
  const [dirty, setDirty] = useState(false);
  const [savingSite, setSavingSite] = useState(false);

  // Inquiries state
  const [inquiries, setInquiries] = useState<InquiryItem[]>([]);
  const [loadingInquiries, setLoadingInquiries] = useState(false);
  const [inqFilter, setInqFilter] = useState<'الكل' | InquiryStatus>('الكل');
  const [inqSearch, setInqSearch] = useState('');
  const [selectedInquiry, setSelectedInquiry] = useState<InquiryItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Editors
  const [editingService, setEditingService] = useState<ServiceItem | null>(null);
  // PCB Pricing Live Simulator State
  const [simWidthCm, setSimWidthCm] = useState<number>(8);
  const [simHeightCm, setSimHeightCm] = useState<number>(8);
  const [simQty, setSimQty] = useState<number>(5);
  const [simLayers, setSimLayers] = useState<1 | 2 | 4>(2);
  const [simIncludeStencil, setSimIncludeStencil] = useState<boolean>(false);
  const [serviceSpecsText, setServiceSpecsText] = useState('');
  const [editingProject, setEditingProject] = useState<ProjectItem | null>(null);
  const [projectSpecsText, setProjectSpecsText] = useState('');
  const [projectCatFilter, setProjectCatFilter] = useState<'الكل' | ServiceCategory>('الكل');
  const [projectSearch, setProjectSearch] = useState('');
  const [galleryPickerUrl, setGalleryPickerUrl] = useState('');
  const [previewLightbox, setPreviewLightbox] = useState<{
    images: LightboxImageItem[];
    initialIndex: number;
  } | null>(null);

  // Media upload & security
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadLabel, setUploadLabel] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setDraftConfig(config);
    setDraftServices(services);
    setDraftProjects(projects);
    setDraftMedia(media);
  }, [config, services, projects, media]);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    const verify = async () => {
      if (!token) {
        setAuthChecking(false);
        return;
      }
      try {
        const res = await fetch('/api/auth/verify', {
          method: 'POST',
          headers: { 'x-admin-token': token },
        });
        if (!res.ok) {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          setToken('');
        }
      } catch {
        // Ignore transient network check
      } finally {
        setAuthChecking(false);
      }
    };
    verify();
  }, [token]);

  const fetchInquiries = async (adminToken: string) => {
    setLoadingInquiries(true);
    try {
      const res = await fetch('/api/inquiries', {
        headers: { 'x-admin-token': adminToken },
      });
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken('');
        return;
      }
      const data = await res.json();
      if (Array.isArray(data.inquiries)) {
        setInquiries(data.inquiries);
      }
    } catch {
      showToast('err', 'تعذر تحميل طلبات العملاء.');
    } finally {
      setLoadingInquiries(false);
    }
  };

  useEffect(() => {
    if (token && !authChecking) {
      fetchInquiries(token);
    }
  }, [token, authChecking]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoggingIn(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok || !data.token) {
        setLoginError(data.error || 'كلمة المرور غير صحيحة');
        return;
      }
      localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      setToken(data.token);
      setLoginPassword('');
    } catch {
      setLoginError('تعذر الاتصال بالخادم');
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken('');
    onBackToSite();
  };

  const persistSiteChanges = async (
    nextConfig = draftConfig,
    nextServices = draftServices,
    nextProjects = draftProjects
  ) => {
    setSavingSite(true);
    try {
      const res = await fetch('/api/site', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify({
          config: nextConfig,
          services: nextServices,
          projects: nextProjects,
        }),
      });
      if (res.status === 401) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setToken('');
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        showToast('err', data.error || 'فشل حفظ التعديلات');
        return;
      }
      onDataUpdated(data);
      setDirty(false);
      showToast('ok', 'تم حفظ التعديلات وتحديث الموقع بنجاح.');
    } catch {
      showToast('err', 'حدث خطأ أثناء حفظ البيانات.');
    } finally {
      setSavingSite(false);
    }
  };

  const handleUploadPhoto = async (
    file: File,
    customLabel?: string,
    onDone?: (url: string) => void
  ) => {
    setUploadingImage(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify({
          filename: file.name,
          label: customLabel || uploadLabel || file.name,
          dataUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast('err', data.error || 'فشل رفع الصورة');
        return;
      }
      setDraftMedia(data.media);
      setUploadLabel('');
      onDataUpdated({
        config: draftConfig,
        services: draftServices,
        projects: draftProjects,
        media: data.media,
      });
      showToast('ok', 'تم رفع الصورة وإضافتها لمكتبة الصور.');
      if (onDone && data.asset?.url) {
        onDone(data.asset.url);
      }
    } catch {
      showToast('err', 'تأكد أن الصورة بصيغة PNG/JPG وحجمها أقل من 5 ميجابايت.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleInquiryUpdate = async (
    id: string,
    updates: { status?: InquiryStatus; notes?: string }
  ) => {
    try {
      const res = await fetch(`/api/inquiries/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (res.ok && data.inquiry) {
        setInquiries((prev) => prev.map((i) => (i.id === id ? data.inquiry : i)));
        if (selectedInquiry?.id === id) {
          setSelectedInquiry(data.inquiry);
        }
        showToast('ok', 'تم تحديث حالة الطلب.');
      }
    } catch {
      showToast('err', 'تعذر تحديث الطلب.');
    }
  };

  const handleInquiryDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/inquiries/${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-token': token },
      });
      if (res.ok) {
        setInquiries((prev) => prev.filter((i) => i.id !== id));
        if (selectedInquiry?.id === id) setSelectedInquiry(null);
        showToast('ok', 'تم حذف الطلب.');
      }
    } catch {
      showToast('err', 'تعذر حذف الطلب.');
    }
  };

  const filteredInquiries = useMemo(() => {
    return inquiries.filter((inq) => {
      if (inqFilter !== 'الكل' && inq.status !== inqFilter) return false;
      if (!inqSearch.trim()) return true;
      const q = inqSearch.trim().toLowerCase();
      return (
        inq.name.toLowerCase().includes(q) ||
        inq.company.toLowerCase().includes(q) ||
        inq.phone.toLowerCase().includes(q) ||
        inq.details.toLowerCase().includes(q) ||
        inq.requestType.toLowerCase().includes(q)
      );
    });
  }, [inquiries, inqFilter, inqSearch]);

  const inquiryStats = useMemo(() => {
    return {
      total: inquiries.length,
      newCount: inquiries.filter((i) => i.status === 'جديد').length,
      reviewCount: inquiries.filter((i) => i.status === 'تحت المراجعة').length,
      quotedCount: inquiries.filter((i) => i.status === 'تم التسعير').length,
    };
  }, [inquiries]);

  const openNewServiceEditor = () => {
    const nextOrder = String(draftServices.length + 1).padStart(2, '0');
    setEditingService({
      id: `srv-${Date.now()}`,
      orderLabel: nextOrder,
      category: 'تصنيع PCB',
      title: '',
      shortDesc: '',
      fullDesc: '',
      specs: [],
      image: draftMedia[0]?.url || '',
      featured: false,
      visible: true,
    });
    setServiceSpecsText('');
  };

  const openEditServiceEditor = (srv: ServiceItem) => {
    setEditingService({ ...srv });
    setServiceSpecsText(srv.specs.join('\n'));
  };

  const saveServiceEditor = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingService) return;
    if (!editingService.title.trim()) {
      showToast('err', 'يرجى كتابة اسم الخدمة.');
      return;
    }
    const cleanSpecs = serviceSpecsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const updatedItem: ServiceItem = {
      ...editingService,
      title: editingService.title.trim(),
      shortDesc: editingService.shortDesc.trim(),
      fullDesc: editingService.fullDesc.trim() || editingService.shortDesc.trim(),
      specs: cleanSpecs,
    };
    const exists = draftServices.some((s) => s.id === updatedItem.id);
    const nextList = exists
      ? draftServices.map((s) => (s.id === updatedItem.id ? updatedItem : s))
      : [...draftServices, updatedItem];

    setDraftServices(nextList);
    setEditingService(null);
    await persistSiteChanges(draftConfig, nextList, draftProjects);
  };

  const filteredProjects = useMemo(() => {
    return draftProjects.filter((prj) => {
      if (projectCatFilter !== 'الكل' && prj.category !== projectCatFilter) return false;
      if (!projectSearch.trim()) return true;
      const q = projectSearch.trim().toLowerCase();
      return (
        prj.title.toLowerCase().includes(q) ||
        prj.architecture.toLowerCase().includes(q) ||
        prj.region.toLowerCase().includes(q) ||
        (prj.client || '').toLowerCase().includes(q) ||
        prj.summary.toLowerCase().includes(q)
      );
    });
  }, [draftProjects, projectCatFilter, projectSearch]);

  const openNewProjectEditor = () => {
    const defaultImg = draftMedia[0]?.url || '';
    setEditingProject({
      id: `prj-${Date.now()}`,
      title: '',
      category: 'تحكم وأتمتة',
      architecture: '',
      region: 'مصر',
      year: String(new Date().getFullYear()),
      client: '',
      summary: '',
      specs: [],
      image: defaultImg,
      gallery: [],
      visible: true,
    });
    setProjectSpecsText('');
    setGalleryPickerUrl(draftMedia[1]?.url || defaultImg);
  };

  const openEditProjectEditor = (prj: ProjectItem) => {
    setEditingProject({
      ...prj,
      year: prj.year || '',
      client: prj.client || '',
      gallery: prj.gallery ? [...prj.gallery] : [],
    });
    setProjectSpecsText(prj.specs.join('\n'));
    setGalleryPickerUrl(draftMedia[0]?.url || '');
  };

  const openProjectPreviewLightbox = (prj: ProjectItem) => {
    const urls = Array.from(new Set([prj.image, ...(prj.gallery || [])].filter(Boolean)));
    if (urls.length === 0) return;
    setPreviewLightbox({
      images: urls.map((src, idx) => ({
        src,
        alt: `${prj.title} - ${idx + 1}`,
        title: prj.title,
        subtitle: [prj.category, prj.architecture, prj.region, prj.year].filter(Boolean).join(' · '),
      })),
      initialIndex: 0,
    });
  };

  const saveProjectEditor = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingProject) return;
    if (!editingProject.title.trim()) {
      showToast('err', 'يرجى كتابة اسم المشروع.');
      return;
    }
    const cleanSpecs = projectSpecsText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const cleanGallery = Array.from(
      new Set(
        (editingProject.gallery || []).filter((url) => Boolean(url) && url !== editingProject.image)
      )
    );
    const updatedItem: ProjectItem = {
      ...editingProject,
      title: editingProject.title.trim(),
      architecture: editingProject.architecture.trim(),
      region: editingProject.region.trim() || 'مصر',
      year: (editingProject.year || '').trim(),
      client: (editingProject.client || '').trim(),
      summary: editingProject.summary.trim(),
      specs: cleanSpecs,
      gallery: cleanGallery,
    };
    const exists = draftProjects.some((p) => p.id === updatedItem.id);
    const nextList = exists
      ? draftProjects.map((p) => (p.id === updatedItem.id ? updatedItem : p))
      : [updatedItem, ...draftProjects];

    setDraftProjects(nextList);
    setEditingProject(null);
    await persistSiteChanges(draftConfig, draftServices, nextList);
  };

  const handlePasswordChange = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.trim().length < 4) {
      showToast('err', 'كلمة المرور يجب أن لا تقل عن 4 أحرف.');
      return;
    }
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': token,
        },
        body: JSON.stringify({ newPassword: newPassword.trim() }),
      });
      if (res.ok) {
        setNewPassword('');
        showToast('ok', 'تم تغيير كلمة مرور لوحة التحكم.');
      } else {
        const d = await res.json();
        showToast('err', d.error || 'تعذر تغيير كلمة المرور');
      }
    } catch {
      showToast('err', 'حدث خطأ في الاتصال.');
    }
  };

  const handleResetDefaults = async () => {
    try {
      const res = await fetch('/api/site/reset', {
        method: 'POST',
        headers: { 'x-admin-token': token },
      });
      const data = await res.json();
      if (res.ok) {
        onDataUpdated(data);
        setDraftConfig(data.config);
        setDraftServices(data.services);
        setDraftProjects(data.projects);
        setDraftMedia(data.media);
        setDirty(false);
        setConfirmReset(false);
        showToast('ok', 'تمت استعادة المحتوى الافتراضي للموقع.');
      }
    } catch {
      showToast('err', 'تعذر استعادة الإعدادات الافتراضية.');
    }
  };

  const copyText = (value: string, id: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 2000);
  };

  // Loading auth verification
  if (authChecking) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm text-slate-600">جاري التحقق من الجلسة...</div>
      </div>
    );
  }

  // Login Gate
  if (!token) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100">
            <div>
              <div className="font-latin text-lg font-bold text-slate-900">
                {config.companyName}
              </div>
              <div className="text-xs text-slate-500">لوحة تحكم إدارة الموقع</div>
            </div>
            <Lock className="w-5 h-5 text-slate-400" />
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {loginError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs sm:text-sm text-red-700"
              >
                {loginError}
              </div>
            )}

            <div>
              <label
                htmlFor="admin-pass"
                className="block text-sm font-semibold text-slate-700 mb-1.5"
              >
                كلمة مرور الإدارة
              </label>
              <input
                id="admin-pass"
                type="password"
                required
                dir="ltr"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 text-sm text-right bg-white border border-slate-300 rounded-lg font-mono-tech focus:outline-none focus:border-sky-600 focus:ring-2 focus:ring-sky-600/20"
              />
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center justify-between gap-2">
              <span>
                كلمة المرور الافتراضية:{' '}
                <code className="font-mono-tech font-semibold text-slate-900">
                  electro2026
                </code>
              </span>
              <button
                type="button"
                onClick={() => setLoginPassword('electro2026')}
                className="text-sky-700 hover:text-sky-800 font-semibold cursor-pointer whitespace-nowrap"
              >
                تعبئة تلقائية
              </button>
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 disabled:opacity-60 rounded-lg transition-colors cursor-pointer"
            >
              {loggingIn ? 'جاري الدخول...' : 'دخول للوحة التحكم'}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={onBackToSite}
              className="text-sm font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
            >
              العودة إلى صفحة الموقع الرئيسية
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Sidebar (256px on desktop) */}
      <aside className="w-full lg:w-64 shrink-0 bg-white border-b lg:border-b-0 lg:border-l border-slate-200 flex flex-col">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-lg overflow-hidden bg-[#071a2b] border border-slate-200 shrink-0 flex items-center justify-center">
              <ResilientImage
                src={draftConfig.logoImage || '/assets/aistudio/FB_IMG_1794781004368_3087cab9.jpg'}
                alt={draftConfig.companyName}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="min-w-0">
              <div className="font-latin text-sm font-bold text-slate-900 truncate">
                {config.companyName}
              </div>
              <div className="text-[11px] text-slate-500">إدارة المحتوى والطلبات</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onBackToSite}
            className="lg:hidden px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg"
          >
            الموقع
          </button>
        </div>

        {/* Navigation Links */}
        <nav
          aria-label="أقسام لوحة التحكم"
          className="p-3 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible"
        >
          {(
            [
              { id: 'inquiries', label: 'الطلبات الواردة', icon: Inbox, count: inquiryStats.newCount },
              { id: 'services', label: 'الخدمات', icon: Wrench, count: draftServices.length },
              { id: 'projects', label: 'المشاريع السابقة', icon: FolderKanban, count: draftProjects.length },
              { id: 'pcbPricing', label: 'تسعير PCB', icon: Calculator },
              { id: 'content', label: 'المحتوى والتواصل', icon: FileText },
              { id: 'media', label: 'الصور والإعدادات', icon: ImageIcon },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isActive
                    ? 'bg-sky-50 text-sky-800 border border-sky-200'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border border-transparent'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </span>
                {'count' in item && item.count !== undefined && (
                  <span className="font-mono-tech text-xs text-slate-500 tabular-nums">
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="hidden lg:block mt-auto p-4 border-t border-slate-200 space-y-2">
          <button
            type="button"
            onClick={onBackToSite}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
          >
            <LayoutDashboard className="w-4 h-4" />
            <span>عرض الموقع للعملاء</span>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل خروج</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Breadcrumb Bar */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-slate-500 truncate">
            <span>لوحة التحكم</span>
            <span>/</span>
            <span className="font-bold text-slate-900 truncate">
              {TAB_LABELS[activeTab]}
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {dirty && (
              <button
                type="button"
                disabled={savingSite}
                onClick={() => persistSiteChanges()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer whitespace-nowrap"
              >
                <Save className="w-4 h-4" />
                <span>{savingSite ? 'جاري الحفظ...' : 'حفظ التعديلات'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onBackToSite}
              className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 text-xs sm:text-sm font-semibold text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer whitespace-nowrap"
            >
              <span>معاينة الموقع</span>
            </button>
          </div>
        </header>

        {/* Notification Toast */}
        {toast && (
          <div className="px-4 sm:px-6 lg:px-8 pt-4">
            <div
              role="status"
              className={`px-4 py-3 rounded-lg border text-sm font-semibold flex items-center justify-between ${
                toast.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}
            >
              <span>{toast.text}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="p-1 hover:opacity-75 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto space-y-6">
          {/* TAB 1: INQUIRIES */}
          {activeTab === 'inquiries' && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'إجمالي الطلبات', val: inquiryStats.total },
                  { label: 'طلبات جديدة', val: inquiryStats.newCount },
                  { label: 'تحت المراجعة', val: inquiryStats.reviewCount },
                  { label: 'تم التسعير', val: inquiryStats.quotedCount },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-white border border-slate-200 rounded-xl p-4"
                  >
                    <div className="text-xs text-slate-500 mb-1">{stat.label}</div>
                    <div className="font-mono-tech text-2xl font-bold text-slate-900 tabular-nums">
                      {stat.val}
                    </div>
                  </div>
                ))}
              </div>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={inqSearch}
                      onChange={(e) => setInqSearch(e.target.value)}
                      placeholder="ابحث بالاسم، الشركة، الموبايل أو التفاصيل..."
                      className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    {INQUIRY_STATUSES.map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => setInqFilter(st)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                          inqFilter === st
                            ? 'bg-white text-slate-900 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {loadingInquiries ? (
                  <div className="p-8 text-center text-sm text-slate-500">
                    جاري تحميل الطلبات...
                  </div>
                ) : filteredInquiries.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    لا توجد طلبات مطابقة للبحث أو التصفية الحالية.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {filteredInquiries.map((inq) => (
                      <div
                        key={inq.id}
                        className="p-4 sm:px-6 hover:bg-slate-50/80 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="font-semibold text-slate-900 text-sm">
                              {inq.name}
                            </span>
                            {inq.company && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{inq.company}</span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tech" dir="ltr">
                              {inq.phone}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-sky-700">
                            {inq.requestType}
                          </div>
                          <p className="text-sm text-slate-600 line-clamp-2">
                            {inq.details}
                          </p>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          <select
                            aria-label={`حالة طلب ${inq.name}`}
                            value={inq.status}
                            onChange={(e) =>
                              handleInquiryUpdate(inq.id, {
                                status: e.target.value as InquiryStatus,
                              })
                            }
                            className="px-2.5 py-1.5 text-xs font-semibold bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                          >
                            {INQUIRY_STATUSES.filter((s) => s !== 'الكل').map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setSelectedInquiry(inq)}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer whitespace-nowrap"
                          >
                            فتح / ملاحظات
                          </button>
                          <button
                            type="button"
                            aria-label="حذف الطلب"
                            onClick={() => handleInquiryDelete(inq.id)}
                            className="p-2 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* TAB 2: SERVICES */}
          {activeTab === 'services' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">الخدمات المعروضة</h2>
                  <p className="text-xs sm:text-sm text-slate-500">
                    أضف أو عدل أي خدمة أو غير صورتها ومواصفاتها الفنية مباشرة.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openNewServiceEditor}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة خدمة جديدة</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {draftServices.map((srv) => (
                  <div
                    key={srv.id}
                    className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
                  >
                    <div className="aspect-[16/9] bg-slate-100 border-b border-slate-200">
                      <ResilientImage
                        src={srv.image}
                        alt={srv.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-5 flex-1 flex flex-col">
                      <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                        <span>
                          <span className="font-mono-tech font-bold text-sky-700">
                            {srv.orderLabel}.
                          </span>{' '}
                          {srv.category}
                        </span>
                        <span>{srv.visible ? 'ظاهرة بالموقع' : 'مخفية'}</span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mb-1.5">
                        {srv.title}
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 mb-4 flex-1">
                        {srv.shortDesc}
                      </p>
                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => openEditServiceEditor(srv)}
                          className="px-3.5 py-1.5 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 rounded-lg cursor-pointer"
                        >
                          تعديل الخدمة
                        </button>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              const next = draftServices.map((s) =>
                                s.id === srv.id ? { ...s, visible: !s.visible } : s
                              );
                              setDraftServices(next);
                              await persistSiteChanges(draftConfig, next, draftProjects);
                            }}
                            title={srv.visible ? 'إخفاء' : 'إظهار'}
                            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
                          >
                            {srv.visible ? (
                              <Eye className="w-4 h-4" />
                            ) : (
                              <EyeOff className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const next = draftServices.filter((s) => s.id !== srv.id);
                              setDraftServices(next);
                              await persistSiteChanges(draftConfig, next, draftProjects);
                            }}
                            title="حذف"
                            className="p-2 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 3: PAST PROJECTS */}
          {activeTab === 'projects' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">المشاريع السابقة ونماذج الأعمال</h2>
                  <p className="text-xs sm:text-sm text-slate-500">
                    أضف مشاريعك السابقة مع صورها الحقيقية (صورة رئيسية + معرض صور إضافية) ليتم عرضها وتكبيرها في الصفحة الرئيسية.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openNewProjectEditor}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  <span>إضافة مشروع سابق جديد</span>
                </button>
              </div>

              {/* Filter & Search Bar */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex flex-wrap gap-1.5">
                  {(['الكل', ...CATEGORIES] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setProjectCatFilter(cat)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                        projectCatFilter === cat
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:text-slate-900'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <div className="relative w-full sm:w-64">
                  <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={projectSearch}
                    onChange={(e) => setProjectSearch(e.target.value)}
                    placeholder="ابحث باسم المشروع أو التقنية..."
                    className="w-full pr-9 pl-3 py-1.5 text-xs sm:text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:border-sky-600"
                  />
                </div>
              </div>

              {filteredProjects.length === 0 ? (
                <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
                  <p className="text-sm text-slate-500">لا توجد مشاريع مطابقة حالياً.</p>
                  <button
                    type="button"
                    onClick={openNewProjectEditor}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>أضف أول مشروع سابق</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredProjects.map((prj) => {
                    const photoCount = Array.from(
                      new Set([prj.image, ...(prj.gallery || [])].filter(Boolean))
                    ).length;
                    return (
                      <div
                        key={prj.id}
                        className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
                      >
                        <div className="relative aspect-[16/9] bg-slate-100 border-b border-slate-200 group">
                          <ResilientImage
                            src={prj.image}
                            alt={prj.title}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => openProjectPreviewLightbox(prj)}
                            title="معاينة وتكبير الصور"
                            className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/95 border border-slate-200 text-xs font-semibold text-slate-800 hover:bg-sky-700 hover:text-white hover:border-sky-700 shadow-xs cursor-pointer transition-colors"
                          >
                            <ZoomIn className="w-3.5 h-3.5" />
                            <span>معاينة</span>
                          </button>
                        </div>
                        <div className="p-5 flex-1 flex flex-col">
                          <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5 gap-2">
                            <span className="truncate">
                              {prj.category} · {prj.region}
                              {prj.year ? ` · ${prj.year}` : ''}
                            </span>
                            <span className="shrink-0">
                              {prj.visible ? 'ظاهر بالموقع' : 'مخفي'}
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-slate-900 mb-1">
                            {prj.title}
                          </h3>
                          <div className="font-mono-tech text-xs text-slate-600 mb-2 truncate">
                            {prj.architecture}
                          </div>
                          <p className="text-xs sm:text-sm text-slate-600 line-clamp-2 mb-3 flex-1">
                            {prj.summary}
                          </p>
                          <div className="text-[11px] text-slate-500 mb-3 flex items-center gap-1.5">
                            <Images className="w-3.5 h-3.5 text-slate-400" />
                            <span>{photoCount} {photoCount === 1 ? 'صورة مرفقة' : 'صور مرفقة'}</span>
                          </div>
                          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => openEditProjectEditor(prj)}
                              className="px-3.5 py-1.5 text-xs font-semibold text-sky-800 bg-sky-50 hover:bg-sky-100 rounded-lg cursor-pointer"
                            >
                              تعديل المشروع
                            </button>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  const next = draftProjects.map((p) =>
                                    p.id === prj.id ? { ...p, visible: !p.visible } : p
                                  );
                                  setDraftProjects(next);
                                  await persistSiteChanges(draftConfig, draftServices, next);
                                }}
                                title={prj.visible ? 'إخفاء من الصفحة الرئيسية' : 'إظهار في الصفحة الرئيسية'}
                                className="p-2 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
                              >
                                {prj.visible ? (
                                  <Eye className="w-4 h-4" />
                                ) : (
                                  <EyeOff className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const next = draftProjects.filter((p) => p.id !== prj.id);
                                  setDraftProjects(next);
                                  await persistSiteChanges(draftConfig, draftServices, next);
                                }}
                                title="حذف المشروع"
                                className="p-2 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: SITE CONTENT & CONTACT */}
          {activeTab === 'content' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                persistSiteChanges();
              }}
              className="space-y-6"
            >
              {/* Hero Settings */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100">
                  الواجهة الرئيسية (Hero Section)
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      اسم الشركة
                    </label>
                    <input
                      type="text"
                      value={draftConfig.companyName}
                      onChange={(e) => {
                        setDraftConfig({ ...draftConfig, companyName: e.target.value });
                        setDirty(true);
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      العنوان الفرعي العلوي
                    </label>
                    <input
                      type="text"
                      value={draftConfig.heroEyebrow}
                      onChange={(e) => {
                        setDraftConfig({ ...draftConfig, heroEyebrow: e.target.value });
                        setDirty(true);
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    العنوان الرئيسي
                  </label>
                  <input
                    type="text"
                    value={draftConfig.heroTitle}
                    onChange={(e) => {
                      setDraftConfig({ ...draftConfig, heroTitle: e.target.value });
                      setDirty(true);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الوصف الرئيسي
                  </label>
                  <textarea
                    rows={3}
                    value={draftConfig.heroSubtitle}
                    onChange={(e) => {
                      setDraftConfig({ ...draftConfig, heroSubtitle: e.target.value });
                      setDirty(true);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    صورة الواجهة الرئيسية
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={draftConfig.heroImage}
                      onChange={(e) => {
                        setDraftConfig({ ...draftConfig, heroImage: e.target.value });
                        setDirty(true);
                      }}
                      className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {draftMedia.map((m) => (
                        <option key={m.id} value={m.url}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                      <Upload className="w-4 h-4" />
                      <span>رفع صورة جديدة</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleUploadPhoto(file, 'صورة الواجهة الرئيسية', (url) => {
                              setDraftConfig((c) => ({ ...c, heroImage: url }));
                              setDirty(true);
                            });
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    شعار الموقع (Logo)
                  </label>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="w-11 h-11 rounded-lg overflow-hidden bg-[#071a2b] border border-slate-200 shrink-0 flex items-center justify-center">
                      <ResilientImage
                        src={draftConfig.logoImage || '/assets/aistudio/FB_IMG_1794781004368_3087cab9.jpg'}
                        alt="شعار الشركة"
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <select
                      value={draftConfig.logoImage || '/assets/aistudio/FB_IMG_1794781004368_3087cab9.jpg'}
                      onChange={(e) => {
                        setDraftConfig({ ...draftConfig, logoImage: e.target.value });
                        setDirty(true);
                      }}
                      className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {draftMedia.map((m) => (
                        <option key={`logo-${m.id}`} value={m.url}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                      <Upload className="w-4 h-4" />
                      <span>رفع شعار جديد</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            handleUploadPhoto(file, 'شعار الموقع', (url) => {
                              setDraftConfig((c) => ({ ...c, logoImage: url }));
                              setDirty(true);
                            });
                          }
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Capabilities Strip & PCB Banner */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100">
                  شريط المميزات وإعلان تصنيع الـ PCB
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {draftConfig.capabilities.map((cap, idx) => (
                    <div
                      key={cap.id}
                      className="p-3 border border-slate-200 rounded-lg space-y-2"
                    >
                      <input
                        type="text"
                        value={cap.label}
                        onChange={(e) => {
                          const next = [...draftConfig.capabilities];
                          next[idx] = { ...cap, label: e.target.value };
                          setDraftConfig({ ...draftConfig, capabilities: next });
                          setDirty(true);
                        }}
                        placeholder="العنوان"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-200 rounded"
                      />
                      <input
                        type="text"
                        value={cap.value}
                        onChange={(e) => {
                          const next = [...draftConfig.capabilities];
                          next[idx] = { ...cap, value: e.target.value };
                          setDraftConfig({ ...draftConfig, capabilities: next });
                          setDirty(true);
                        }}
                        placeholder="القيمة"
                        className="w-full px-2.5 py-1.5 text-sm font-semibold border border-slate-200 rounded"
                      />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    عنوان بانر تصنيع الـ PCB
                  </label>
                  <input
                    type="text"
                    value={draftConfig.pcbBannerTitle}
                    onChange={(e) => {
                      setDraftConfig({ ...draftConfig, pcbBannerTitle: e.target.value });
                      setDirty(true);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    نص بانر تصنيع الـ PCB
                  </label>
                  <textarea
                    rows={2}
                    value={draftConfig.pcbBannerBody}
                    onChange={(e) => {
                      setDraftConfig({ ...draftConfig, pcbBannerBody: e.target.value });
                      setDirty(true);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Contact & Working Hours */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <h2 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100">
                  بيانات التواصل ومواعيد العمل وشروط التسعير
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      مواعيد العمل
                    </label>
                    <input
                      type="text"
                      value={draftConfig.workingHours}
                      onChange={(e) => {
                        setDraftConfig({ ...draftConfig, workingHours: e.target.value });
                        setDirty(true);
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      نطاق الخدمة والشحن
                    </label>
                    <input
                      type="text"
                      value={draftConfig.regions}
                      onChange={(e) => {
                        setDraftConfig({ ...draftConfig, regions: e.target.value });
                        setDirty(true);
                      }}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      رقم الهاتف
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={draftConfig.phone}
                      onChange={(e) => {
                        setDraftConfig({ ...draftConfig, phone: e.target.value });
                        setDirty(true);
                      }}
                      className="w-full px-3 py-2 text-sm text-right font-mono-tech border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      رقم الواتساب (بالكود الدولي بدون +)
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={draftConfig.whatsapp}
                      onChange={(e) => {
                        setDraftConfig({ ...draftConfig, whatsapp: e.target.value });
                        setDirty(true);
                      }}
                      className="w-full px-3 py-2 text-sm text-right font-mono-tech border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      البريد الإلكتروني
                    </label>
                    <input
                      type="email"
                      dir="ltr"
                      value={draftConfig.email}
                      onChange={(e) => {
                        setDraftConfig({ ...draftConfig, email: e.target.value });
                        setDirty(true);
                      }}
                      className="w-full px-3 py-2 text-sm text-right border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      الدومين
                    </label>
                    <input
                      type="text"
                      dir="ltr"
                      value={draftConfig.domain}
                      onChange={(e) => {
                        setDraftConfig({ ...draftConfig, domain: e.target.value });
                        setDirty(true);
                      }}
                      className="w-full px-3 py-2 text-sm text-right font-mono-tech border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    ملاحظة المعاينة وصلاحية عروض الأسعار
                  </label>
                  <textarea
                    rows={2}
                    value={draftConfig.quotationTermsNote}
                    onChange={(e) => {
                      setDraftConfig({
                        ...draftConfig,
                        quotationTermsNote: e.target.value,
                      });
                      setDirty(true);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 bg-sky-50 border border-sky-200 rounded-xl px-5 py-3.5">
                <div className="text-xs sm:text-sm text-slate-700">
                  تم نقل إعدادات <strong>سعر السنتيمتر المربع</strong> و<strong>اللوحات ≤ 10×10 سم</strong> و<strong>الاستنسل والخصومات</strong> إلى تبويب مستقل لسهولة التعديل.
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('pcbPricing')}
                  className="px-4 py-2 text-xs font-semibold text-sky-900 bg-white border border-sky-300 hover:bg-sky-100 rounded-lg cursor-pointer whitespace-nowrap"
                >
                  فتح تبويب تسعير PCB
                </button>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingSite}
                  className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>{savingSite ? 'جاري الحفظ...' : 'حفظ جميع التعديلات'}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB: PCB PRICING */}
          {activeTab === 'pcbPricing' &&
            (() => {
              const pricing: PcbPricingConfig = {
                ...DEFAULT_PCB_PRICING,
                ...(draftConfig.pcbPricing ?? {}),
              };
              const updatePricing = (patch: Partial<PcbPricingConfig>) => {
                setDraftConfig({
                  ...draftConfig,
                  pcbPricing: { ...pricing, ...patch },
                });
                setDirty(true);
              };
              const maxSmallCm = Number((pricing.smallBoardMaxSideMm / 10).toFixed(1));
              const simEstimate = calculatePcbEstimate(
                {
                  widthMm: Math.max(10, simWidthCm * 10),
                  heightMm: Math.max(10, simHeightCm * 10),
                  layers: simLayers,
                  quantity: Math.max(1, simQty),
                  finish: 'HASL',
                  maskColorId: 'green',
                  thicknessMm: 1.6,
                  includeStencil: simIncludeStencil,
                },
                pricing
              );

              return (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    persistSiteChanges();
                  }}
                  className="space-y-6"
                >
                  {/* Header + Top Actions */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">
                        إعدادات تسعير الـ PCB والاستنسل والخصومات
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-500 mt-1">
                        عدّل سعر الـ 1 سم² أو سعر اللوحات الصغيرة (≤ 10×10 سم) أو الاستنسل ونسب الخصم وجرّب النتيجة مباشرة بالأسفل قبل الحفظ.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => updatePricing({ ...DEFAULT_PCB_PRICING })}
                        className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                      >
                        استعادة الافتراضي
                      </button>
                      <button
                        type="submit"
                        disabled={savingSite}
                        className="inline-flex items-center gap-2 px-5 py-2 text-xs sm:text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer"
                      >
                        <Save className="w-4 h-4" />
                        <span>{savingSite ? 'جاري الحفظ...' : 'حفظ تسعير PCB'}</span>
                      </button>
                    </div>
                  </div>

                  {/* 1. Standard cm² & Stencil Pricing */}
                  <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
                      1. تسعير السنتيمتر المربع والاستنسل (للّوحات الأكبر من {maxSmallCm}×{maxSmallCm} سم)
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          سعر الـ 1 سم² ({pricing.currency})
                        </label>
                        <NumericField
                          value={pricing.pricePerSqCm}
                          min={0.01}
                          onChangeValue={(v) => updatePricing({ pricePerSqCm: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">مثال: 0.85 أو 1.5</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          رسوم التجهيز الثابتة ({pricing.currency})
                        </label>
                        <NumericField
                          value={pricing.baseSetupFee}
                          min={0}
                          onChangeValue={(v) => updatePricing({ baseSetupFee: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">تُضاف مرة واحدة للطلب</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          سعر الاستنسل SMD ({pricing.currency})
                        </label>
                        <NumericField
                          value={pricing.stencilFee}
                          min={0}
                          onChangeValue={(v) => updatePricing({ stencilFee: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">تكلفة استنسل اللحام</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          أقل كمية للطلب (بوردة)
                        </label>
                        <NumericField
                          value={pricing.minQuantity}
                          min={1}
                          integer
                          onChangeValue={(v) => updatePricing({ minQuantity: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          العملة
                        </label>
                        <input
                          type="text"
                          value={pricing.currency}
                          onChange={(e) => updatePricing({ currency: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 2. Separate Pricing for <= 10x10 cm */}
                  <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-emerald-200/80">
                      <label className="inline-flex items-center gap-2.5 text-sm font-bold text-slate-900 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(pricing.smallBoardEnabled)}
                          onChange={(e) => updatePricing({ smallBoardEnabled: e.target.checked })}
                          className="w-4 h-4 rounded border-slate-300 text-emerald-700"
                        />
                        <span>2. تسعير منفصل ومخفض للوحات الأقل من أو تساوي 10×10 سم</span>
                      </label>
                      <span className="text-xs font-semibold text-emerald-900 bg-white px-2.5 py-1 rounded-md border border-emerald-200">
                        أي بوردة طولها ≤ {maxSmallCm} سم وعرضها ≤ {maxSmallCm} سم
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          الحد الأقصى للطول أو العرض (سم)
                        </label>
                        <NumericField
                          value={maxSmallCm}
                          min={2}
                          max={30}
                          onChangeValue={(cm) =>
                            updatePricing({ smallBoardMaxSideMm: Math.round(cm * 10) })
                          }
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-600"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                          الافتراضي 10 سم (أي 10×10 سم أو أقل)
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          سعر البوردة المنفصل ({pricing.currency})
                        </label>
                        <NumericField
                          value={pricing.smallBoardUnitPrice}
                          min={0}
                          onChangeValue={(v) => updatePricing({ smallBoardUnitPrice: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-600"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                          يُحسب بدل سعر الـ سم² للوحات الصغيرة
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          رسوم التجهيز للوحات الصغيرة ({pricing.currency})
                        </label>
                        <NumericField
                          value={pricing.smallBoardSetupFee}
                          min={0}
                          onChangeValue={(v) => updatePricing({ smallBoardSetupFee: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-600"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                          اتركها 0 لو بدون رسوم تجهيز إضافية
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 3. Discounts (%) */}
                  <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
                      3. نسب الخصم (%) — الخصم العام وخصم الكميات
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          خصم عام على كل الطلبات (%)
                        </label>
                        <NumericField
                          value={pricing.globalDiscountPercent}
                          min={0}
                          max={70}
                          onChangeValue={(v) => updatePricing({ globalDiscountPercent: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          خصم 10+ بوردات (%)
                        </label>
                        <NumericField
                          value={pricing.discountQty10}
                          min={0}
                          max={70}
                          onChangeValue={(v) => updatePricing({ discountQty10: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          خصم 20+ بوردة (%)
                        </label>
                        <NumericField
                          value={pricing.discountQty20}
                          min={0}
                          max={70}
                          onChangeValue={(v) => updatePricing({ discountQty20: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          خصم 50+ بوردة (%)
                        </label>
                        <NumericField
                          value={pricing.discountQty50}
                          min={0}
                          max={70}
                          onChangeValue={(v) => updatePricing({ discountQty50: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          خصم 100+ بوردة (%)
                        </label>
                        <NumericField
                          value={pricing.discountQty100}
                          min={0}
                          max={70}
                          onChangeValue={(v) => updatePricing({ discountQty100: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg focus:outline-none focus:border-sky-600"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 4. Layer Multipliers & Addons */}
                  <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                    <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-100">
                      4. معاملات الطبقات والإضافات ومدد التنفيذ
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          معامل طبقة واحدة (1-Layer)
                        </label>
                        <NumericField
                          value={pricing.singleLayerMultiplier}
                          min={0.1}
                          max={3}
                          onChangeValue={(v) => updatePricing({ singleLayerMultiplier: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          معامل 4 طبقات (4-Layer)
                        </label>
                        <NumericField
                          value={pricing.fourLayerMultiplier}
                          min={1}
                          max={10}
                          onChangeValue={(v) => updatePricing({ fourLayerMultiplier: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          إضافة الطلاء الذهبي ENIG ({pricing.currency})
                        </label>
                        <NumericField
                          value={pricing.enigExtraFee}
                          min={0}
                          onChangeValue={(v) => updatePricing({ enigExtraFee: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          إضافة لون غير الأخضر ({pricing.currency})
                        </label>
                        <NumericField
                          value={pricing.nonGreenMaskFee}
                          min={0}
                          onChangeValue={(v) => updatePricing({ nonGreenMaskFee: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          إضافة سُمك 2.0 مم ({pricing.currency})
                        </label>
                        <NumericField
                          value={pricing.thicknessExtraFee}
                          min={0}
                          onChangeValue={(v) => updatePricing({ thicknessExtraFee: v })}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech tabular-nums border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          مدة تنفيذ 1-2 طبقة
                        </label>
                        <input
                          type="text"
                          value={pricing.leadTimeStandardDays}
                          onChange={(e) => updatePricing({ leadTimeStandardDays: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          مدة تنفيذ 4 طبقات
                        </label>
                        <input
                          type="text"
                          value={pricing.leadTimeFourLayerDays}
                          onChange={(e) => updatePricing({ leadTimeFourLayerDays: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 5. Live Price Test Simulator */}
                  <div className="bg-slate-900 text-slate-100 rounded-xl p-6 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          تجربة فورية لحسبة العميل (Live Test)
                        </h3>
                        <p className="text-xs text-slate-400">
                          جرّب أي مقاس وعدد وشوف السعر اللي هيظهر للعميل دلوقتي بناءً على أرقامك.
                        </p>
                      </div>
                      <span
                        className={`px-3 py-1 rounded-md text-xs font-semibold ${
                          simEstimate.isSmallBoardPromo
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                        }`}
                      >
                        {simEstimate.isSmallBoardPromo
                          ? `تسعير منفصل (≤ ${maxSmallCm}×${maxSmallCm} سم)`
                          : `حساب بالسنتيمتر المربع (${simEstimate.areaCm2} سم²)`}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
                      <div>
                        <label className="block text-[11px] text-slate-300 mb-1">العرض (سم)</label>
                        <NumericField
                          value={simWidthCm}
                          min={1}
                          max={60}
                          onChangeValue={setSimWidthCm}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech bg-slate-800 border border-slate-700 rounded-lg text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-300 mb-1">الطول (سم)</label>
                        <NumericField
                          value={simHeightCm}
                          min={1}
                          max={60}
                          onChangeValue={setSimHeightCm}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech bg-slate-800 border border-slate-700 rounded-lg text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-300 mb-1">عدد البوردات</label>
                        <NumericField
                          value={simQty}
                          min={1}
                          integer
                          onChangeValue={setSimQty}
                          className="w-full px-3 py-2 text-sm text-right font-mono-tech bg-slate-800 border border-slate-700 rounded-lg text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-300 mb-1">الطبقات</label>
                        <select
                          value={simLayers}
                          onChange={(e) => setSimLayers(Number(e.target.value) as 1 | 2 | 4)}
                          className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-lg text-white"
                        >
                          <option value={1}>1 Layer</option>
                          <option value={2}>2 Layers</option>
                          <option value={4}>4 Layers</option>
                        </select>
                      </div>
                      <label className="inline-flex items-center gap-2 py-2 text-xs text-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={simIncludeStencil}
                          onChange={(e) => setSimIncludeStencil(e.target.checked)}
                          className="w-4 h-4 rounded"
                        />
                        <span>+ استنسل</span>
                      </label>
                    </div>

                    <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
                      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                        <span>
                          الإجمالي:{' '}
                          <strong className="text-xl font-mono-tech text-white tabular-nums">
                            {simEstimate.totalPrice.toLocaleString('en-US')} {simEstimate.currency}
                          </strong>
                        </span>
                        <span>
                          سعر البوردة:{' '}
                          <strong className="font-mono-tech text-sky-300">
                            {simEstimate.unitPrice.toLocaleString('en-US')} {simEstimate.currency}
                          </strong>
                        </span>
                        {simEstimate.discountPercent > 0 && (
                          <span className="text-emerald-400 font-semibold">
                            خصم مطبق: -{simEstimate.discountPercent}%
                          </span>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={savingSite}
                        className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-lg cursor-pointer"
                      >
                        <Save className="w-4 h-4" />
                        <span>{savingSite ? 'جاري الحفظ...' : 'حفظ تسعير PCB الآن'}</span>
                      </button>
                    </div>
                  </div>
                </form>
              );
            })()}

          {/* TAB 5: MEDIA & SETTINGS */}
          {activeTab === 'media' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    رفع صور حقيقية من جهازك
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    ارفع صور البوردات أو لوحات التحكم الحقيقية من تليفونك أو الكمبيوتر لاستخدامها في أي خدمة أو مشروع.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                  <input
                    type="text"
                    value={uploadLabel}
                    onChange={(e) => setUploadLabel(e.target.value)}
                    placeholder="وصف الصورة (مثال: بوردة ريليهات 16 قناة)"
                    className="flex-1 px-3.5 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                  <label className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer whitespace-nowrap">
                    <Upload className="w-4 h-4" />
                    <span>{uploadingImage ? 'جاري الرفع...' : 'اختيار ورفع صورة'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      disabled={uploadingImage}
                      className="hidden"
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadPhoto(file);
                      }}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                  {draftMedia.map((m) => (
                    <div
                      key={m.id}
                      className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50 flex flex-col"
                    >
                      <div className="aspect-[4/3] bg-slate-100 border-b border-slate-200">
                        <ResilientImage
                          src={m.url}
                          alt={m.label}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="p-3 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate">
                            {m.label}
                          </div>
                          <div className="font-mono-tech text-[11px] text-slate-500">
                            {m.uploadedAt}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyText(m.url, m.id)}
                          className="p-2 text-slate-600 hover:text-sky-700 bg-white border border-slate-200 rounded-lg cursor-pointer shrink-0"
                          title="نسخ رابط الصورة"
                        >
                          {copiedId === m.id ? (
                            <Check className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <form
                  onSubmit={handlePasswordChange}
                  className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
                >
                  <h3 className="text-base font-bold text-slate-900">
                    تغيير كلمة مرور لوحة التحكم
                  </h3>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      كلمة المرور الجديدة
                    </label>
                    <input
                      type="password"
                      dir="ltr"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="4 أحرف على الأقل"
                      className="w-full px-3.5 py-2 text-sm text-right font-mono-tech border border-slate-300 rounded-lg"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                  >
                    تحديث كلمة المرور
                  </button>
                </form>

                <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                  <h3 className="text-base font-bold text-slate-900">
                    استعادة المحتوى الافتراضي
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                    لو حابب ترجع نصوص وخدمات ومشاريع Electro Control الأساسية بدون مسح طلبات العملاء الواردة.
                  </p>
                  {!confirmReset ? (
                    <button
                      type="button"
                      onClick={() => setConfirmReset(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-red-700 border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>استعادة الإعدادات الافتراضية</span>
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleResetDefaults}
                        className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg cursor-pointer"
                      >
                        تأكيد الاستعادة
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmReset(false)}
                        className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
                      >
                        إلغاء
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Inquiry Details / Notes Modal */}
      {selectedInquiry && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedInquiry(null)}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">
                  {selectedInquiry.name}
                </h3>
                <div className="text-xs text-slate-500">
                  {selectedInquiry.company || 'عميل مباشر'} ·{' '}
                  <span className="font-mono-tech" dir="ltr">
                    {selectedInquiry.phone}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInquiry(null)}
                className="p-2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs font-semibold text-sky-700">
              {selectedInquiry.requestType}
            </div>
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700 leading-relaxed">
              {selectedInquiry.details}
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                ملاحظات هندسية / تسعير داخلي
              </label>
              <textarea
                rows={3}
                value={selectedInquiry.notes}
                onChange={(e) =>
                  setSelectedInquiry({ ...selectedInquiry, notes: e.target.value })
                }
                placeholder="مثال: تكلفة الهاردوير / تصميم PCB / البرمجة / المكونات منفصلة..."
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={() =>
                  copyText(
                    `أهلاً بحضرتك يا ${selectedInquiry.name}، معاك الفريق الهندسي من Electro Control بخصوص طلب (${selectedInquiry.requestType}). راجعنا التفاصيل ومحتاجين نأكد معاك بعض النقاط الفنية عشان نجهزلك عرض السعر.`,
                    'wa-reply'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                {copiedId === 'wa-reply' ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
                <span>نسخ رد واتساب سريع</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleInquiryUpdate(selectedInquiry.id, {
                    notes: selectedInquiry.notes,
                    status: selectedInquiry.status,
                  })
                }
                className="px-4 py-2 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer"
              >
                حفظ الملاحظات
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Service Editor Modal */}
      {editingService && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setEditingService(null)}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={saveServiceEditor}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">تعديل / إضافة خدمة</h3>
              <button
                type="button"
                onClick={() => setEditingService(null)}
                className="p-2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  الترتيب
                </label>
                <input
                  type="text"
                  value={editingService.orderLabel}
                  onChange={(e) =>
                    setEditingService({ ...editingService, orderLabel: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm font-mono-tech border border-slate-300 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  التصنيف
                </label>
                <select
                  value={editingService.category}
                  onChange={(e) =>
                    setEditingService({
                      ...editingService,
                      category: e.target.value as ServiceCategory,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                اسم الخدمة
              </label>
              <input
                type="text"
                required
                value={editingService.title}
                onChange={(e) =>
                  setEditingService({ ...editingService, title: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                وصف مختصر (يظهر في الكارت)
              </label>
              <textarea
                rows={2}
                value={editingService.shortDesc}
                onChange={(e) =>
                  setEditingService({ ...editingService, shortDesc: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                الوصف التفصيلي
              </label>
              <textarea
                rows={3}
                value={editingService.fullDesc}
                onChange={(e) =>
                  setEditingService({ ...editingService, fullDesc: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                المواصفات الفنية (كل نقطة في سطر جديد)
              </label>
              <textarea
                rows={4}
                value={serviceSpecsText}
                onChange={(e) => setServiceSpecsText(e.target.value)}
                placeholder="مثال: تصنيع 1 أو 2 أو متعددة الطبقات"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                صورة الخدمة
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={editingService.image}
                  onChange={(e) =>
                    setEditingService({ ...editingService, image: e.target.value })
                  }
                  className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {draftMedia.map((m) => (
                    <option key={m.id} value={m.url}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer">
                  <Upload className="w-4 h-4" />
                  <span>رفع صورة</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleUploadPhoto(file, editingService.title || 'صورة خدمة', (url) =>
                          setEditingService((prev) => (prev ? { ...prev, image: url } : prev))
                        );
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingService(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={savingSite}
                className="px-5 py-2 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer"
              >
                {savingSite ? 'جاري الحفظ...' : 'حفظ الخدمة'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Past Project Editor Modal */}
      {editingProject && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setEditingProject(null)}
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <form
            onSubmit={saveProjectEditor}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">تعديل / إضافة مشروع سابق</h3>
              <button
                type="button"
                onClick={() => setEditingProject(null)}
                className="p-2 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                اسم المشروع
              </label>
              <input
                type="text"
                required
                value={editingProject.title}
                onChange={(e) =>
                  setEditingProject({ ...editingProject, title: e.target.value })
                }
                placeholder="مثال: لوحة تحكم خط تعبئة أوتوماتيكي بـ STM32"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  التصنيف
                </label>
                <select
                  value={editingProject.category}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      category: e.target.value as ServiceCategory,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  التقنية / المعالج
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={editingProject.architecture}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, architecture: e.target.value })
                  }
                  placeholder="STM32 · RS485 · HMI"
                  className="w-full px-3 py-2 text-sm text-right font-mono-tech border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  النطاق / الدولة
                </label>
                <input
                  type="text"
                  value={editingProject.region}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, region: e.target.value })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  سنة التنفيذ (اختياري)
                </label>
                <input
                  type="text"
                  dir="ltr"
                  value={editingProject.year || ''}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, year: e.target.value })
                  }
                  placeholder="2026"
                  className="w-full px-3 py-2 text-sm text-right font-mono-tech border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  القطاع / الجهة (اختياري)
                </label>
                <input
                  type="text"
                  value={editingProject.client || ''}
                  onChange={(e) =>
                    setEditingProject({ ...editingProject, client: e.target.value })
                  }
                  placeholder="مصنع أغذية / منشأة تجارية"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                ملخص المشروع
              </label>
              <textarea
                rows={3}
                value={editingProject.summary}
                onChange={(e) =>
                  setEditingProject({ ...editingProject, summary: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                المواصفات المنفذة (كل نقطة في سطر جديد)
              </label>
              <textarea
                rows={4}
                value={projectSpecsText}
                onChange={(e) => setProjectSpecsText(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            {/* Main Image */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                  الصورة الرئيسية للمشروع
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    value={editingProject.image}
                    onChange={(e) =>
                      setEditingProject({ ...editingProject, image: e.target.value })
                    }
                    className="flex-1 min-w-[200px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {draftMedia.map((m) => (
                      <option key={m.id} value={m.url}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer">
                    <Upload className="w-4 h-4" />
                    <span>{uploadingImage ? 'جاري الرفع...' : 'رفع صورة رئيسية'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleUploadPhoto(file, editingProject.title || 'صورة مشروع', (url) =>
                            setEditingProject((prev) => (prev ? { ...prev, image: url } : prev))
                          );
                        }
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Additional Gallery Photos */}
              <div className="pt-3 border-t border-slate-200 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-800">
                    صور إضافية للمشروع (تظهر للمستخدم مع ميزة التكبير)
                  </label>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-200 hover:bg-sky-100 rounded-lg cursor-pointer">
                    <Plus className="w-3.5 h-3.5" />
                    <span>رفع صور إضافية</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        e.target.value = '';
                        for (const file of files) {
                          await handleUploadPhoto(
                            file,
                            `${editingProject.title || 'مشروع'} - إضافية`,
                            (url) =>
                              setEditingProject((prev) => {
                                if (!prev) return prev;
                                const existing = prev.gallery || [];
                                if (url === prev.image || existing.includes(url)) return prev;
                                return { ...prev, gallery: [...existing, url] };
                              })
                          );
                        }
                      }}
                    />
                  </label>
                </div>

                {/* Pick from existing Media Library */}
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={galleryPickerUrl}
                    onChange={(e) => setGalleryPickerUrl(e.target.value)}
                    className="flex-1 min-w-[200px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {draftMedia.map((m) => (
                      <option key={`gal-pick-${m.id}`} value={m.url}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!galleryPickerUrl) return;
                      setEditingProject((prev) => {
                        if (!prev) return prev;
                        const existing = prev.gallery || [];
                        if (galleryPickerUrl === prev.image || existing.includes(galleryPickerUrl)) {
                          return prev;
                        }
                        return { ...prev, gallery: [...existing, galleryPickerUrl] };
                      });
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg cursor-pointer"
                  >
                    إضافة من المكتبة
                  </button>
                </div>

                {/* Preview All Attached Photos */}
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 pt-1">
                  {editingProject.image && (
                    <div className="relative rounded-lg overflow-hidden border-2 border-sky-600 bg-white aspect-[4/3]">
                      <ResilientImage
                        src={editingProject.image}
                        alt="الصورة الرئيسية"
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-sky-700 text-white text-[10px] font-semibold">
                        رئيسية
                      </span>
                    </div>
                  )}
                  {(editingProject.gallery || []).map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      className="relative rounded-lg overflow-hidden border border-slate-300 bg-white aspect-[4/3] group"
                    >
                      <ResilientImage
                        src={url}
                        alt={`صورة إضافية ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 p-1 bg-slate-900/75 flex items-center justify-between gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingProject((prev) => {
                              if (!prev) return prev;
                              const nextGallery = (prev.gallery || []).filter((u) => u !== url);
                              if (prev.image && prev.image !== url) {
                                nextGallery.unshift(prev.image);
                              }
                              return { ...prev, image: url, gallery: nextGallery };
                            })
                          }
                          className="text-[10px] font-semibold text-sky-300 hover:text-white cursor-pointer"
                        >
                          تعيين رئيسية
                        </button>
                        <button
                          type="button"
                          aria-label="إزالة الصورة"
                          onClick={() =>
                            setEditingProject((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    gallery: (prev.gallery || []).filter((u) => u !== url),
                                  }
                                : prev
                            )
                          }
                          className="text-red-300 hover:text-red-100 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs sm:text-sm font-medium text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={editingProject.visible}
                onChange={(e) =>
                  setEditingProject({ ...editingProject, visible: e.target.checked })
                }
                className="w-4 h-4 rounded border-slate-300 text-sky-700 focus:ring-sky-600"
              />
              <span>إظهار المشروع في شبكة المشاريع بالصفحة الرئيسية</span>
            </label>

            <div className="pt-3 border-t border-slate-100 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setEditingProject(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={savingSite}
                className="px-5 py-2 text-sm font-semibold text-white bg-sky-700 hover:bg-sky-800 rounded-lg cursor-pointer"
              >
                {savingSite ? 'جاري الحفظ...' : 'حفظ المشروع'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lightbox Preview in Dashboard */}
      {previewLightbox && (
        <ImageLightbox
          images={previewLightbox.images}
          initialIndex={previewLightbox.initialIndex}
          onClose={() => setPreviewLightbox(null)}
        />
      )}
    </div>
  );
}
