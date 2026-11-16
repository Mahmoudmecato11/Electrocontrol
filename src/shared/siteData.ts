export interface CapabilityStat {
  id: string;
  label: string;
  value: string;
}

export interface PcbPricingConfig {
  currency: string;
  baseSetupFee: number;
  pricePerSqCm: number;
  smallBoardEnabled: boolean;
  smallBoardMaxSideMm: number;
  smallBoardUnitPrice: number;
  smallBoardSetupFee: number;
  singleLayerMultiplier: number;
  fourLayerMultiplier: number;
  enigExtraFee: number;
  nonGreenMaskFee: number;
  thicknessExtraFee: number;
  stencilFee: number;
  minQuantity: number;
  globalDiscountPercent: number;
  discountQty10: number;
  discountQty20: number;
  discountQty50: number;
  discountQty100: number;
  leadTimeStandardDays: string;
  leadTimeFourLayerDays: string;
}

export const DEFAULT_PCB_PRICING: PcbPricingConfig = {
  currency: 'ج.م',
  baseSetupFee: 250,
  pricePerSqCm: 0.85,
  smallBoardEnabled: true,
  smallBoardMaxSideMm: 100,
  smallBoardUnitPrice: 45,
  smallBoardSetupFee: 0,
  singleLayerMultiplier: 0.88,
  fourLayerMultiplier: 2.3,
  enigExtraFee: 350,
  nonGreenMaskFee: 80,
  thicknessExtraFee: 120,
  stencilFee: 350,
  minQuantity: 5,
  globalDiscountPercent: 0,
  discountQty10: 8,
  discountQty20: 15,
  discountQty50: 22,
  discountQty100: 28,
  leadTimeStandardDays: '5 - 7 أيام عمل',
  leadTimeFourLayerDays: '7 - 10 أيام عمل',
};

export type PanelRailMode = 'none' | '2sides' | '4sides';

export interface PcbPanelConfig {
  enabled: boolean;
  cols: number;
  rows: number;
  railMode: PanelRailMode;
  railWidthMm?: number;
  gapMm?: number;
}

export interface PanelDimensionsResult {
  isPanel: boolean;
  cols: number;
  rows: number;
  boardsPerPanel: number;
  railMode: PanelRailMode;
  railWidthMm: number;
  gapMm: number;
  panelWidthMm: number;
  panelHeightMm: number;
  railLeftRightMm: number;
  railTopBottomMm: number;
}

export function computePanelDimensionsMm(
  boardWidthMm: number,
  boardHeightMm: number,
  panel?: PcbPanelConfig
): PanelDimensionsResult {
  if (!panel?.enabled) {
    return {
      isPanel: false,
      cols: 1,
      rows: 1,
      boardsPerPanel: 1,
      railMode: 'none',
      railWidthMm: 0,
      gapMm: 0,
      panelWidthMm: Number(boardWidthMm.toFixed(1)),
      panelHeightMm: Number(boardHeightMm.toFixed(1)),
      railLeftRightMm: 0,
      railTopBottomMm: 0,
    };
  }

  const cols = Math.max(1, Math.min(30, Math.round(panel.cols || 1)));
  const rows = Math.max(1, Math.min(30, Math.round(panel.rows || 1)));
  const boardsPerPanel = cols * rows;
  const railMode: PanelRailMode = panel.railMode ?? '2sides';
  const railWidthMm =
    railMode === 'none' ? 0 : Math.max(3, Math.min(15, panel.railWidthMm ?? 5));
  const gapMm = Math.max(0, Math.min(10, panel.gapMm ?? 0));
  const railLeftRightMm = railMode === '2sides' || railMode === '4sides' ? railWidthMm : 0;
  const railTopBottomMm = railMode === '4sides' ? railWidthMm : 0;

  const panelWidthMm = Number(
    (boardWidthMm * cols + Math.max(0, cols - 1) * gapMm + railLeftRightMm * 2).toFixed(1)
  );
  const panelHeightMm = Number(
    (boardHeightMm * rows + Math.max(0, rows - 1) * gapMm + railTopBottomMm * 2).toFixed(1)
  );

  return {
    isPanel: true,
    cols,
    rows,
    boardsPerPanel,
    railMode,
    railWidthMm,
    gapMm,
    panelWidthMm,
    panelHeightMm,
    railLeftRightMm,
    railTopBottomMm,
  };
}

