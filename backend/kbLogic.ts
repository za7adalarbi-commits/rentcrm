// Pure Knowledge Base domain logic, XSS-safe rich text sanitizer, normalization keys,
// dynamic quick-reply variable substitution, and search scoring helpers.

export const KB_SECTIONS = [
  { id: 'overview', labelAr: 'نظرة عامة', labelEn: 'Overview' },
  { id: 'companies', labelAr: 'شركات التأجير', labelEn: 'Rental Companies' },
  { id: 'branches', labelAr: 'الفروع والعناوين', labelEn: 'Branches & Locations' },
  { id: 'rental_gate_policies', labelAr: 'سياسات بوابة التأجير', labelEn: 'Rental Gate Policies' },
  { id: 'company_policies', labelAr: 'سياسات شركات التأجير', labelEn: 'Company Policies' },
  { id: 'booking_pickup_terms', labelAr: 'شروط الحجز والاستلام', labelEn: 'Booking & Pickup Terms' },
  { id: 'cancellation_refunds', labelAr: 'الإلغاء والاسترداد', labelEn: 'Cancellation & Refunds' },
  { id: 'faq', labelAr: 'الأسئلة الشائعة', labelEn: 'FAQ' },
  { id: 'quick_replies', labelAr: 'الردود الجاهزة', labelEn: 'Quick Replies' }
] as const;

export type KbSectionId = (typeof KB_SECTIONS)[number]['id'];

export const KB_POLICY_CATEGORIES = [
  { id: 'rental_gate', section: 'rental_gate_policies', labelAr: 'سياسات بوابة التأجير', labelEn: 'Rental Gate Policies' },
  { id: 'company_policy', section: 'company_policies', labelAr: 'سياسات شركات التأجير', labelEn: 'Company Policies' },
  { id: 'booking_terms', section: 'booking_pickup_terms', labelAr: 'شروط الحجز', labelEn: 'Booking Terms' },
  { id: 'pickup_return_terms', section: 'booking_pickup_terms', labelAr: 'شروط الاستلام والتسليم', labelEn: 'Pickup & Return Terms' },
  { id: 'age_license_terms', section: 'booking_pickup_terms', labelAr: 'شروط العمر ورخصة القيادة', labelEn: 'Age & Driver License Terms' },
  { id: 'mileage_policy', section: 'booking_pickup_terms', labelAr: 'سياسة الكيلومترات', labelEn: 'Mileage Policy' },
  { id: 'delivery_pickup_policy', section: 'booking_pickup_terms', labelAr: 'سياسة التوصيل والاستلام', labelEn: 'Delivery & Pickup Policy' },
  { id: 'delay_extension_policy', section: 'booking_pickup_terms', labelAr: 'سياسة التأخير والتمديد', labelEn: 'Delay & Extension Policy' },
  { id: 'cancellation_policy', section: 'cancellation_refunds', labelAr: 'سياسة الإلغاء', labelEn: 'Cancellation Policy' },
  { id: 'refund_policy', section: 'cancellation_refunds', labelAr: 'سياسة الاسترداد', labelEn: 'Refund Policy' },
  { id: 'wallet_points_policy', section: 'cancellation_refunds', labelAr: 'سياسة المحفظة والنقاط', labelEn: 'Wallet & Points Policy' }
] as const;

export const KB_FAQ_CATEGORIES = [
  { id: 'general', labelAr: 'عام', labelEn: 'General' },
  { id: 'booking', labelAr: 'الحجوزات', labelEn: 'Bookings' },
  { id: 'pickup_return', labelAr: 'الاستلام والتسليم', labelEn: 'Pickup & Return' },
  { id: 'documents_age', labelAr: 'المستندات والعمر والرخصة', labelEn: 'Documents, Age & License' },
  { id: 'payments_refunds', labelAr: 'الدفع والإلغاء والاسترداد', labelEn: 'Payments & Refunds' },
  { id: 'mileage_delivery', labelAr: 'الكيلومترات والتوصيل', labelEn: 'Mileage & Delivery' },
  { id: 'wallet_points', labelAr: 'المحفظة والنقاط', labelEn: 'Wallet & Points' },
  { id: 'company_specific', labelAr: 'سياسات شركات التأجير', labelEn: 'Rental Companies' },
  { id: 'complaints', labelAr: 'الشكاوى والدعم', labelEn: 'Complaints & Support' }
] as const;

