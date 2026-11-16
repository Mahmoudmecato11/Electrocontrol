import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Clock,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  X,
  ZoomIn,
} from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import type {
  ProjectItem,
  ServiceCategory,
  ServiceItem,
  SiteConfig,
} from '../shared/siteData';
import { ResilientImage } from './ResilientImage';
import { GerberViewer } from './GerberViewer';
import { ImageLightbox, type LightboxImageItem } from './ImageLightbox';
import { Reveal } from './Reveal';

interface PublicSiteProps {
  config: SiteConfig;
  services: ServiceItem[];
  projects: ProjectItem[];
  onOpenAdmin: () => void;
}

const REQUEST_TYPES = [
  'تصنيع PCB من ملفات Gerber',
  'تصميم بوردة PCB ونظام تحكم جديد',
  'معاينة ماكينة لتصنيع نظام تحكم',
  'نظام Industrial IoT / شاشة HMI مخصصة',
  'هندسة عكسية لبوردة قائمة',
  'استفسار فني عام',
];

const CATEGORIES: Array<'الكل' | ServiceCategory> = [
  'الكل',
  'تصنيع PCB',
  'تحكم وأتمتة',
  'إنترنت الأشياء HMI',
];

export function PublicSite({
  config,
  services,
  projects,
  onOpenAdmin,
}: PublicSiteProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [serviceFilter, setServiceFilter] = useState<'الكل' | ServiceCategory>('الكل');
  const [projectFilter, setProjectFilter] = useState<'الكل' | ServiceCategory>('الكل');
  const [selectedService, setSelectedService] = useState<ServiceItem | null>(null);
  const [selectedProject, setSelectedProject] = useState<ProjectItem | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [lightboxState, setLightboxState] = useState<{
    images: LightboxImageItem[];
    initialIndex: number;
    project?: ProjectItem;
  } | null>(null);

  // Quote Form state
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [requestType, setRequestType] = useState(REQUEST_TYPES[0]);
  const [boardCount, setBoardCount] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [submittedWhatsappUrl, setSubmittedWhatsappUrl] = useState<string | null>(null);

  const visibleServices = useMemo(() => {
    const active = services.filter((s) => s.visible);
    if (serviceFilter === 'الكل') return active;
    return active.filter((s) => s.category === serviceFilter);
  }, [services, serviceFilter]);

  const visibleProjects = useMemo(
    () => projects.filter((p) => p.visible),
    [projects]
  );

  const filteredProjects = useMemo(() => {
    if (projectFilter === 'الكل') return visibleProjects;
    return visibleProjects.filter((p) => p.category === projectFilter);
  }, [visibleProjects, projectFilter]);

  const getProjectGallery = (prj: ProjectItem): string[] => {
    const raw = [prj.image, ...(prj.gallery || [])].filter(Boolean);
    return Array.from(new Set(raw));
  };

  const openProjectLightbox = (prj: ProjectItem, startIndex = 0) => {
    const urls = getProjectGallery(prj);
    const meta = [prj.category, prj.architecture, prj.region, prj.year]
      .filter(Boolean)
      .join(' · ');
    const images: LightboxImageItem[] = urls.map((src, idx) => ({
      src,
      alt: `${prj.title} - صورة ${idx + 1}`,
      title: prj.title,
      subtitle: meta,
    }));
    setLightboxState({
      images,
      initialIndex: startIndex,
      project: prj,
    });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedService(null);
        setSelectedProject(null);
        setMobileMenuOpen(false);
      }
    };
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 480);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const jumpToQuote = (
    presetType?: string,
    presetNote?: string,
    overwrite = false,
    presetBoardCount?: number
  ) => {
    setSelectedService(null);
    setSelectedProject(null);
    setMobileMenuOpen(false);
    if (presetType) setRequestType(presetType);
    if (typeof presetBoardCount === 'number' && presetBoardCount > 0) {
      setBoardCount(String(presetBoardCount));
    }
    if (presetNote && (overwrite || !details.trim())) {
      setDetails(presetNote);
    }
    const el = document.getElementById('quote');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const cleanWhatsapp = (() => {
    const digits = (config.whatsapp || config.phone || '201080269003').replace(/[^\d]/g, '');
    if (digits.startsWith('00')) return digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) return `2${digits}`;
    return digits || '201080269003';
  })();
  const whatsappUrl = `https://wa.me/${cleanWhatsapp}?text=${encodeURIComponent(
    `أهلاً فريق ${config.companyName}، محتاج أستفسر عن مشروع أو طلب عرض سعر.`
  )}`;
  const cleanTel = (config.phone || '01080269003').replace(/[^\d+]/g, '');
  const logoSrc = config.logoImage || '/assets/aistudio/FB_IMG_1794781004368_3087cab9.jpg';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');

    const cleanName = name.trim();
    const cleanPhone = phone.trim();
    const cleanEmail = email.trim();
    const cleanDetails = details.trim();

    if (cleanName.length < 2) {
      setFormError('يرجى كتابة الاسم بشكل صحيح.');
      return;
    }
    if (!/^[+\d\s()-]{8,20}$/.test(cleanPhone)) {
      setFormError('يرجى إدخال رقم تليفون أو واتساب صحيح للتواصل.');
      return;
    }
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setFormError('صيغة البريد الإلكتروني غير صحيحة.');
      return;
    }
    if (cleanDetails.length < 8) {
      setFormError('يرجى كتابة نبذة مختصرة عن الطلب أو مواصفات البوردة/الماكينة.');
      return;
    }

    const cleanCompany = company.trim();
    const cleanBoardCount = boardCount.trim();
    const waLines = [
      `السلام عليكم فريق ${config.companyName}،`,
      `طلب جديد من الموقع (${requestType}):`,
      '',
      `• الاسم: ${cleanName}`,
      ...(cleanCompany ? [`• الشركة / المصنع: ${cleanCompany}`] : []),
      `• رقم الموبايل / واتساب: ${cleanPhone}`,
      ...(cleanEmail ? [`• البريد الإلكتروني: ${cleanEmail}`] : []),
      `• نوع الطلب: ${requestType}`,
      ...(cleanBoardCount ? [`• عدد البوردات المطلوب: ${cleanBoardCount} بوردة`] : []),
      '',
      '• تفاصيل المشروع / المواصفات:',
      cleanDetails,
    ];
    const waOrderUrl = `https://wa.me/${cleanWhatsapp}?text=${encodeURIComponent(
      waLines.join('\n')
    )}`;

    // Open WhatsApp synchronously during user submit gesture without window.open
    const waLink = document.createElement('a');
    waLink.href = waOrderUrl;
    waLink.target = '_blank';
    waLink.rel = 'noopener noreferrer';
    waLink.style.display = 'none';
    document.body.appendChild(waLink);
    waLink.click();
    document.body.removeChild(waLink);

    const savedDetails =
      cleanBoardCount && !cleanDetails.includes('العدد المطلوب:')
        ? `عدد البوردات: ${cleanBoardCount} بوردة\n${cleanDetails}`
        : cleanDetails;

    setSubmittedWhatsappUrl(waOrderUrl);
    setSubmitting(true);
    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: cleanName,
          company: cleanCompany,
          phone: cleanPhone,
          email: cleanEmail,
          requestType,
          details: savedDetails,
        }),
      });
      const data = await res.json().catch(() => null);
      setSubmittedId(data?.inquiry?.id || `EC-WA-${Date.now().toString().slice(-4)}`);
      setName('');
      setCompany('');
      setPhone('');
      setEmail('');
      setBoardCount('');
      setDetails('');
    } catch {
      setSubmittedId(`EC-WA-${Date.now().toString().slice(-4)}`);
      setName('');
      setCompany('');
      setPhone('');
      setEmail('');
      setBoardCount('');
      setDetails('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen flex flex-col bg-[#FAF9F5] text-[#0B1D2E]">
        {/* Top Bar Contract: Midnight Navy matching logo seamlessly, 3 clean zones */}
        <header className="sticky top-0 z-40 h-16 bg-[#071A2B]/95 backdrop-blur border-b border-white/10">
          <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-8">
            {/* Zone 1: Seamless Logo + Single-line Wordmark */}
            <a
              href="#top"
              className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E7D8B9] rounded-lg"
            >
              <span className="w-10 h-10 rounded-lg overflow-hidden bg-[#071A2B] shrink-0 flex items-center justify-center">
                <ResilientImage
                  src={logoSrc}
                  alt={`شعار ${config.companyName}`}
                  className="w-full h-full object-contain"
                />
              </span>
              <span className="font-latin text-lg font-bold tracking-tight text-[#F4EFE1]">
                {config.companyName}
              </span>
            </a>

            {/* Zone 2: 4 concise single-line navigation links */}
            <nav
              aria-label="التنقل الرئيسي"
              className="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-300"
            >
              <a
                href="#services"
                className="hover:text-[#F4EFE1] hover:underline underline-offset-8 decoration-[#E7D8B9] transition-colors whitespace-nowrap shrink-0"
              >
                الخدمات
              </a>
              <a
                href="#pcb"
                className="hover:text-[#F4EFE1] hover:underline underline-offset-8 decoration-[#E7D8B9] transition-colors whitespace-nowrap shrink-0"
              >
                تصنيع PCB
              </a>
              <a
                href="#projects"
                className="hover:text-[#F4EFE1] hover:underline underline-offset-8 decoration-[#E7D8B9] transition-colors whitespace-nowrap shrink-0"
              >
                المشاريع
              </a>
              <a
                href="#about"
                className="hover:text-[#F4EFE1] hover:underline underline-offset-8 decoration-[#E7D8B9] transition-colors whitespace-nowrap shrink-0"
              >
                عن الشركة
              </a>
            </nav>

            {/* Zone 3: 1 Primary CTA + Mobile drawer button */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => jumpToQuote()}
                className="hidden sm:inline-flex items-center justify-center px-4 py-2 text-xs sm:text-sm font-semibold text-white bg-[#1D5F8A] hover:bg-[#2573A6] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E7D8B9]"
              >
                {config.heroPrimaryCta}
              </button>
              <button
                type="button"
                aria-label={mobileMenuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
                aria-expanded={mobileMenuOpen}
                onClick={() => setMobileMenuOpen((v) => !v)}
                className="md:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg border border-white/15 text-[#F4EFE1] hover:bg-white/10 cursor-pointer"
              >
                {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Mobile Drawer */}
          {mobileMenuOpen && (
            <div className="md:hidden bg-[#0B2237] border-b border-white/10 px-4 py-4 shadow-lg">
              <nav className="flex flex-col gap-1">
                <a
                  href="#services"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5 rounded-lg"
                >
                  الخدمات
                </a>
                <a
                  href="#pcb"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5 rounded-lg"
                >
                  تصنيع PCB
                </a>
                <a
                  href="#projects"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5 rounded-lg"
                >
                  المشاريع والأعمال
                </a>
                <a
                  href="#about"
                  onClick={() => setMobileMenuOpen(false)}
                  className="px-3 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5 rounded-lg"
                >
                  عن الشركة والتواصل
                </a>
                <button
                  type="button"
                  onClick={() => jumpToQuote()}
                  className="mt-2 w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#1D5F8A] hover:bg-[#2573A6] rounded-lg cursor-pointer"
                >
                  {config.heroPrimaryCta}
                </button>
              </nav>
            </div>
          )}
        </header>

        <main id="top" className="flex-1">
          {/* 1. Hero Section: Midnight Navy Brand Anchor + Uncluttered Actions */}
          <section className="bg-[#071A2B] text-[#F4EFE1] border-b border-white/10">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-18 lg:py-22">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
                <Reveal immediate delay={0.04} y={14} className="lg:col-span-6 flex flex-col justify-center">
                  <p className="text-xs sm:text-sm font-semibold text-[#E7D8B9] tracking-wide mb-3">
                    {config.heroEyebrow}
                  </p>
                  <h1
                    className="headline-balance font-bold text-[#F4EFE1] tracking-tight leading-[1.28] mb-5"
                    style={{ fontSize: 'clamp(1.9rem, 3.3vw, 2.95rem)' }}
                  >
                    {config.heroTitle}
                  </h1>
                  <p className="text-base md:text-lg text-slate-300 leading-relaxed max-w-2xl mb-8">
                    {config.heroSubtitle}
                  </p>

                  <div className="flex flex-wrap items-center gap-4 mb-9">
                    <button
                      type="button"
                      onClick={() => jumpToQuote()}
                      className="inline-flex items-center justify-center gap-2 px-6 py-3.5 text-sm md:text-base font-semibold text-white bg-[#1D5F8A] hover:bg-[#2573A6] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E7D8B9]"
                    >
                      <span>{config.heroPrimaryCta}</span>
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center gap-2 px-5 py-3.5 text-sm md:text-base font-semibold text-[#F4EFE1] hover:text-white border border-white/20 hover:border-white/40 bg-white/5 hover:bg-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <MessageCircle className="w-4 h-4 text-emerald-400" />
                      <span>تواصل واتساب</span>
                    </a>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs sm:text-sm text-slate-400 pt-5 border-t border-white/10">
                    <span className="tabular-nums">{config.workingHours}</span>
                    <span aria-hidden="true">·</span>
                    <span>{config.regions}</span>
                  </div>
                </Reveal>

                <Reveal immediate delay={0.12} y={16} className="lg:col-span-6">
                  <div className="h-full min-h-[250px] sm:min-h-[350px] lg:min-h-[430px] rounded-xl overflow-hidden border border-white/15 bg-[#0E2439]">
                    <ResilientImage
                      src={config.heroImage}
                      alt="معمل تطوير واختبار أنظمة التحكم وبوردات الـ PCB في Electro Control"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </Reveal>
              </div>
            </div>

            {/* 4-Column Factual Capability Strip */}
            <div className="bg-[#0B2237] border-t border-white/10">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 divide-white/10">
                  {config.capabilities.map((cap, idx) => (
                    <Reveal
                      key={cap.id}
                      delay={idx * 0.05}
                      y={10}
                      className={`py-5 px-3 sm:px-6 ${idx === 0 ? 'lg:pr-0' : ''} ${
                        idx < config.capabilities.length - 1 ? 'lg:border-e lg:border-white/10' : ''
                      }`}
                    >
                      <div className="text-xs text-slate-400 mb-1">{cap.label}</div>
                      <div className="font-latin text-sm sm:text-base font-bold text-[#F4EFE1] tabular-nums">
                        {cap.value}
                      </div>
                    </Reveal>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 2. Core Services Section */}
          <section id="services" className="py-16 md:py-24 bg-[#FAF9F5]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <Reveal className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
                <div>
                  <h2 className="headline-balance text-2xl md:text-3xl font-bold text-[#071A2B] mb-2.5">
                    الخدمات الهندسية والتصنيع
                  </h2>
                  <p className="text-slate-600 text-sm md:text-base max-w-2xl leading-relaxed">
                    بنقدم حلول عملية متكاملة بداية من تصميم وتصنيع البوردة لحد البرمجة والتركيب، بدون تعقيد.
                  </p>
                </div>

                {/* Animated Filter Controls */}
                <div
                  role="tablist"
                  aria-label="تصفية الخدمات"
                  className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#EFECE3] border border-[#E5E3DC] rounded-lg self-start"
                >
                  {CATEGORIES.map((cat) => {
                    const active = serviceFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setServiceFilter(cat)}
                        className={`relative px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          active ? 'text-[#071A2B]' : 'text-slate-600 hover:text-[#071A2B]'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="service-filter-active"
                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                            className="absolute inset-0 bg-white rounded-md shadow-xs"
                          />
                        )}
                        <span className="relative z-10">{cat}</span>
                      </button>
                    );
                  })}
                </div>
              </Reveal>

              {visibleServices.length === 0 ? (
                <div className="bg-white border border-[#E5E3DC] rounded-xl p-12 text-center text-slate-500">
                  لا توجد خدمات ظاهرة في هذا التصنيف حالياً.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
                  {visibleServices.map((srv, idx) => (
                    <motion.article
                      key={srv.id}
                      initial={{ opacity: 0, y: 18 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, amount: 0.06 }}
                      transition={{
                        duration: 0.45,
                        delay: (idx % 2) * 0.08,
                        ease: [0.16, 1, 0.3, 1],
                      }}
                      className="bg-white border border-[#E5E3DC] rounded-xl overflow-hidden flex flex-col hover:border-[#C9C4B6] transition-colors"
                    >
                      <div className="aspect-[16/10] w-full bg-slate-100 border-b border-[#E5E3DC] overflow-hidden">
                        <ResilientImage
                          src={srv.image}
                          alt={srv.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="p-6 sm:p-7 flex-1 flex flex-col">
                        <div className="text-xs text-slate-500 mb-2 flex items-center gap-2">
                          <span className="font-mono-tech font-semibold text-[#1D5F8A]">
                            {srv.orderLabel}.
                          </span>
                          <span>{srv.category}</span>
                        </div>
                        <h3 className="text-lg md:text-xl font-bold text-[#071A2B] mb-2.5">
                          {srv.title}
                        </h3>
                        <p className="text-sm text-slate-600 leading-relaxed mb-4">
                          {srv.shortDesc}
                        </p>
                        <ul className="space-y-1.5 text-xs sm:text-sm text-slate-700 mb-6 flex-1">
                          {srv.specs.slice(0, 3).map((spec, sIdx) => (
                            <li key={sIdx} className="flex items-start gap-2">
                              <span className="text-[#1D5F8A] font-bold leading-5" aria-hidden="true">
                                •
                              </span>
                              <span>{spec}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="pt-4 border-t border-[#EFECE3] flex items-center justify-between gap-4">
                          <button
                            type="button"
                            onClick={() => setSelectedService(srv)}
                            className="text-sm font-semibold text-[#1D5F8A] hover:text-[#071A2B] cursor-pointer whitespace-nowrap transition-colors"
                          >
                            عرض المواصفات كاملة
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              jumpToQuote(
                                srv.category === 'تصنيع PCB'
                                  ? 'تصنيع PCB من ملفات Gerber'
                                  : srv.category === 'إنترنت الأشياء HMI'
                                  ? 'نظام Industrial IoT / شاشة HMI مخصصة'
                                  : 'تصميم بوردة PCB ونظام تحكم جديد',
                                `استفسار بخصوص: ${srv.title}`
                              )
                            }
                            className="px-4 py-2 text-xs font-semibold text-[#071A2B] bg-[#FAF9F5] hover:bg-[#EFECE3] border border-[#E5E3DC] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            اطلب تسعير
                          </button>
                        </div>
                      </div>
                    </motion.article>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* 3. Dedicated Standalone PCB Manufacturing & Gerber Preview Section */}
          <section id="pcb" className="py-16 md:py-24 bg-white border-y border-[#E5E3DC]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
              <Reveal>
                <div className="bg-[#071A2B] text-[#F4EFE1] rounded-xl p-6 sm:p-8 lg:p-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6 border border-[#0E2439]">
                  <div className="max-w-2xl">
                    <p className="text-xs font-semibold text-[#E7D8B9] mb-2">
                      خدمة تصنيع الـ PCB في مصر
                    </p>
                    <h2 className="headline-balance text-xl sm:text-2xl font-bold mb-2.5">
                      {config.pcbBannerTitle}
                    </h2>
                    <p className="text-sm sm:text-base text-slate-300 leading-relaxed">
                      {config.pcbBannerBody}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        jumpToQuote(
                          'تصنيع PCB من ملفات Gerber',
                          'محتاج تسعير تصنيع PCB — الكمية المطلوبة: ... / هل ملفات Gerber جاهزة: ...'
                        )
                      }
                      className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold bg-[#1D5F8A] hover:bg-[#2573A6] text-white rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span>اطلب تصنيع PCB الآن</span>
                      <ArrowLeft className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </Reveal>

              <Reveal delay={0.08}>
                <GerberViewer
                  pricing={config.pcbPricing}
                  onUseForQuote={(summary, qty) =>
                    jumpToQuote('تصنيع PCB من ملفات Gerber', summary, true, qty)
                  }
                />
              </Reveal>
            </div>
          </section>

          {/* 4. Past Engineering Projects Showcase Grid (Clean & De-cluttered Cards) */}
          <section id="projects" className="py-16 md:py-24 bg-[#FAF9F5]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <Reveal className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
                <div>
                  <h2 className="headline-balance text-2xl md:text-3xl font-bold text-[#071A2B] mb-2.5">
                    مشاريعنا السابقة ونماذج الأعمال
                  </h2>
                  <p className="text-slate-600 text-sm md:text-base max-w-2xl leading-relaxed">
                    نماذج حقيقية لبوردات PCB ولوحات تحكم وأنظمة IoT تم تصميمها وتصنيعها واختبارها للتشغيل الفعلي. اضغط على أي صورة للمعاينة المكبرة.
                  </p>
                </div>

                {/* Animated Segmented Filter Tabs */}
                <div
                  className="inline-flex flex-wrap items-center gap-1 p-1 bg-[#EFECE3] border border-[#E5E3DC] rounded-lg self-start"
                  role="tablist"
                  aria-label="تصنيف المشاريع السابقة"
                >
                  {CATEGORIES.map((cat) => {
                    const active = projectFilter === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setProjectFilter(cat)}
                        className={`relative px-3.5 py-2 text-xs sm:text-sm font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                          active ? 'text-[#071A2B]' : 'text-slate-600 hover:text-[#071A2B]'
                        }`}
                      >
                        {active && (
                          <motion.span
                            layoutId="project-filter-active"
                            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                            className="absolute inset-0 bg-white rounded-md shadow-xs"
                          />
                        )}
                        <span className="relative z-10">{cat}</span>
                      </button>
                    );
                  })}
                </div>
              </Reveal>

              {filteredProjects.length === 0 ? (
                <div className="bg-white border border-[#E5E3DC] rounded-xl p-12 text-center text-slate-500">
                  لا توجد مشاريع في هذا التصنيف حالياً.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-7">
                  {filteredProjects.map((prj, idx) => {
                    const galleryUrls = getProjectGallery(prj);
                    return (
                      <motion.article
                        key={prj.id}
                        initial={{ opacity: 0, y: 18 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, amount: 0.06 }}
                        transition={{
                          duration: 0.45,
                          delay: (idx % 3) * 0.07,
                          ease: [0.16, 1, 0.3, 1],
                        }}
                        className="bg-white border border-[#E5E3DC] rounded-xl overflow-hidden flex flex-col hover:border-[#C9C4B6] hover:shadow-sm transition-all"
                      >
                        {/* Clean Clickable Image Stage (Zoom prompt appears subtly on hover only) */}
                        <div className="group relative aspect-[16/10] w-full bg-slate-100 border-b border-[#E5E3DC] overflow-hidden">
                          <button
                            type="button"
                            onClick={() => openProjectLightbox(prj, 0)}
                            aria-label={`تكبير صورة مشروع ${prj.title}`}
                            className="block w-full h-full text-right cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1D5F8A]"
                          >
                            <ResilientImage
                              src={prj.image}
                              alt={prj.title}
                              className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                            />
                            <div
                              aria-hidden="true"
                              className="absolute inset-0 bg-[#071A2B]/0 group-hover:bg-[#071A2B]/35 transition-colors duration-200 flex items-center justify-center"
                            >
                              <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/95 text-[#071A2B] text-xs font-semibold shadow-sm">
                                <ZoomIn className="w-3.5 h-3.5" />
                                <span>معاينة الصورة</span>
                              </span>
                            </div>
                          </button>
                        </div>

                        <div className="p-6 flex-1 flex flex-col">
                          {/* Quiet unboxed metadata line */}
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-2">
                            <span>{prj.category}</span>
                            {prj.year && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono-tech tabular-nums text-slate-600">
                                  {prj.year}
                                </span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <span>{prj.region}</span>
                            {galleryUrls.length > 1 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{galleryUrls.length} صور</span>
                              </>
                            )}
                          </div>
                          <h3 className="text-base sm:text-lg font-bold text-[#071A2B] mb-1.5">
                            {prj.title}
                          </h3>
                          {prj.architecture && (
                            <div
                              className="font-mono-tech text-xs text-[#1D5F8A] mb-2.5 truncate text-right"
                              dir="ltr"
                            >
                              {prj.architecture}
                            </div>
                          )}
                          <p className="text-sm text-slate-600 leading-relaxed mb-5 flex-1 line-clamp-3">
                            {prj.summary}
                          </p>
                          <div className="pt-3.5 border-t border-[#EFECE3] flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => setSelectedProject(prj)}
                              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#1D5F8A] hover:text-[#071A2B] cursor-pointer transition-colors"
                            >
                              <span>تفاصيل المواصفات الفنية</span>
                              <ArrowLeft className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </motion.article>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* 5. About & Quote Form Section: Balanced Two-Column Symmetry */}
          <section id="quote" className="py-16 md:py-24 bg-white border-t border-[#E5E3DC]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
                {/* Unified Company Info & Direct Channels Panel */}
                <Reveal className="lg:col-span-5 flex flex-col">
                  <div
                    id="about"
                    className="h-full bg-[#FAF9F5] border border-[#E5E3DC] rounded-xl p-6 sm:p-8 flex flex-col justify-between gap-6"
                  >
                    <div className="space-y-6">
                      <div>
                        <h2 className="headline-balance text-2xl md:text-3xl font-bold text-[#071A2B] mb-3">
                          {config.aboutTitle}
                        </h2>
                        <p className="text-sm md:text-base text-slate-600 leading-relaxed">
                          {config.aboutBody}
                        </p>
                      </div>

                      <div className="border-t border-[#E5E3DC] pt-5 space-y-4">
                        <div className="flex items-start gap-3">
                          <Clock className="w-5 h-5 text-[#1D5F8A] shrink-0 mt-0.5" />
                          <div>
                            <div className="text-sm font-bold text-[#071A2B]">مواعيد العمل</div>
                            <div className="text-sm text-slate-700 tabular-nums mt-0.5">
                              {config.workingHours}
                            </div>
                            <div className="text-xs text-slate-500 mt-1 leading-relaxed">
                              {config.workingDaysNote}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <MapPin className="w-5 h-5 text-[#1D5F8A] shrink-0 mt-0.5" />
                          <div>
                            <div className="text-sm font-bold text-[#071A2B]">نطاق العمل والشحن</div>
                            <div className="text-sm text-slate-600 mt-0.5">{config.regions}</div>
                          </div>
                        </div>

                        <p className="text-xs text-slate-600 leading-relaxed pt-1">
                          <strong className="text-[#071A2B]">ملاحظة التسعير والمعاينة: </strong>
                          {config.quotationTermsNote}
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-[#E5E3DC] pt-5 space-y-3">
                      <div className="text-sm font-bold text-[#071A2B]">
                        قنوات التواصل المباشر
                      </div>
                      <a
                        href={`tel:${cleanTel}`}
                        className="flex items-center justify-between py-2 text-sm text-slate-700 hover:text-[#1D5F8A] border-b border-[#EFECE3]"
                      >
                        <span className="flex items-center gap-2.5">
                          <Phone className="w-4 h-4 text-slate-400" />
                          <span>التليفون المباشر</span>
                        </span>
                        <span className="font-mono-tech text-left font-semibold" dir="ltr">
                          {config.phone}
                        </span>
                      </a>
                      <a
                        href={whatsappUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between py-2 text-sm text-slate-700 hover:text-emerald-700 border-b border-[#EFECE3]"
                      >
                        <span className="flex items-center gap-2.5">
                          <MessageCircle className="w-4 h-4 text-emerald-600" />
                          <span>واتساب</span>
                        </span>
                        <span className="font-mono-tech text-left font-semibold" dir="ltr">
                          {config.phone}
                        </span>
                      </a>
                      <a
                        href={`mailto:${config.email}`}
                        className="flex items-center justify-between py-2 text-sm text-slate-700 hover:text-[#1D5F8A]"
                      >
                        <span className="flex items-center gap-2.5">
                          <Mail className="w-4 h-4 text-slate-400" />
                          <span>البريد الإلكتروني</span>
                        </span>
                        <span className="font-mono-tech text-left" dir="ltr">
                          {config.email}
                        </span>
                      </a>

                      <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <a
                          href={whatsappUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span>محادثة واتساب</span>
                        </a>
                        <a
                          href={`tel:${cleanTel}`}
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold text-[#071A2B] bg-white hover:bg-[#EFECE3] border border-[#E5E3DC] rounded-lg transition-colors"
                        >
                          <Phone className="w-4 h-4" />
                          <span>اتصال هاتفي</span>
                        </a>
                      </div>
                    </div>
                  </div>
                </Reveal>

                {/* Clean Lead / Quote Capture Form */}
                <Reveal
                  delay={0.08}
                  className="lg:col-span-7 bg-white border border-[#E5E3DC] rounded-xl p-6 sm:p-8 flex flex-col justify-center"
                >
                  <h3 className="text-xl md:text-2xl font-bold text-[#071A2B] mb-1.5">
                    اطلب عرض سعر أو معاينة فنية
                  </h3>
                  <p className="text-sm text-slate-600 mb-6">
                    ابعتلنا تفاصيل مشروعك أو مواصفات البوردة، وهتتفتح رسالة واتساب مرتبة بكل بياناتك للفريق الهندسي فوراً.
                  </p>

                  {submittedId ? (
                    <div className="py-10 text-center space-y-4">
                      <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
                      <h4 className="text-lg font-bold text-[#071A2B]">
                        تم تجهيز وحفظ طلبك بنجاح
                      </h4>
                      <p className="text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
                        رقم الطلب المرجعي:{' '}
                        <span className="font-mono-tech font-semibold text-[#071A2B]">
                          {submittedId}
                        </span>
                        <br />
                        فريقنا الهندسي هيراجع التفاصيل ويتواصل معاك خلال ساعات العمل ({config.workingHours}).
                      </p>
                      <div className="pt-2 flex flex-wrap justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setSubmittedId(null);
                            setSubmittedWhatsappUrl(null);
                          }}
                          className="px-5 py-2.5 text-sm font-semibold text-[#071A2B] bg-[#FAF9F5] hover:bg-[#EFECE3] border border-[#E5E3DC] rounded-lg cursor-pointer"
                        >
                          إرسال طلب آخر
                        </button>
                        <a
                          href={submittedWhatsappUrl || whatsappUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span>إرسال الطلب عبر واتساب</span>
                        </a>
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                      {formError && (
                        <div
                          role="alert"
                          className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 font-medium"
                        >
                          {formError}
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label
                            htmlFor="q-name"
                            className="block text-sm font-semibold text-[#071A2B] mb-1.5"
                          >
                            الاسم <span className="text-red-600">*</span>
                          </label>
                          <input
                            id="q-name"
                            type="text"
                            required
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="مثال: م. محمد علي"
                            className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg focus:bg-white focus:outline-none focus:border-[#1D5F8A] focus:ring-2 focus:ring-[#1D5F8A]/15"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="q-company"
                            className="block text-sm font-semibold text-[#071A2B] mb-1.5"
                          >
                            الشركة / المصنع (اختياري)
                          </label>
                          <input
                            id="q-company"
                            type="text"
                            value={company}
                            onChange={(e) => setCompany(e.target.value)}
                            placeholder="اسم المصنع أو الشركة"
                            className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg focus:bg-white focus:outline-none focus:border-[#1D5F8A] focus:ring-2 focus:ring-[#1D5F8A]/15"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label
                            htmlFor="q-phone"
                            className="block text-sm font-semibold text-[#071A2B] mb-1.5"
                          >
                            رقم الموبايل / واتساب <span className="text-red-600">*</span>
                          </label>
                          <input
                            id="q-phone"
                            type="tel"
                            required
                            dir="ltr"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            placeholder="01000000000"
                            className="w-full px-3.5 py-2.5 text-sm text-right bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg font-mono-tech focus:bg-white focus:outline-none focus:border-[#1D5F8A] focus:ring-2 focus:ring-[#1D5F8A]/15"
                          />
                        </div>

                        <div>
                          <label
                            htmlFor="q-email"
                            className="block text-sm font-semibold text-[#071A2B] mb-1.5"
                          >
                            البريد الإلكتروني (اختياري)
                          </label>
                          <input
                            id="q-email"
                            type="email"
                            dir="ltr"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="name@company.com"
                            className="w-full px-3.5 py-2.5 text-sm text-right bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg font-latin focus:bg-white focus:outline-none focus:border-[#1D5F8A] focus:ring-2 focus:ring-[#1D5F8A]/15"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="sm:col-span-2">
                          <label
                            htmlFor="q-type"
                            className="block text-sm font-semibold text-[#071A2B] mb-1.5"
                          >
                            نوع الطلب
                          </label>
                          <select
                            id="q-type"
                            value={requestType}
                            onChange={(e) => setRequestType(e.target.value)}
                            className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg focus:bg-white focus:outline-none focus:border-[#1D5F8A] focus:ring-2 focus:ring-[#1D5F8A]/15"
                          >
                            {REQUEST_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label
                            htmlFor="q-qty"
                            className="block text-sm font-semibold text-[#071A2B] mb-1.5"
                          >
                            عدد البوردات (اختياري)
                          </label>
                          <input
                            id="q-qty"
                            type="number"
                            min={1}
                            max={100000}
                            dir="ltr"
                            value={boardCount}
                            onChange={(e) => setBoardCount(e.target.value)}
                            placeholder="مثال: 10"
                            className="w-full px-3.5 py-2.5 text-sm text-right font-mono-tech tabular-nums bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg focus:bg-white focus:outline-none focus:border-[#1D5F8A] focus:ring-2 focus:ring-[#1D5F8A]/15"
                          />
                        </div>
                      </div>

                      <div>
                        <label
                          htmlFor="q-details"
                          className="block text-sm font-semibold text-[#071A2B] mb-1.5"
                        >
                          تفاصيل المشروع أو المواصفات <span className="text-red-600">*</span>
                        </label>
                        <textarea
                          id="q-details"
                          rows={4}
                          required
                          value={details}
                          onChange={(e) => setDetails(e.target.value)}
                          placeholder="اكتب باختصار المطلوب: عدد البوردات أو نوع الماكينة، الجهود المطلوبة (24V / 220V)، وهل في ملفات Gerber جاهزة..."
                          className="w-full px-3.5 py-2.5 text-sm bg-[#FAF9F5] border border-[#D9D5CA] rounded-lg focus:bg-white focus:outline-none focus:border-[#1D5F8A] focus:ring-2 focus:ring-[#1D5F8A]/15"
                        />
                      </div>

                      <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <button
                          type="submit"
                          disabled={submitting}
                          className="px-6 py-3 text-sm font-semibold text-white bg-[#1D5F8A] hover:bg-[#164A6C] disabled:opacity-60 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                        >
                          {submitting ? 'جاري الإرسال...' : 'إرسال الطلب للفريق الهندسي'}
                        </button>
                        <span className="text-xs text-slate-500">
                          تُفتح رسالة واتساب جاهزة ببياناتك مباشرة بعد التأكيد.
                        </span>
                      </div>
                    </form>
                  )}
                </Reveal>
              </div>
            </div>
          </section>
        </main>

        {/* Quiet Midnight Navy Footer */}
        <footer className="bg-[#071A2B] text-slate-300 border-t border-white/10">
          <Reveal y={12} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-white/10">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-[#071A2B] shrink-0 flex items-center justify-center">
                  <ResilientImage
                    src={logoSrc}
                    alt={`شعار ${config.companyName}`}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <div className="font-latin text-lg font-bold text-[#F4EFE1] mb-0.5">
                    {config.companyName}
                  </div>
                  <div className="text-xs sm:text-sm text-slate-400">
                    {config.workingHours} · {config.regions}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-6 text-sm">
                <a href="#services" className="hover:text-[#F4EFE1] transition-colors">
                  الخدمات
                </a>
                <a href="#pcb" className="hover:text-[#F4EFE1] transition-colors">
                  تصنيع PCB
                </a>
                <a href="#projects" className="hover:text-[#F4EFE1] transition-colors">
                  المشاريع
                </a>
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 font-semibold transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  <span>واتساب ({config.phone})</span>
                </a>
                <button
                  type="button"
                  onClick={onOpenAdmin}
                  className="text-[#E7D8B9] hover:text-white font-semibold transition-colors cursor-pointer"
                >
                  لوحة تحكم الإدارة
                </button>
              </div>
            </div>
            <div className="pt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-400">
              <div>
                © {new Date().getFullYear()} {config.companyName} — جميع الحقوق محفوظة.
              </div>
              <div className="font-mono-tech">{config.domain}</div>
            </div>
          </Reveal>
        </footer>

        {/* Service Details Modal */}
        {selectedService && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selectedService.title}
            onClick={() => setSelectedService(null)}
            className="fixed inset-0 z-50 bg-[#071A2B]/65 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-[#E5E3DC] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
            >
              <div className="aspect-[16/9] w-full bg-slate-100 border-b border-[#E5E3DC] relative">
                <ResilientImage
                  src={selectedService.image}
                  alt={selectedService.title}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  aria-label="إغلاق"
                  onClick={() => setSelectedService(null)}
                  className="absolute top-3 left-3 w-10 h-10 rounded-lg bg-white/95 text-[#071A2B] border border-[#E5E3DC] flex items-center justify-center hover:bg-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 sm:p-8">
                <div className="text-xs text-slate-500 mb-2">
                  <span className="font-mono-tech font-semibold text-[#1D5F8A]">
                    {selectedService.orderLabel}.
                  </span>{' '}
                  {selectedService.category}
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-[#071A2B] mb-3">
                  {selectedService.title}
                </h3>
                <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-6">
                  {selectedService.fullDesc}
                </p>
                <div className="border-t border-[#EFECE3] pt-4 mb-6">
                  <h4 className="text-sm font-bold text-[#071A2B] mb-3">
                    المواصفات والنقاط الفنية
                  </h4>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {selectedService.specs.map((sp, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-[#1D5F8A] font-bold" aria-hidden="true">
                          •
                        </span>
                        <span>{sp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedService(null)}
                    className="px-4 py-2.5 text-sm font-semibold text-slate-700 bg-[#FAF9F5] hover:bg-[#EFECE3] border border-[#E5E3DC] rounded-lg cursor-pointer"
                  >
                    إغلاق
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      jumpToQuote(
                        selectedService.category === 'تصنيع PCB'
                          ? 'تصنيع PCB من ملفات Gerber'
                          : selectedService.category === 'إنترنت الأشياء HMI'
                          ? 'نظام Industrial IoT / شاشة HMI مخصصة'
                          : 'تصميم بوردة PCB ونظام تحكم جديد',
                        `طلب تسعير بخصوص: ${selectedService.title}`
                      )
                    }
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1D5F8A] hover:bg-[#164A6C] rounded-lg cursor-pointer"
                  >
                    اطلب تسعير لهذه الخدمة
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Project Details Modal */}
        {selectedProject && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={selectedProject.title}
            onClick={() => setSelectedProject(null)}
            className="fixed inset-0 z-50 bg-[#071A2B]/65 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white border border-[#E5E3DC] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-xl"
            >
              <div className="aspect-[16/9] w-full bg-slate-100 border-b border-[#E5E3DC] relative group">
                <button
                  type="button"
                  onClick={() => openProjectLightbox(selectedProject, 0)}
                  aria-label="تكبير صورة المشروع"
                  className="block w-full h-full cursor-zoom-in"
                >
                  <ResilientImage
                    src={selectedProject.image}
                    alt={selectedProject.title}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#071A2B]/85 text-white text-xs font-semibold shadow-sm hover:bg-[#1D5F8A] transition-colors">
                    <ZoomIn className="w-3.5 h-3.5" />
                    <span>تكبير الصورة</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label="إغلاق"
                  onClick={() => setSelectedProject(null)}
                  className="absolute top-3 left-3 w-10 h-10 rounded-lg bg-white/95 text-[#071A2B] border border-[#E5E3DC] flex items-center justify-center hover:bg-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {getProjectGallery(selectedProject).length > 1 && (
                <div className="px-6 pt-4 flex items-center gap-2 overflow-x-auto">
                  {getProjectGallery(selectedProject).map((url, idx) => (
                    <button
                      key={`modal-thumb-${idx}`}
                      type="button"
                      onClick={() => openProjectLightbox(selectedProject, idx)}
                      aria-label={`تكبير الصورة ${idx + 1}`}
                      className="w-16 h-11 rounded-md overflow-hidden border border-[#E5E3DC] hover:border-[#1D5F8A] shrink-0 cursor-zoom-in"
                    >
                      <ResilientImage
                        src={url}
                        alt={`${selectedProject.title} - ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}

              <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 mb-2">
                  <span>{selectedProject.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-tech text-slate-700">
                    {selectedProject.architecture}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{selectedProject.region}</span>
                  {selectedProject.year && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tech tabular-nums">{selectedProject.year}</span>
                    </>
                  )}
                  {selectedProject.client && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{selectedProject.client}</span>
                    </>
                  )}
                </div>
                <h3 className="text-xl sm:text-2xl font-bold text-[#071A2B] mb-3">
                  {selectedProject.title}
                </h3>
                <p className="text-sm sm:text-base text-slate-600 leading-relaxed mb-6">
                  {selectedProject.summary}
                </p>
                <div className="border-t border-[#EFECE3] pt-4 mb-6">
                  <h4 className="text-sm font-bold text-[#071A2B] mb-3">
                    المواصفات المنفذة
                  </h4>
                  <ul className="space-y-2 text-sm text-slate-700">
                    {selectedProject.specs.map((sp, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-[#1D5F8A] font-bold" aria-hidden="true">
                          •
                        </span>
                        <span>{sp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedProject(null)}
                    className="px-4 py-2.5 text-sm font-semibold text-slate-700 bg-[#FAF9F5] hover:bg-[#EFECE3] border border-[#E5E3DC] rounded-lg cursor-pointer"
                  >
                    إغلاق
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      jumpToQuote(
                        'تصميم بوردة PCB ونظام تحكم جديد',
                        `محتاج تنفيذ نظام مشابه لمشروع: ${selectedProject.title}`
                      )
                    }
                    className="px-5 py-2.5 text-sm font-semibold text-white bg-[#1D5F8A] hover:bg-[#164A6C] rounded-lg cursor-pointer"
                  >
                    اطلب تنفيذ نظام مشابه
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Interactive Image Lightbox / Zoom Modal */}
        {lightboxState && (
          <ImageLightbox
            images={lightboxState.images}
            initialIndex={lightboxState.initialIndex}
            onClose={() => setLightboxState(null)}
            onOpenSpecs={
              lightboxState.project
                ? () => {
                    const prj = lightboxState.project!;
                    setLightboxState(null);
                    setSelectedProject(prj);
                  }
                : undefined
            }
            onRequestSimilar={
              lightboxState.project
                ? () => {
                    const prj = lightboxState.project!;
                    setLightboxState(null);
                    jumpToQuote(
                      'تصميم بوردة PCB ونظام تحكم جديد',
                      `محتاج تنفيذ نظام مشابه لمشروع: ${prj.title}`
                    );
                  }
                : undefined
            }
          />
        )}

        {/* Compact Floating Controls: Back-to-Top + Compact Circular WhatsApp */}
        <div className="fixed bottom-5 left-5 z-30 flex items-center gap-2.5">
          <AnimatePresence>
            {showScrollTop && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.85, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.85, y: 8 }}
                transition={{ duration: 0.2 }}
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                aria-label="العودة للأعلى"
                title="العودة للأعلى"
                className="w-11 h-11 rounded-full bg-white/95 hover:bg-white text-[#071A2B] border border-[#D9D5CA] shadow-md flex items-center justify-center cursor-pointer transition-colors"
              >
                <ArrowUp className="w-4 h-4" />
              </motion.button>
            )}
          </AnimatePresence>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="تواصل معنا عبر واتساب"
            title="تواصل معنا عبر واتساب"
            className="group w-12 h-12 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg flex items-center justify-center transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            <MessageCircle className="w-5 h-5" />
          </a>
        </div>
      </div>
    </MotionConfig>
  );
}