export interface PcbEstimateInput {
  widthMm: number;
  heightMm: number;
  layers: number;
  quantity: number;
  finish: 'HASL' | 'ENIG';
  maskColorId: string;
  thicknessMm: 1.0 | 1.6 | 2.0;
  includeStencil?: boolean;
  panel?: PcbPanelConfig;
}

export interface PcbEstimateResult {
  totalPrice: number;
  unitPrice: number;
  singleBoardPrice: number;
  areaCm2: number;
  discountPercent: number;
  qtyDiscountPercent: number;
  globalDiscountPercent: number;
  isSmallBoardPromo: boolean;
  stencilCost: number;
  leadTime: string;
  currency: string;
  isPanel: boolean;
  panelCols: number;
  panelRows: number;
  boardsPerPanel: number;
  totalBoardsCount: number;
  panelWidthMm: number;
  panelHeightMm: number;
}

export function calculatePcbEstimate(
  input: PcbEstimateInput,
  pricing?: Partial<PcbPricingConfig>
): PcbEstimateResult {
  const cfg: PcbPricingConfig = { ...DEFAULT_PCB_PRICING, ...(pricing ?? {}) };
  const qty = Math.max(1, Math.round(input.quantity || cfg.minQuantity));
  const panelDims = computePanelDimensionsMm(input.widthMm, input.heightMm, input.panel);
  const fabW = panelDims.panelWidthMm;
  const fabH = panelDims.panelHeightMm;

  const rawAreaCm2 = Math.max(0.1, (fabW * fabH) / 100);
  const billableAreaCm2 = Math.max(15, rawAreaCm2);

  const maxSideLimit = Math.max(10, cfg.smallBoardMaxSideMm || 100);
  const isSmallBoardPromo =
    Boolean(cfg.smallBoardEnabled) &&
    fabW <= maxSideLimit &&
    fabH <= maxSideLimit;

  let layerMult = 1;
  if (input.layers <= 1) {
    layerMult = cfg.singleLayerMultiplier;
  } else if (input.layers >= 4) {
    layerMult = cfg.fourLayerMultiplier;
  }

  let qtyDiscountPercent = 0;
  if (qty >= 100) qtyDiscountPercent = Math.max(0, cfg.discountQty100 ?? 28);
  else if (qty >= 50) qtyDiscountPercent = Math.max(0, cfg.discountQty50 ?? 22);
  else if (qty >= 20) qtyDiscountPercent = Math.max(0, cfg.discountQty20 ?? 15);
  else if (qty >= 10) qtyDiscountPercent = Math.max(0, cfg.discountQty10 ?? 8);

  const globalDiscountPercent = Math.max(0, cfg.globalDiscountPercent ?? 0);
  const discountPercent = Math.min(75, qtyDiscountPercent + globalDiscountPercent);
  const discountFactor = 1 - discountPercent / 100;

  const setupCost = isSmallBoardPromo
    ? Math.max(0, cfg.smallBoardSetupFee) * layerMult
    : Math.max(0, cfg.baseSetupFee) * layerMult;

  const boardsCost = isSmallBoardPromo
    ? qty * Math.max(1, cfg.smallBoardUnitPrice) * layerMult * discountFactor
    : qty * billableAreaCm2 * Math.max(0.05, cfg.pricePerSqCm) * layerMult * discountFactor;

  const finishCost = input.finish === 'ENIG' ? Math.max(0, cfg.enigExtraFee) : 0;
  const maskCost = input.maskColorId !== 'green' ? Math.max(0, cfg.nonGreenMaskFee) : 0;
  const thicknessCost = input.thicknessMm === 2.0 ? Math.max(0, cfg.thicknessExtraFee) : 0;
  const stencilCost = input.includeStencil ? Math.max(0, cfg.stencilFee) : 0;

  const totalPrice = Math.max(
    1,
    Math.round(setupCost + boardsCost + finishCost + maskCost + thicknessCost + stencilCost)
  );
  const unitPrice = Math.max(1, Math.round(totalPrice / qty));
  const totalBoardsCount = qty * panelDims.boardsPerPanel;
  const singleBoardPrice = Math.max(1, Math.round(totalPrice / Math.max(1, totalBoardsCount)));
  const leadTime =
    input.layers >= 4 ? cfg.leadTimeFourLayerDays : cfg.leadTimeStandardDays;

  return {
    totalPrice,
    unitPrice,
    singleBoardPrice,
    areaCm2: Number(rawAreaCm2.toFixed(1)),
    discountPercent,
    qtyDiscountPercent,
    globalDiscountPercent,
    isSmallBoardPromo,
    stencilCost,
    leadTime,
    currency: cfg.currency || 'ج.م',
    isPanel: panelDims.isPanel,
    panelCols: panelDims.cols,
    panelRows: panelDims.rows,
    boardsPerPanel: panelDims.boardsPerPanel,
    totalBoardsCount,
    panelWidthMm: panelDims.panelWidthMm,
    panelHeightMm: panelDims.panelHeightMm,
  };
}