export const KB_QUICK_REPLY_CATEGORIES = [
  { id: 'greeting', labelAr: 'الترحيب وإنهاء المحادثة', labelEn: 'Greeting & Closing' },
  { id: 'bookings', labelAr: 'الحجوزات', labelEn: 'Bookings' },
  { id: 'payments_invoices', labelAr: 'الدفع والفواتير', labelEn: 'Payments & Invoices' },
  { id: 'delivery_pickup', labelAr: 'التوصيل والاستلام', labelEn: 'Delivery & Pickup' },
  { id: 'extensions_delays', labelAr: 'التمديد والتأخير', labelEn: 'Extensions & Delays' },
  { id: 'cancellation_refunds', labelAr: 'الإلغاء والاسترداد', labelEn: 'Cancellation & Refunds' },
  { id: 'wallet_points', labelAr: 'المحفظة والنقاط', labelEn: 'Wallet & Points' },
  { id: 'complaints_issues', labelAr: 'الشكاوى والمشكلات', labelEn: 'Complaints & Issues' },
  { id: 'coverage_cities', labelAr: 'التغطية والمدن', labelEn: 'Coverage & Cities' },
  { id: 'rental_companies', labelAr: 'شركات التأجير', labelEn: 'Rental Companies' }
] as const;

export const KB_DYNAMIC_VARIABLES = [
  { key: 'customer_name', token: '{customer_name}', labelAr: 'اسم العميل', labelEn: 'Customer Name' },
  { key: 'booking_number', token: '{booking_number}', labelAr: 'رقم الحجز', labelEn: 'Booking Number' },
  { key: 'company_name', token: '{company_name}', labelAr: 'اسم الشركة', labelEn: 'Company Name' },
  { key: 'branch_name', token: '{branch_name}', labelAr: 'اسم الفرع', labelEn: 'Branch Name' },
  { key: 'pickup_date', token: '{pickup_date}', labelAr: 'تاريخ الاستلام', labelEn: 'Pickup Date' }
] as const;

const POLICY_CATEGORY_SECTION_MAP: Record<string, string> = KB_POLICY_CATEGORIES.reduce(
  (acc, item) => {
    acc[item.id] = item.section;
    return acc;
  },
  {} as Record<string, string>
);

export function getSectionForPolicyCategory(category: string, explicitSection?: string): string {
  const cat = String(category || '').trim();
  if (POLICY_CATEGORY_SECTION_MAP[cat]) {
    return POLICY_CATEGORY_SECTION_MAP[cat];
  }
  const sec = String(explicitSection || '').trim();
  if (
    sec === 'rental_gate_policies' ||
    sec === 'company_policies' ||
    sec === 'booking_pickup_terms' ||
    sec === 'cancellation_refunds'
  ) {
    return sec;
  }
  return 'rental_gate_policies';
}

export function normalizeArabicSearchText(input: unknown): string {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return '';
  return raw
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeKbKey(...parts: unknown[]): string {
  const normalized = parts
    .map((p) => normalizeArabicSearchText(p))
    .join('|')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
}

export function buildCompanyNormalizedName(name: unknown): string {
  return normalizeArabicSearchText(name);
}

export function buildBranchNormalizedKey(companyId: unknown, city: unknown, branchName: unknown): string {
  return normalizeKbKey(companyId, city, branchName);
}

export function buildPolicyNormalizedKey(sectionKey: unknown, category: unknown, companyId: unknown, city: unknown, title: unknown): string {
  return normalizeKbKey(sectionKey, category, companyId || 'global', city || 'all', title);
}

export function buildFaqNormalizedKey(companyId: unknown, question: unknown): string {
  return normalizeKbKey(companyId || 'global', question);
}

export function buildQuickReplyNormalizedKey(language: unknown, companyId: unknown, title: unknown): string {
  return normalizeKbKey(language || 'ar', companyId || 'global', title);
}

export function normalizeStringList(raw: unknown): string[] {
  let items: string[] = [];
  if (Array.isArray(raw)) {
    items = raw.map((x) => String(x ?? '').trim());
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          items = parsed.map((x) => String(x ?? '').trim());
        }
      } catch {
        items = trimmed.split(/[,\n،]+/).map((x) => x.trim());
      }
    } else if (trimmed) {
      items = trimmed.split(/[,\n،]+/).map((x) => x.trim());
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item) continue;
    const norm = normalizeArabicSearchText(item);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(item);
  }
  return out;
}

export function mergeCompanyAndBranchCities(companyCities: unknown, branchCities: unknown[]): string[] {
  const merged = [...normalizeStringList(companyCities), ...branchCities.map((c) => String(c ?? '').trim())];
  return normalizeStringList(merged);
}

export function sanitizeUrl(raw: unknown, allowDataImage = false): string {
  const val = String(raw ?? '').trim();
  if (!val) return '';
  const compact = val.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
  if (
    compact.startsWith('javascript:') ||
    compact.startsWith('vbscript:') ||
    compact.startsWith('data:text/') ||
    compact.startsWith('data:application/')
  ) {
    return '';
  }
  if (allowDataImage && /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(compact)) {
    return val;
  }
  if (
    compact.startsWith('https://') ||
    compact.startsWith('http://') ||
    compact.startsWith('mailto:') ||
    compact.startsWith('tel:') ||
    val.startsWith('/') ||
    val.startsWith('./')
  ) {
    return val;
  }
  if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(val)) {
    return `https://${val}`;
  }
  return '';
}

const ALLOWED_HTML_TAGS = new Set([
  'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'del',
  'h3', 'h4', 'h5', 'ul', 'ol', 'li', 'blockquote',
  'code', 'pre', 'hr', 'a', 'span', 'div', 'img'
]);

const STRIP_WITH_BODY_REGEX = /<\s*(script|style|iframe|object|embed|svg|math|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;
const SELF_CLOSING_DANGER_REGEX = /<\s*(script|style|iframe|object|embed|svg|math|meta|link|base|form|input|button|textarea)\b[^>]*\/?>/gi;

function escapeHtmlAttr(v: string): string {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseTagAttrs(rawAttrs: string): Record<string, string> {
  const map: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(rawAttrs)) !== null) {
    const key = String(m[1] || '').toLowerCase();
    if (!key || key.startsWith('on') || key === 'srcdoc' || key === 'formaction') continue;
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    map[key] = val;
  }
  return map;
}

export function sanitizeKbRichHtml(rawHtml: unknown): string {
  const raw = String(rawHtml ?? '').trim();
  if (!raw) return '';

  // Remove HTML comments and dangerous tags (including bodies)
  let cleaned = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(STRIP_WITH_BODY_REGEX, '')
    .replace(SELF_CLOSING_DANGER_REGEX, '');

  // If plain text with newlines and no tags, wrap lines safely
  if (!/<[a-z][\s\S]*>/i.test(cleaned)) {
    const escaped = cleaned
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return escaped
      .split(/\n{2,}/)
      .map((para) => `<p>${para.replace(/\n/g, '<br />')}</p>`)
      .join('');
  }

  cleaned = cleaned.replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g, (_full, slash, rawTag, rawAttrs) => {
    const tag = String(rawTag || '').toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(tag)) {
      return '';
    }
    if (slash) {
      if (tag === 'br' || tag === 'hr' || tag === 'img') return '';
      return `</${tag}>`;
    }

    const attrs = parseTagAttrs(String(rawAttrs || ''));
    const safeParts: string[] = [];

    if (attrs.dir === 'rtl' || attrs.dir === 'ltr' || attrs.dir === 'auto') {
      safeParts.push(`dir="${attrs.dir}"`);
    }

    if (attrs.class) {
      const safeClasses = attrs.class
        .split(/\s+/)
        .filter((c) => /^rg-kb-[a-z0-9_-]+$/i.test(c))
        .join(' ');
      if (safeClasses) {
        safeParts.push(`class="${escapeHtmlAttr(safeClasses)}"`);
      }
    }

    if (tag === 'a') {
      const safeHref = sanitizeUrl(attrs.href || '', false);
      if (safeHref) {
        safeParts.push(`href="${escapeHtmlAttr(safeHref)}"`);
        if (safeHref.startsWith('http://') || safeHref.startsWith('https://')) {
          safeParts.push('target="_blank"', 'rel="noopener noreferrer"');
        }
      }
    }

    if (tag === 'img') {
      const safeSrc = sanitizeUrl(attrs.src || '', true);
      if (!safeSrc) return '';
      safeParts.push(`src="${escapeHtmlAttr(safeSrc)}"`);
      if (attrs.alt) {
        safeParts.push(`alt="${escapeHtmlAttr(attrs.alt.slice(0, 140))}"`);
      }
      safeParts.push('loading="lazy"');
      return `<img ${safeParts.join(' ')} />`;
    }

    if (tag === 'br' || tag === 'hr') {
      return `<${tag} />`;
    }

    return safeParts.length ? `<${tag} ${safeParts.join(' ')}>` : `<${tag}>`;
  });

  return cleaned.trim();
}