export interface SiteConfig {
  companyName: string;
  domain: string;
  logoImage?: string;
  heroEyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  heroImage: string;
  heroPrimaryCta: string;
  heroSecondaryCta: string;
  aboutTitle: string;
  aboutBody: string;
  workingHours: string;
  workingDaysNote: string;
  regions: string;
  phone: string;
  whatsapp: string;
  email: string;
  quotationTermsNote: string;
  pcbBannerTitle: string;
  pcbBannerBody: string;
  pcbPricing?: PcbPricingConfig;
  capabilities: CapabilityStat[];
}

export type ServiceCategory = 'تصنيع PCB' | 'تحكم وأتمتة' | 'إنترنت الأشياء HMI';

export interface ServiceItem {
  id: string;
  orderLabel: string;
  category: ServiceCategory;
  title: string;
  shortDesc: string;
  fullDesc: string;
  specs: string[];
  image: string;
  featured: boolean;
  visible: boolean;
}

export interface ProjectItem {
  id: string;
  title: string;
  category: ServiceCategory;
  architecture: string;
  region: string;
  year?: string;
  client?: string;
  summary: string;
  specs: string[];
  image: string;
  gallery?: string[];
  visible: boolean;
}

export type InquiryStatus = 'جديد' | 'تحت المراجعة' | 'تم التسعير' | 'مكتمل';

export interface InquiryItem {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  requestType: string;
  details: string;
  status: InquiryStatus;
  notes: string;
  createdAt: string;
}

export interface MediaAsset {
  id: string;
  label: string;
  url: string;
  uploadedAt: string;
}

export interface SiteStoreData {
  config: SiteConfig;
  services: ServiceItem[];
  projects: ProjectItem[];
  inquiries: InquiryItem[];
  media: MediaAsset[];
  adminPassword: string;
}

export const DEFAULT_MEDIA: MediaAsset[] = [
  {
    id: 'm-logo',
    label: 'شعار Electro Control الرسمي',
    url: '/assets/aistudio/FB_IMG_1794781004368_3087cab9.jpg',
    uploadedAt: '2026-11-15',
  },
  {
    id: 'm-hero',
    label: 'معمل تطوير واختبار البوردات',
    url: '/src/assets/images/hero_pcb_workbench_1794745468921.jpg',
    uploadedAt: '2026-11-15',
  },
  {
    id: 'm-pcb',
    label: 'تصنيع بوردات PCB والتغليف',
    url: '/src/assets/images/service_pcb_manufacturing_1794745468677.jpg',
    uploadedAt: '2026-11-15',
  },
  {
    id: 'm-panel',
    label: 'لوحة تحكم صناعية متكاملة',
    url: '/src/assets/images/service_control_panel_1794745469393.jpg',
    uploadedAt: '2026-11-15',
  },
  {
    id: 'm-hmi',
    label: 'شاشة HMI وربط Ethernet / RS485',
    url: '/src/assets/images/service_iot_hmi_1794745470483.jpg',
    uploadedAt: '2026-11-15',
  },
  {
    id: 'm-coldroom',
    label: 'بوردة تحكم غرف تبريد وحساسات',
    url: '/src/assets/images/project_coldroom_controller_1794745470838.jpg',
    uploadedAt: '2026-11-15',
  },
];