export function extractPlainTextFromHtml(rawHtml: unknown): string {
  const strVal = String(rawHtml ?? '');
  if (!strVal) return '';
  return strVal
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h3|h4|h5|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractQuickReplyVariables(template: unknown): string[] {
  const text = String(template ?? '');
  const found = new Set<string>();
  const matches = text.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
  for (const m of matches) {
    const key = m.slice(1, -1).trim();
    if (key) found.add(key);
  }
  return Array.from(found);
}

export function renderQuickReplyTemplate(
  template: unknown,
  variables: Record<string, string | number | undefined | null> = {}
): string {
  const text = String(template ?? '');
  return text.replace(/\{([a-zA-Z0-9_]+)\}/g, (full, key) => {
    const cleanKey = String(key || '').trim();
    if (!Object.prototype.hasOwnProperty.call(variables, cleanKey)) {
      return full;
    }
    const val = variables[cleanKey];
    const strVal = val === null || val === undefined ? '' : String(val).trim();
    return strVal ? strVal : full;
  });
}

export function normalizeAttachments(raw: unknown): Array<{ label: string; url: string; kind: 'link' | 'image' | 'file' }> {
  let list: any[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const out: Array<{ label: string; url: string; kind: 'link' | 'image' | 'file' }> = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item === 'string') {
      const safe = sanitizeUrl(item, true);
      if (!safe || seen.has(safe)) continue;
      seen.add(safe);
      out.push({
        label: safe.startsWith('data:image/') ? 'صورة مرفقة' : safe,
        url: safe,
        kind: safe.startsWith('data:image/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(safe) ? 'image' : 'link'
      });
      continue;
    }
    if (item && typeof item === 'object') {
      const safe = sanitizeUrl(item.url || item.href || '', true);
      if (!safe || seen.has(safe)) continue;
      seen.add(safe);
      const rawKind = String(item.kind || '').toLowerCase();
      const kind: 'link' | 'image' | 'file' =
        rawKind === 'image' || safe.startsWith('data:image/') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(safe)
          ? 'image'
          : (rawKind === 'file' ? 'file' : 'link');
      out.push({
        label: String(item.label || item.name || item.title || safe).trim().slice(0, 120),
        url: safe,
        kind
      });
    }
  }
  return out;
}

export interface KbUnifiedSearchResultItem {
  id: string;
  entityType: 'company' | 'branch' | 'policy' | 'faq' | 'quick_reply';
  title: string;
  subtitle: string;
  snippet: string;
  companyId: string;
  companyName: string;
  city: string;
  category: string;
  sectionKey: string;
  status: string;
  usageCount: number;
  updatedAt: string;
  score: number;
}

export function scoreKbTextMatch(
  query: string,
  primaryText: string,
  secondaryParts: string[] = [],
  keywords: string[] = []
): number {
  const normQ = normalizeArabicSearchText(query);
  if (!normQ) return 1;
  const tokens = normQ.split(' ').filter(Boolean);
  const normPrimary = normalizeArabicSearchText(primaryText);
  const normSecondary = normalizeArabicSearchText(secondaryParts.join(' '));
  const normKeywords = normalizeArabicSearchText(keywords.join(' '));
  const combined = `${normPrimary} ${normKeywords} ${normSecondary}`;

  let score = 0;
  if (normPrimary === normQ) score += 120;
  else if (normPrimary.startsWith(normQ)) score += 90;
  else if (normPrimary.includes(normQ)) score += 65;

  if (normKeywords.includes(normQ)) score += 55;
  if (normSecondary.includes(normQ)) score += 30;

  let matchedTokens = 0;
  for (const tok of tokens) {
    if (normPrimary.includes(tok)) {
      score += 20;
      matchedTokens += 1;
    } else if (normKeywords.includes(tok)) {
      score += 15;
      matchedTokens += 1;
    } else if (normSecondary.includes(tok)) {
      score += 10;
      matchedTokens += 1;
    } else if (combined.includes(tok)) {
      score += 5;
      matchedTokens += 1;
    }
  }

  if (matchedTokens === 0) return 0;
  if (tokens.length > 1 && matchedTokens < tokens.length) {
    score = Math.round(score * (matchedTokens / tokens.length));
  }
  return score;
}

export interface KbCompanyCar {
  id: string;
  carName: string;
  carNameEn: string;
  brand: string;
  category: string;
  year: string;
  dailyPrice: number | null;
  transmission: string;
  seats: number | null;
  status: 'active' | 'inactive';
  imageUrl: string;
  branches: string[];
}

export interface NormalizedRgCompany {
  sourceCompanyId: string;
  name: string;
  englishName: string;
  normalizedName: string;
  logoUrl: string;
  shortDescription: string;
  phone: string;
  email: string;
  website: string;
  status: 'active' | 'inactive';
  cities: string[];
  serviceTypes: string[];
  cars: KbCompanyCar[];
  carsCount: number;
  branches: Array<{
    branchName: string;
    city: string;
    district: string;
    fullAddress: string;
    phone: string;
    workingHours: string;
    googleMapsUrl: string;
    status: 'active' | 'inactive';
    services: string[];
  }>;
}

function cleanTxt(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function parseFiniteNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export function normalizeCompanyCarsList(raw: unknown): KbCompanyCar[] {
  let list: any[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const out: KbCompanyCar[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const carObj = item.car && typeof item.car === 'object' ? item.car : item;
    const brandObj = carObj.brand && typeof carObj.brand === 'object' ? carObj.brand : (item.brand && typeof item.brand === 'object' ? item.brand : null);
    const catObj = carObj.category && typeof carObj.category === 'object' ? carObj.category : (item.category && typeof item.category === 'object' ? item.category : null);

    const id = cleanTxt(item.ccId || item.companyCarId || item.company_car_id || item.id || carObj.carId || carObj.id);
    const carName = cleanTxt(
      item.carName || item.carNameAr || item.car_name_ar ||
      carObj.carNameAr || carObj.arabicName || carObj.nameAr || carObj.name ||
      item.arabicName || item.name || carObj.modelName || item.model
    );
    const carNameEn = cleanTxt(
      item.carNameEn || item.car_name_en ||
      carObj.carNameEn || carObj.englishName || carObj.nameEn || item.englishName || ''
    );
    const displayName = carName || carNameEn;
    if (!displayName) continue;

    const brand = cleanTxt(
      item.brandNameAr || item.brandName || (typeof item.brand === 'string' ? item.brand : '') ||
      (brandObj && (brandObj.arabicName || brandObj.nameAr || brandObj.name || brandObj.englishName)) ||
      carObj.brandNameAr || carObj.brandName || carObj.make
    );
    const category = cleanTxt(
      item.categoryNameAr || item.categoryName || (typeof item.category === 'string' ? item.category : '') ||
      (catObj && (catObj.arabicName || catObj.nameAr || catObj.name || catObj.englishName)) ||
      carObj.categoryNameAr || carObj.categoryName || item.carType
    );
    const year = cleanTxt(item.modelYear || item.year || carObj.modelYear || carObj.year || '');
    const dailyPrice = parseFiniteNum(
      item.dailyPrice ?? item.daily_price ?? item.pricePerDay ?? item.price_per_day ?? item.dailyRate ?? item.price ?? carObj.dailyPrice
    );
    const transmission = cleanTxt(item.transmission || item.gearType || carObj.transmission || carObj.gearType || '');
    const rawSeats = parseFiniteNum(item.seats ?? item.seatsCount ?? item.passengerCount ?? carObj.seats ?? carObj.seatsCount);
    const seats = rawSeats !== null && rawSeats > 0 ? Math.round(rawSeats) : null;
    const rawStatus = cleanTxt(item.status || (item.active === false || item.isAvailable === false || item.available === false ? 'inactive' : 'active')).toLowerCase();
    const status: 'active' | 'inactive' = (rawStatus === 'inactive' || rawStatus === 'disabled' || rawStatus === 'suspended' || rawStatus === 'unavailable') ? 'inactive' : 'active';
    const imageUrl = sanitizeUrl(item.imageUrl || item.image || item.photoUrl || carObj.imageUrl || carObj.image || carObj.photo || '', true);

    const branchListRaw = Array.isArray(item.branches)
      ? item.branches
      : (Array.isArray(item.companyCarBranches) ? item.companyCarBranches : []);
    const branches = normalizeStringList(
      branchListRaw.map((b: any) => {
        if (typeof b === 'string') return b;
        if (!b || typeof b !== 'object') return '';
        const inner = b.branch && typeof b.branch === 'object' ? b.branch : b;
        return cleanTxt(inner.arabicName || inner.name || inner.branchName || (inner.city && (inner.city.arabicName || inner.city.name)) || '');
      })
    );

    const dedupKey = id || `${normalizeArabicSearchText(displayName)}|${year}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    out.push({
      id: id || `CAR_${out.length + 1}`,
      carName: displayName,
      carNameEn,
      brand,
      category,
      year,
      dailyPrice,
      transmission,
      seats,
      status,
      imageUrl,
      branches
    });
  }
  return out;
}

function extractEntityId(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
  if (typeof v === 'object') {
    return cleanTxt(v.companyId || v.company_id || v.id);
  }
  return '';
}

function extractCityName(c: any): string {
  if (typeof c === 'string') return c.trim();
  if (c && typeof c === 'object') {
    return cleanTxt(c.arabicName || c.nameAr || c.cityNameAr || c.cityName || c.name || c.englishName);
  }
  return '';
}

export function mergeSyncedCompaniesWithCars(
  rawCompanies: any[] = [],
  rawCompanyCars: any[] = []
): NormalizedRgCompany[] {
  const bySourceId = new Map<string, NormalizedRgCompany>();
  const byNormName = new Map<string, NormalizedRgCompany>();
  const ordered: NormalizedRgCompany[] = [];

  const ensureCompanyEntry = (compObj: any): NormalizedRgCompany | null => {
    if (!compObj || typeof compObj !== 'object') return null;
    const srcId = cleanTxt(compObj.companyId || compObj.company_id || compObj.id);
    const arName = cleanTxt(compObj.arabicName || compObj.nameAr || compObj.companyNameAr || compObj.companyArName || compObj.name || compObj.companyName);
    const enName = cleanTxt(compObj.englishName || compObj.nameEn || compObj.companyNameEn || '');
    const name = arName || enName;
    if (!name) return null;
    const norm = buildCompanyNormalizedName(name);

    let entry = (srcId ? bySourceId.get(srcId) : undefined) || byNormName.get(norm);
    if (!entry) {
      const rawStatus = cleanTxt(compObj.status || (compObj.active === false || compObj.isActive === false ? 'inactive' : 'active')).toLowerCase();
      const status: 'active' | 'inactive' = (rawStatus === 'inactive' || rawStatus === 'disabled' || rawStatus === 'suspended' || rawStatus === 'blocked') ? 'inactive' : 'active';

      const citiesRaw: string[] = [];
      if (Array.isArray(compObj.cities)) {
        compObj.cities.forEach((ct: any) => { const s = extractCityName(ct); if (s) citiesRaw.push(s); });
      }
      if (compObj.city) {
        const s = extractCityName(compObj.city);
        if (s) citiesRaw.push(s);
      }

      const rawBranches = Array.isArray(compObj.branches) ? compObj.branches : [];
      const branches = rawBranches
        .map((br: any) => {
          if (!br || typeof br !== 'object') return null;
          const bName = cleanTxt(br.arabicName || br.branchName || br.name || br.englishName);
          const bCity = extractCityName(br.city || br.cityNameAr || br.cityName || '');
          if (bCity) citiesRaw.push(bCity);
          if (!bName && !bCity) return null;
          const bRawSt = cleanTxt(br.status || (br.active === false ? 'inactive' : 'active')).toLowerCase();
          return {
            branchName: bName || bCity,
            city: bCity,
            district: cleanTxt(br.district || br.neighborhood || ''),
            fullAddress: cleanTxt(br.fullAddress || br.address || br.street || ''),
            phone: cleanTxt(br.phone || br.mobile || br.contactPhone || ''),
            workingHours: cleanTxt(br.workingHours || br.working_hours || ''),
            googleMapsUrl: sanitizeUrl(br.googleMapsUrl || br.mapsUrl || br.locationUrl || '', false),
            status: (bRawSt === 'inactive' || bRawSt === 'disabled') ? 'inactive' as const : 'active' as const,
            services: normalizeStringList(br.services || br.serviceTypes || [])
          };
        })
        .filter((x: NormalizedRgCompany['branches'][number] | null): x is NormalizedRgCompany['branches'][number] => Boolean(x));

      const serviceTypesRaw: string[] = [];
      if (Array.isArray(compObj.serviceTypes)) serviceTypesRaw.push(...compObj.serviceTypes.map(cleanTxt));
      if (Array.isArray(compObj.services)) {
        compObj.services.forEach((sv: any) => {
          if (typeof sv === 'string') serviceTypesRaw.push(sv);
          else if (sv && typeof sv === 'object') serviceTypesRaw.push(cleanTxt(sv.arabicName || sv.name || sv.serviceName));
        });
      }
      if (compObj.companyType) serviceTypesRaw.push(cleanTxt(compObj.companyType));

      entry = {
        sourceCompanyId: srcId,
        name,
        englishName: enName,
        normalizedName: norm,
        logoUrl: sanitizeUrl(compObj.logoUrl || compObj.logo || compObj.image || compObj.avatar || '', true),
        shortDescription: cleanTxt(compObj.description || compObj.shortDescription || compObj.bio || (enName && enName !== name ? enName : '')),
        phone: cleanTxt(compObj.phone || compObj.mobile || compObj.contactPhone || compObj.hotline || ''),
        email: cleanTxt(compObj.email || compObj.contactEmail || ''),
        website: sanitizeUrl(compObj.website || compObj.websiteUrl || '', false),
        status,
        cities: normalizeStringList(citiesRaw),
        serviceTypes: normalizeStringList(serviceTypesRaw),
        cars: normalizeCompanyCarsList(compObj.cars || compObj.companyCars || []),
        carsCount: 0,
        branches
      };
      entry.carsCount = entry.cars.length;
      if (srcId) bySourceId.set(srcId, entry);
      if (norm) byNormName.set(norm, entry);
      ordered.push(entry);
    }
    return entry;
  };

  for (const c of rawCompanies || []) {
    ensureCompanyEntry(c);
  }

  for (const row of rawCompanyCars || []) {
    if (!row || typeof row !== 'object') continue;
    const nestedComp = row.company && typeof row.company === 'object' ? row.company : null;
    const cid = extractEntityId(nestedComp || row.companyId || row.company_id);
    const cName = cleanTxt(
      (nestedComp && (nestedComp.arabicName || nestedComp.nameAr || nestedComp.name || nestedComp.englishName)) ||
      row.companyArName || row.companyName || row.company_name
    );
    let target = cid ? bySourceId.get(cid) : undefined;
    if (!target && cName) {
      target = byNormName.get(buildCompanyNormalizedName(cName));
    }
    if (!target && (nestedComp || cName)) {
      target = ensureCompanyEntry(nestedComp || { id: cid, name: cName, arabicName: cName }) || undefined;
    }
    if (!target) continue;

    const parsedCars = normalizeCompanyCarsList([row]);
    if (parsedCars.length) {
      const mergedCars = normalizeCompanyCarsList([...target.cars, ...parsedCars]);
      target.cars = mergedCars;
      target.carsCount = mergedCars.length;
      // Extract cities from car branches if present
      const extraCities: string[] = [];
      for (const pc of parsedCars) {
        if (pc.category) target.serviceTypes = normalizeStringList([...target.serviceTypes, pc.category]);
        for (const b of pc.branches) {
          if (b && b.length < 40) extraCities.push(b);
        }
      }
      if (row.city) {
        const ct = extractCityName(row.city);
        if (ct) extraCities.push(ct);
      }
      if (extraCities.length && target.cities.length === 0) {
        target.cities = normalizeStringList(extraCities);
      }
    }
  }

  for (const entry of ordered) {
    entry.carsCount = entry.cars.length;
  }
  return ordered;
}