export const DEFAULT_SITE_DATA: SiteStoreData = {
  adminPassword: 'electro2026',
  config: {
    companyName: 'Electro Control',
    domain: 'electrocontrol-eg.com',
    logoImage: '/assets/aistudio/FB_IMG_1794781004368_3087cab9.jpg',
    heroEyebrow: 'هندسة إلكترونية وأنظمة تحكم صناعية مخصصة',
    heroTitle: 'تصميم وتصنيع بوردات الـ PCB وأنظمة التحكم المخصصة من الفكرة للتشغيل',
    heroSubtitle:
      'في Electro Control بنصمم ونصنع حلول إلكترونية مخصوصة لشغلك أو خط إنتاجك بدل الاعتماد على وحدات جاهزة محدودة. بدايةً من تصنيع وتجميع الـ PCB بأعلى جودة وأفضل سعر في مصر، لحد برمجة الميكروكنترولر وربط الحساسات وشاشات الـ HMI.',
    heroImage: '/src/assets/images/hero_pcb_workbench_1794745468921.jpg',
    heroPrimaryCta: 'اطلب عرض سعر أو معاينة',
    heroSecondaryCta: 'استكشف خدماتنا',
    aboutTitle: 'شغل هندسي عملي مصمم على مقاس مشروعك',
    aboutBody:
      'سواء عندك ملفات Gerber جاهزة وعايز تصنيع وتجميع سريع، أو عندك ماكينة محتاجة لوحة تحكم مخصصة، أو عايز تحول نظام PLC قديم لبوردة مستقرة بتكلفة أقل — فريقنا الهندسي بيتابع معاك خطوة بخطوة من المعاينة الفنية والتصميم لحد الاختبار والتسليم في مصر والسعودية.',
    workingHours: 'السبت إلى الخميس · 9:00 صباحاً – 5:00 مساءً',
    workingDaysNote: 'الجمعة إجازة رسمية — تقدر تبعت تفاصيل مشروعك في أي وقت وفريقنا الهندسي هيراجعها ويرد عليك.',
    regions: 'مصر والمملكة العربية السعودية',
    phone: '01080269003',
    whatsapp: '201080269003',
    email: 'info@electrocontrol-eg.com',
    quotationTermsNote:
      'عروض الأسعار سارية لمدة 30 يوماً. في مشاريع الماكينات القائمة، يتم تأكيد تكلفة التنفيذ النهائية بعد المعاينة الفنية لتحديد المدخلات والمخرجات المطلوبة.',
    pcbBannerTitle: 'تصنيع PCB بجودة عالمية وأسعار تنافسية في مصر',
    pcbBannerBody:
      'بدءاً من 5 بوردات فقط (Single / Double / Multi-Layer) — مع خدمة تصميم ملفات Gerber لو مش جاهزة، وخيار التجميع الكامل للمكونات.',
    pcbPricing: DEFAULT_PCB_PRICING,
    capabilities: [
      { id: 'c1', label: 'أقل كمية تصنيع PCB', value: 'بدءاً من 5 بوردات' },
      { id: 'c2', label: 'منصات التحكم والبرمجة', value: 'STM32 / ESP32 / PIC' },
      { id: 'c3', label: 'الربط والشاشات الصناعية', value: 'Ethernet / RS485 / HMI' },
      { id: 'c4', label: 'نطاق التنفيذ والشحن', value: 'مصر والسعودية' },
    ],
  },
  services: [
    {
      id: 'srv-pcb',
      orderLabel: '01',
      category: 'تصنيع PCB',
      title: 'تصنيع وتجميع بوردات الـ PCB',
      shortDesc:
        'تصنيع PCB بجودة عالمية وأرخص سعر تنافسي في مصر بدءاً من 5 بوردات، مع إمكانية التصميم من الصفر وتجميع المكونات.',
      fullDesc:
        'بنوفر تصنيع بوردات Single Layer و Double Layer و Multi-Layer بجودة مطابقة للمصانع العالمية. لو عندك ملفات Gerber بننفذ التصنيع فوراً، ولو لسه الفكرة على ورق بنصمم الـ Schematic والـ Layout كامل ونوفر المكونات والتجميع.',
      specs: [
        'الحد الأدنى للطلب يبدأ من 5 بوردات (MOQ)',
        'تصنيع 1 أو 2 أو متعددة الطبقات',
        'تصميم Gerber من الصفر أو تعديل تصميم قائم',
        'تجميع مكونات SMD و Through-Hole واختبار التشغيل',
      ],
      image: '/src/assets/images/service_pcb_manufacturing_1794745468677.jpg',
      featured: true,
      visible: true,
    },
    {
      id: 'srv-control',
      orderLabel: '02',
      category: 'تحكم وأتمتة',
      title: 'أنظمة التحكم الصناعية وتحويل الـ PLC',
      shortDesc:
        'تصميم لوحات وبوردات تحكم للماكينات، المواتير، الصمامات، وغرف التبريد بحماية صناعية كاملة وعزل كهربائي.',
      fullDesc:
        'بنحول متطلبات تشغيل الماكينة أو وظائف الـ PLC إلى بوردات تحكم مخصصة مبنية على معالجات STM32 و ESP32. كل تصميم بيكون مزود بحماية ضد ارتفاع الجهد المفاجئ وعكس القطبية ومداخل 24V معزولة.',
      specs: [
        'معالجة مستقرة بـ STM32 / PIC / ATmega / ESP32',
        'مداخل 12V / 24V لحساسات NPN و PNP و 4-20mA',
        'مخارج ريليهات 220V / 24V أو MOSFET للتحكم في المواتير',
        'حماية صناعية للباور (MOV / Fuse / Optocouplers / ESD)',
      ],
      image: '/src/assets/images/service_control_panel_1794745469393.jpg',
      featured: false,
      visible: true,
    },
    {
      id: 'srv-iot',
      orderLabel: '03',
      category: 'إنترنت الأشياء HMI',
      title: 'حلول Industrial IoT وشاشات اللمس HMI',
      shortDesc:
        'بدائل مخصصة لأنظمة SCADA للمراقبة والتحكم عن بُعد مع شاشات لمس DWIN و Topway وربط شبكي مستقر.',
      fullDesc:
        'لو محتاج تراقب خط الإنتاج أو تسجل بيانات الحرارة والضغط والتيار لحظياً بدون التقيد بمنصات مغلقة، بنصمم لك وحدة IoT خاصة بيك مع شاشة لمس HMI أو لوحة متابعة ويب، وتنبيهات فورية للأعطال.',
      specs: [
        'شاشات لمس صناعية DWIN / Topway / Tablet HMI',
        'اتصال شبكي عبر Ethernet W5500 / RS485 / MQTT / Wi-Fi / LoRa',
        'تسجيل البيانات على SD Card وقراءة Load Cell و Thermocouples',
        'مراقبة الطاقة، سرعة المواتير، وتنبيهات الأعطال',
      ],
      image: '/src/assets/images/service_iot_hmi_1794745470483.jpg',
      featured: false,
      visible: true,
    },
    {
      id: 'srv-reverse',
      orderLabel: '04',
      category: 'تحكم وأتمتة',
      title: 'الهندسة العكسية والمعاينة الفنية للماكينات',
      shortDesc:
        'فحص الكروت الإلكترونية التالفة أو النادرة وإعادة تصميمها وبرمجتها محلياً بضمان الاستقرار وسهولة الصيانة.',
      fullDesc:
        'عندك ماكينة واقفة بسبب كارتة قديمة مش متوفرة في السوق؟ فريقنا بيعمل معاينة فنية للماكينة أو تحليل كهربائي ووظيفي للبوردة القديمة، وبنصنع بديل محلي أحدث وأسهل في الصيانة بنفس التوصيلات.',
      specs: [
        'معاينة فنية للماكينة قبل تحديد التكلفة النهائية',
        'تتبع الدوائر وتحليل الإشارات والـ Sequence المطلوب',
        'إعادة تصميم الـ PCB وكتابة Firmware جديدة بالكامل',
        'إمكانية إضافة بطاريات مجمعة أو تحديثات أمان للتشغيل',
      ],
      image: '/src/assets/images/project_coldroom_controller_1794745470838.jpg',
      featured: false,
      visible: true,
    },
  ],
  projects: [
    {
      id: 'prj-coldroom',
      title: 'وحدة تحكم متكاملة لغرف التبريد الصناعية',
      category: 'تحكم وأتمتة',
      architecture: '220VAC · 8 Relays · DS18B20 · HMI 10"',
      region: 'مصر',
      year: '2026',
      client: 'قطاع التبريد والتخزين الغذائي',
      summary:
        'بوردة تحكم رئيسية 220VAC مع 8 مخارج ريليه مستقلة (تبريد، مراوح مبخر ومكثف، سخانات إذابة، سخانات باب، إضاءة، إنذار) مع حساسين حرارة DS18B20 مضادين للماء وحساس باب وشاشة لمس 10 بوصة بالرسوم البيانية والجدولة.',
      specs: [
        '8 مخارج ريليه 220VAC قابلة للتخصيص',
        'حساسين DS18B20 بمدى -45 إلى +40 درجة مئوية',
        'إنذارات حرارة، فتح باب، انقطاع كهرباء، وضغط',
        'شاشة 10 بوصة للتحكم في الـ Setpoint والجدولة الزمنية',
      ],
      image: '/src/assets/images/project_coldroom_controller_1794745470838.jpg',
      gallery: [
        '/src/assets/images/service_iot_hmi_1794745470483.jpg',
        '/src/assets/images/hero_pcb_workbench_1794745468921.jpg',
      ],
      visible: true,
    },
    {
      id: 'prj-eth-board',
      title: 'بوردة أتمتة صناعية بشبكة Ethernet W5500',
      category: 'إنترنت الأشياء HMI',
      architecture: 'W5500 Ethernet · 4× 12V NPN · USB-C',
      region: 'إنتاج مخصص',
      year: '2026',
      client: 'خطوط إنتاج ومراقبة مصانع',
      summary:
        'لوحة تحكم وتجميع إشارات صناعية مصممة للعمل في بيئات المصانع، تدعم التغذية من Ethernet أو مصدر 12V DC خارجي، مع 4 مداخل حساسات 12V NPN، و5 مداخل كاميرات، واتصال UART ومنفذ USB-C للبرمجة.',
      specs: [
        'شريحة شبكة W5500 واتصال TCP / MQTT مستقر',
        '4 مداخل حساسات صناعية 12V NPN ثلاثية الأطراف',
        'تغذية مزدوجة (Ethernet Power أو 12V DC)',
        'منفذ USB-C للبرمجة والتحديث مع حماية ESD',
      ],
      image: '/src/assets/images/service_iot_hmi_1794745470483.jpg',
      gallery: [
        '/src/assets/images/service_pcb_manufacturing_1794745468677.jpg',
      ],
      visible: true,
    },
    {
      id: 'prj-pcb-batch',
      title: 'تصنيع دفعات PCB متعددة الطبقات للشركات',
      category: 'تصنيع PCB',
      architecture: 'Single / Double / Multi-Layer · MOQ 5 pcs',
      region: 'مصر والسعودية',
      year: '2025',
      client: 'شركات هندسية ومصانع إلكترونيات',
      summary:
        'توفير تصنيع احترافي للبوردات الإلكترونية من ملفات Gerber أو التصميم المخصص، بجودة لحام وممانعة معزولة وتغليف مخصص للشحن الآمن للعملاء والمصانع.',
      specs: [
        'مقارنة جودة وسعر ممتازة للكميات الصغيرة والمتوسطة',
        'إمكانية تسليم بوردات فارغة أو مجمعة بالمكونات',
        'فحص جودة المسارات والـ Solder Mask قبل التسليم',
        'تجهيز ملفات الإنتاج والـ BOM للعملاء بدون ملفات Gerber',
      ],
      image: '/src/assets/images/service_pcb_manufacturing_1794745468677.jpg',
      gallery: [
        '/src/assets/images/hero_pcb_workbench_1794745468921.jpg',
      ],
      visible: true,
    },
    {
      id: 'prj-lora-gate',
      title: 'نظام تحكم في البوابات الإلكترونية عبر LoRa',
      category: 'إنترنت الأشياء HMI',
      architecture: 'LoRa Long-Range · STM32 / ESP32 · Relays',
      region: 'شحن للسعودية',
      year: '2025',
      client: 'منشآت ومجمعات لوجستية',
      summary:
        'وحدات تحكم لاسلكية بعيدة المدى بتقنية LoRa لتشغيل ومراقبة البوابات الإلكترونية مع أنظمة أمان وتشغيل موثوقة، تم تصنيعها واختبارها وشحنها من مصر إلى المملكة العربية السعودية.',
      specs: [
        'اتصال LoRa طويل المدى مستقر في المساحات المفتوحة',
        'دوائر قيادة ريليهات محمية ومزودة بعزل وحماية تيار',
        'اختبار إجهاد متكامل قبل التغليف والشحن الدولي',
        'قابلية الدمج مع حساسات المواقف الذكية ومراقبة الحالة',
      ],
      image: '/src/assets/images/service_control_panel_1794745469393.jpg',
      gallery: [
        '/src/assets/images/project_coldroom_controller_1794745470838.jpg',
      ],
      visible: true,
    },
  ],
  inquiries: [
    {
      id: 'inq-sample-1',
      name: 'م. أحمد محمود',
      company: 'المتحدة للصناعات الغذائية',
      phone: '01012345678',
      email: 'ahmed@united-food.eg',
      requestType: 'معاينة ماكينة لتصنيع نظام تحكم',
      details:
        'عندنا ماكينة تغليف كارتتها القديمة عطلت، محتاجين معاينة فنية لتصنيع بوردة تحكم بديلة بـ 6 مخارج ريليه وشاشة بسيطة لضبط الوقت والسرعة.',
      status: 'تحت المراجعة',
      notes: 'تم التواصل لتحديد موعد المعاينة — التسعير النهائي يتأكد بعد فحص الماكينة.',
      createdAt: '2026-11-14T11:30:00Z',
    },
  ],
  media: DEFAULT_MEDIA,
};
