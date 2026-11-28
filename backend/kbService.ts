import { crmCore, generateId, type AuthSession } from './auth.js';
import type { DbClient, DbExecutor } from './db.js';
import {
  KB_DYNAMIC_VARIABLES,
  KB_FAQ_CATEGORIES,
  KB_POLICY_CATEGORIES,
  KB_QUICK_REPLY_CATEGORIES,
  KB_SECTIONS,
  buildBranchNormalizedKey,
  buildCompanyNormalizedName,
  buildFaqNormalizedKey,
  buildPolicyNormalizedKey,
  buildQuickReplyNormalizedKey,
  extractPlainTextFromHtml,
  getSectionForPolicyCategory,
  mergeCompanyAndBranchCities,
  normalizeArabicSearchText,
  normalizeAttachments,
  normalizeStringList,
  sanitizeKbRichHtml,
  sanitizeUrl,
  scoreKbTextMatch,
  type KbUnifiedSearchResultItem
} from './kbLogic.js';

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v).trim();
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonVal<T = any>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return fallback;
    try {
      return JSON.parse(t) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function toIso(val: unknown): string {
  if (!val) return '';
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? '' : val.toISOString();
  const s = String(val).trim();
  return s;
}

function canPerm(session: AuthSession, permKey: string): boolean {
  const role = str(session?.user?.role).toLowerCase();
  if (role === 'developer') return true;
  if (crmCore && typeof crmCore.canUserPerform === 'function') {
    return Boolean(crmCore.canUserPerform(session.user, permKey));
  }
  return role === 'general_manager';
}

function assertKbView(session: AuthSession): void {
  if (!session?.user) throw new Error('UNAUTHORIZED: يلزم تسجيل الدخول أولاً.');
  if (
    !canPerm(session, 'view_knowledge_base') &&
    !canPerm(session, 'kb_manage_companies') &&
    !canPerm(session, 'kb_manage_policies') &&
    !canPerm(session, 'kb_manage_faqs') &&
    !canPerm(session, 'kb_manage_quick_replies')
  ) {
    throw new Error('FORBIDDEN: لا تملك صلاحية عرض مركز المعرفة.');
  }
}

function assertKbPerm(session: AuthSession, permKey: string, errorMsg: string): void {
  if (!session?.user) throw new Error('UNAUTHORIZED: يلزم تسجيل الدخول أولاً.');
  if (!canPerm(session, permKey)) {
    throw new Error(`FORBIDDEN: ${errorMsg}`);
  }
}

function normalizePagination(payload: Record<string, any>, defaultPageSize = 24, maxPageSize = 100) {
  const page = Math.max(1, Math.round(num(payload.page, 1)));
  const pageSize = Math.min(maxPageSize, Math.max(6, Math.round(num(payload.pageSize, defaultPageSize))));
  const offset = (page - 1) * pageSize;
  return { page, pageSize, offset };
}

async function logKbAudit(
  db: DbClient | DbExecutor,
  session: AuthSession,
  opts: {
    entityType: 'KbCompany' | 'KbBranch' | 'KbPolicy' | 'KbFaq' | 'KbQuickReply';
    entityId: string;
    actionType: string;
    titleSnapshot: string;
    details: string;
    beforeJson?: Record<string, any> | null;
    afterJson?: Record<string, any> | null;
  }
): Promise<void> {
  const actorId = str(session?.user?.id);
  const actorName = str(session?.user?.name || session?.user?.username || 'System');
  const revId = generateId('KBREV');
  const actId = generateId('ACT');

  await db.query(
    `INSERT INTO kb_revisions (id, entity_type, entity_id, action_type, title_snapshot, before_json, after_json, actor_id, actor_name, created_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, NOW())`,
    [
      revId,
      opts.entityType,
      opts.entityId,
      opts.actionType,
      opts.titleSnapshot.slice(0, 220),
      JSON.stringify(opts.beforeJson || {}),
      JSON.stringify(opts.afterJson || {}),
      actorId,
      actorName
    ]
  );

  await db.query(
    `INSERT INTO activity_log (id, employee_id, employee_name, action_type, entity_type, entity_id, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [
      actId,
      actorId,
      actorName,
      opts.actionType,
      opts.entityType,
      opts.entityId,
      opts.details.slice(0, 500)
    ]
  );
}

function mapCompanyRow(row: any, branchCities: string[] = [], branchesCount = 0, activeBranchesCount = 0) {
  const explicitCities = normalizeStringList(parseJsonVal(row.cities_json, []));
  const cities = mergeCompanyAndBranchCities(explicitCities, branchCities);
  return {
    id: str(row.id),
    name: str(row.name),
    logoUrl: sanitizeUrl(row.logo_url, true),
    shortDescription: str(row.short_description),
    images: normalizeStringList(parseJsonVal(row.images_json, []))
      .map((u) => sanitizeUrl(u, true))
      .filter(Boolean),
    phone: str(row.phone),
    email: str(row.email),
    website: sanitizeUrl(row.website, false),
    status: str(row.status) === 'inactive' ? 'inactive' : 'active',
    cities,
    citiesCount: cities.length,
    branchesCount: Number(branchesCount || 0),
    activeBranchesCount: Number(activeBranchesCount || 0),
    serviceTypes: normalizeStringList(parseJsonVal(row.service_types_json, [])),
    internalNotes: str(row.internal_notes),
    createdById: str(row.created_by_id),
    createdByName: str(row.created_by_name),
    updatedById: str(row.updated_by_id),
    updatedByName: str(row.updated_by_name),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapBranchRow(row: any) {
  return {
    id: str(row.id),
    companyId: str(row.company_id),
    companyName: str(row.company_name),
    branchName: str(row.branch_name),
    city: str(row.city),
    district: str(row.district),
    fullAddress: str(row.full_address),
    googleMapsUrl: sanitizeUrl(row.google_maps_url, false),
    phone: str(row.phone),
    workingHours: str(row.working_hours),
    status: str(row.status) === 'inactive' ? 'inactive' : 'active',
    services: normalizeStringList(parseJsonVal(row.services_json, [])),
    notes: str(row.notes),
    createdById: str(row.created_by_id),
    createdByName: str(row.created_by_name),
    updatedById: str(row.updated_by_id),
    updatedByName: str(row.updated_by_name),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapPolicyRow(row: any) {
  const html = sanitizeKbRichHtml(row.description_html || '');
  return {
    id: str(row.id),
    title: str(row.title),
    descriptionHtml: html,
    descriptionText: str(row.description_text) || extractPlainTextFromHtml(html),
    sectionKey: str(row.section_key || 'rental_gate_policies'),
    category: str(row.category || 'rental_gate'),
    companyId: str(row.company_id),
    companyName: str(row.company_name),
    city: str(row.city),
    keywords: normalizeStringList(parseJsonVal(row.keywords_json, [])),
    attachments: normalizeAttachments(parseJsonVal(row.attachments_json, [])),
    publishStatus: str(row.publish_status || 'published'),
    usageCount: num(row.usage_count, 0),
    searchHitCount: num(row.search_hit_count, 0),
    createdById: str(row.created_by_id),
    createdByName: str(row.created_by_name),
    updatedById: str(row.updated_by_id),
    updatedByName: str(row.updated_by_name),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapFaqRow(row: any) {
  const html = sanitizeKbRichHtml(row.answer_html || '');
  return {
    id: str(row.id),
    question: str(row.question),
    answerHtml: html,
    answerText: str(row.answer_text) || extractPlainTextFromHtml(html),
    category: str(row.category || 'general'),
    companyId: str(row.company_id),
    companyName: str(row.company_name),
    keywords: normalizeStringList(parseJsonVal(row.keywords_json, [])),
    publishStatus: str(row.publish_status || 'published'),
    usageCount: num(row.usage_count, 0),
    searchHitCount: num(row.search_hit_count, 0),
    createdById: str(row.created_by_id),
    createdByName: str(row.created_by_name),
    updatedById: str(row.updated_by_id),
    updatedByName: str(row.updated_by_name),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapQuickReplyRow(row: any) {
  return {
    id: str(row.id),
    title: str(row.title),
    messageText: str(row.message_text),
    category: str(row.category || 'greeting'),
    keywords: normalizeStringList(parseJsonVal(row.keywords_json, [])),
    language: str(row.language) === 'en' ? 'en' : 'ar',
    companyId: str(row.company_id),
    companyName: str(row.company_name),
    status: str(row.status || 'active'),
    usageCount: num(row.usage_count, 0),
    createdById: str(row.created_by_id),
    createdByName: str(row.created_by_name),
    updatedById: str(row.updated_by_id),
    updatedByName: str(row.updated_by_name),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

async function syncCompanyCitiesFromBranches(db: DbClient | DbExecutor, companyId: string): Promise<void> {
  const cid = str(companyId);
  if (!cid) return;
  const compRes = await db.query<{ cities_json: any }>(`SELECT cities_json FROM kb_companies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [cid]);
  if (!compRes.rows.length) return;
  const brRes = await db.query<{ city: string }>(`SELECT DISTINCT city FROM kb_branches WHERE company_id = $1 AND deleted_at IS NULL AND COALESCE(TRIM(city), '') <> ''`, [cid]);
  const merged = mergeCompanyAndBranchCities(
    parseJsonVal(compRes.rows[0].cities_json, []),
    brRes.rows.map((r) => str(r.city))
  );
  await db.query(
    `UPDATE kb_companies SET cities_json = $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [cid, JSON.stringify(merged)]
  );
}

export async function getKnowledgeBaseDashboard(executor: DbExecutor, session: AuthSession) {
  assertKbView(session);

  const [companiesRes, branchesRes, policiesCountRes, faqsCountRes, repliesCountRes, latestAddedRes, latestUpdatedRes, mostUsedRes, mostSearchedRes] = await Promise.all([
    executor.query(
      `SELECT id, name, logo_url, status, cities_json, updated_at
       FROM kb_companies
       WHERE deleted_at IS NULL
       ORDER BY name ASC`
    ),
    executor.query(
      `SELECT id, company_id, city, status
       FROM kb_branches
       WHERE deleted_at IS NULL`
    ),
    executor.query<{ total: number; published: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE publish_status = 'published')::int AS published
       FROM kb_policies
       WHERE deleted_at IS NULL`
    ),
    executor.query<{ total: number; published: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE publish_status = 'published')::int AS published
       FROM kb_faqs
       WHERE deleted_at IS NULL`
    ),
    executor.query<{ total: number; active: number }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'active')::int AS active
       FROM kb_quick_replies
       WHERE deleted_at IS NULL`
    ),
    executor.query(
      `(SELECT id, 'company' AS entity_type, name AS title, 'companies' AS section_key, updated_by_name AS actor_name, created_at AS event_at, usage_count_zero AS usage_count
        FROM (SELECT id, name, updated_by_name, created_at, 0::int AS usage_count_zero FROM kb_companies WHERE deleted_at IS NULL) c)
       UNION ALL
       (SELECT id, 'branch' AS entity_type, branch_name || ' (' || city || ')' AS title, 'branches' AS section_key, updated_by_name AS actor_name, created_at AS event_at, 0::int AS usage_count
        FROM kb_branches WHERE deleted_at IS NULL)
       UNION ALL
       (SELECT id, 'policy' AS entity_type, title, section_key, updated_by_name AS actor_name, created_at AS event_at, usage_count
        FROM kb_policies WHERE deleted_at IS NULL)
       UNION ALL
       (SELECT id, 'faq' AS entity_type, question AS title, 'faq' AS section_key, updated_by_name AS actor_name, created_at AS event_at, usage_count
        FROM kb_faqs WHERE deleted_at IS NULL)
       UNION ALL
       (SELECT id, 'quick_reply' AS entity_type, title, 'quick_replies' AS section_key, updated_by_name AS actor_name, created_at AS event_at, usage_count
        FROM kb_quick_replies WHERE deleted_at IS NULL)
       ORDER BY event_at DESC
       LIMIT 8`
    ),
    executor.query(
      `(SELECT id, 'company' AS entity_type, name AS title, 'companies' AS section_key, updated_by_name AS actor_name, updated_at AS event_at, 0::int AS usage_count
        FROM kb_companies WHERE deleted_at IS NULL)
       UNION ALL
       (SELECT id, 'branch' AS entity_type, branch_name || ' (' || city || ')' AS title, 'branches' AS section_key, updated_by_name AS actor_name, updated_at AS event_at, 0::int AS usage_count
        FROM kb_branches WHERE deleted_at IS NULL)
       UNION ALL
       (SELECT id, 'policy' AS entity_type, title, section_key, updated_by_name AS actor_name, updated_at AS event_at, usage_count
        FROM kb_policies WHERE deleted_at IS NULL)
       UNION ALL
       (SELECT id, 'faq' AS entity_type, question AS title, 'faq' AS section_key, updated_by_name AS actor_name, updated_at AS event_at, usage_count
        FROM kb_faqs WHERE deleted_at IS NULL)
       UNION ALL
       (SELECT id, 'quick_reply' AS entity_type, title, 'quick_replies' AS section_key, updated_by_name AS actor_name, updated_at AS event_at, usage_count
        FROM kb_quick_replies WHERE deleted_at IS NULL)
       ORDER BY event_at DESC
       LIMIT 8`
    ),
    executor.query(
      `(SELECT id, 'quick_reply' AS entity_type, title, 'quick_replies' AS section_key, category, usage_count, 0::int AS search_hit_count
        FROM kb_quick_replies WHERE deleted_at IS NULL AND status = 'active' AND usage_count > 0)
       UNION ALL
       (SELECT id, 'faq' AS entity_type, question AS title, 'faq' AS section_key, category, usage_count, search_hit_count
        FROM kb_faqs WHERE deleted_at IS NULL AND publish_status = 'published' AND usage_count > 0)
       UNION ALL
       (SELECT id, 'policy' AS entity_type, title, section_key, category, usage_count, search_hit_count
        FROM kb_policies WHERE deleted_at IS NULL AND publish_status = 'published' AND usage_count > 0)
       ORDER BY usage_count DESC
       LIMIT 8`
    ),
    executor.query(
      `(SELECT id, 'faq' AS entity_type, question AS title, 'faq' AS section_key, category, usage_count, search_hit_count
        FROM kb_faqs WHERE deleted_at IS NULL AND publish_status = 'published' AND (search_hit_count > 0 OR usage_count > 0))
       UNION ALL
       (SELECT id, 'policy' AS entity_type, title, section_key, category, usage_count, search_hit_count
        FROM kb_policies WHERE deleted_at IS NULL AND publish_status = 'published' AND (search_hit_count > 0 OR usage_count > 0))
       ORDER BY search_hit_count DESC, usage_count DESC
       LIMIT 8`
    )
  ]);

  const branchCityMap = new Map<string, string[]>();
  const branchCountMap = new Map<string, number>();
  const allCitiesRaw: string[] = [];

  for (const b of branchesRes.rows || []) {
    const cid = str(b.company_id);
    const city = str(b.city);
    branchCountMap.set(cid, (branchCountMap.get(cid) || 0) + 1);
    if (city) {
      allCitiesRaw.push(city);
      const arr = branchCityMap.get(cid) || [];
      arr.push(city);
      branchCityMap.set(cid, arr);
    }
  }

  let activeCompanies = 0;
  const companiesSummary = (companiesRes.rows || []).map((c: any) => {
    const cid = str(c.id);
    const st = str(c.status) === 'inactive' ? 'inactive' : 'active';
    if (st === 'active') activeCompanies += 1;
    const cities = mergeCompanyAndBranchCities(parseJsonVal(c.cities_json, []), branchCityMap.get(cid) || []);
    for (const ct of cities) allCitiesRaw.push(ct);
    return {
      id: cid,
      name: str(c.name),
      logoUrl: sanitizeUrl(c.logo_url, true),
      status: st,
      cities,
      branchesCount: branchCountMap.get(cid) || 0
    };
  });

  const coveredCities = normalizeStringList(allCitiesRaw).sort((a, b) => a.localeCompare(b, 'ar'));
  const polRow = policiesCountRes.rows?.[0] || { total: 0, published: 0 };
  const faqRow = faqsCountRes.rows?.[0] || { total: 0, published: 0 };
  const repRow = repliesCountRes.rows?.[0] || { total: 0, active: 0 };

  return {
    kpis: {
      totalCompanies: companiesSummary.length,
      activeCompanies,
      totalBranches: (branchesRes.rows || []).length,
      coveredCitiesCount: coveredCities.length,
      totalPolicies: Number(polRow.total || 0),
      publishedPolicies: Number(polRow.published || 0),
      totalFaqs: Number(faqRow.total || 0),
      publishedFaqs: Number(faqRow.published || 0),
      totalQuickReplies: Number(repRow.total || 0),
      activeQuickReplies: Number(repRow.active || 0)
    },
    coveredCities,
    companiesSummary,
    latestAdded: (latestAddedRes.rows || []).map((r: any) => ({
      id: str(r.id),
      entityType: str(r.entity_type),
      title: str(r.title),
      sectionKey: str(r.section_key),
      actorName: str(r.actor_name),
      at: toIso(r.event_at),
      usageCount: num(r.usage_count, 0)
    })),
    latestUpdated: (latestUpdatedRes.rows || []).map((r: any) => ({
      id: str(r.id),
      entityType: str(r.entity_type),
      title: str(r.title),
      sectionKey: str(r.section_key),
      actorName: str(r.actor_name),
      at: toIso(r.event_at),
      usageCount: num(r.usage_count, 0)
    })),
    mostUsed: (mostUsedRes.rows || []).map((r: any) => ({
      id: str(r.id),
      entityType: str(r.entity_type),
      title: str(r.title),
      sectionKey: str(r.section_key),
      category: str(r.category),
      usageCount: num(r.usage_count, 0),
      searchHitCount: num(r.search_hit_count, 0)
    })),
    mostSearched: (mostSearchedRes.rows || []).map((r: any) => ({
      id: str(r.id),
      entityType: str(r.entity_type),
      title: str(r.title),
      sectionKey: str(r.section_key),
      category: str(r.category),
      usageCount: num(r.usage_count, 0),
      searchHitCount: num(r.search_hit_count, 0)
    })),
    meta: {
      sections: KB_SECTIONS,
      policyCategories: KB_POLICY_CATEGORIES,
      faqCategories: KB_FAQ_CATEGORIES,
      quickReplyCategories: KB_QUICK_REPLY_CATEGORIES,
      dynamicVariables: KB_DYNAMIC_VARIABLES
    }
  };
}

export async function getKbCompanies(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbView(session);
  const { page, pageSize, offset } = normalizePagination(payload, 24, 100);
  const search = str(payload.search);
  const city = str(payload.city);
  const status = str(payload.status);
  const companyId = str(payload.companyId);

  const [companiesRes, branchesRes] = await Promise.all([
    executor.query(
      `SELECT *
       FROM kb_companies
       WHERE deleted_at IS NULL
       ORDER BY updated_at DESC, name ASC`
    ),
    executor.query(
      `SELECT id, company_id, branch_name, city, district, full_address, google_maps_url, phone, working_hours, status, services_json, notes, updated_at
       FROM kb_branches
       WHERE deleted_at IS NULL
       ORDER BY city ASC, branch_name ASC`
    )
  ]);

  const branchesByCompany = new Map<string, any[]>();
  const allCitiesRaw: string[] = [];
  for (const br of branchesRes.rows || []) {
    const cid = str(br.company_id);
    if (br.city) allCitiesRaw.push(str(br.city));
    const list = branchesByCompany.get(cid) || [];
    list.push(mapBranchRow({ ...br, company_name: '' }));
    branchesByCompany.set(cid, list);
  }

  let mapped = (companiesRes.rows || []).map((row: any) => {
    const cid = str(row.id);
    const brs = branchesByCompany.get(cid) || [];
    const branchCities = brs.map((b) => b.city).filter(Boolean);
    const activeBrs = brs.filter((b) => b.status === 'active').length;
    const item = mapCompanyRow(row, branchCities, brs.length, activeBrs);
    for (const ct of item.cities) allCitiesRaw.push(ct);
    return {
      ...item,
      branches: companyId && companyId === cid ? brs.map((b) => ({ ...b, companyName: item.name })) : undefined
    };
  });

  if (companyId) {
    const single = mapped.find((c) => c.id === companyId) || null;
    return {
      company: single,
      items: single ? [single] : [],
      branches: single ? (branchesByCompany.get(companyId) || []) : [],
      cities: normalizeStringList(allCitiesRaw),
      pagination: { page: 1, pageSize: 1, total: single ? 1 : 0, totalPages: 1 }
    };
  }

  if (status === 'active' || status === 'inactive') {
    mapped = mapped.filter((c) => c.status === status);
  }

  if (city) {
    const normCity = normalizeArabicSearchText(city);
    mapped = mapped.filter((c) => c.cities.some((ct) => normalizeArabicSearchText(ct) === normCity));
  }

  if (search) {
    const normQ = normalizeArabicSearchText(search);
    mapped = mapped.filter((c) => {
      const hay = normalizeArabicSearchText([
        c.name,
        c.shortDescription,
        c.phone,
        c.email,
        c.cities.join(' '),
        c.serviceTypes.join(' ')
      ].join(' '));
      return hay.includes(normQ);
    });
  }

  const total = mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const paged = mapped.slice(offset, offset + pageSize);

  return {
    items: paged,
    cities: normalizeStringList(allCitiesRaw).sort((a, b) => a.localeCompare(b, 'ar')),
    pagination: { page, pageSize, total, totalPages }
  };
}

export async function saveKbCompany(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbPerm(session, 'kb_manage_companies', 'لا تملك صلاحية إضافة أو تعديل شركات التأجير.');
  const id = str(payload.id);
  const name = str(payload.name);
  if (!name) throw new Error('VALIDATION_ERROR: اسم شركة التأجير مطلوب.');

  const normalizedName = buildCompanyNormalizedName(name);
  const logoUrl = sanitizeUrl(payload.logoUrl, true);
  const shortDescription = str(payload.shortDescription);
  const images = normalizeStringList(payload.images).map((u) => sanitizeUrl(u, true)).filter(Boolean);
  const phone = str(payload.phone);
  const email = str(payload.email);
  const website = sanitizeUrl(payload.website, false);
  const status = str(payload.status) === 'inactive' ? 'inactive' : 'active';
  const cities = normalizeStringList(payload.cities);
  const serviceTypes = normalizeStringList(payload.serviceTypes);
  const internalNotes = str(payload.internalNotes);
  const actorId = str(session.user.id);
  const actorName = str(session.user.name || session.user.username);

  return executor.withTransaction(async (tx) => {
    const dupCheck = await tx.query<{ id: string }>(
      `SELECT id FROM kb_companies WHERE normalized_name = $1 AND deleted_at IS NULL AND ($2 = '' OR id <> $2) LIMIT 1`,
      [normalizedName, id]
    );
    if (dupCheck.rows.length) {
      throw new Error('DUPLICATE_ENTRY: توجد شركة تأجير مسجلة مسبقاً بنفس الاسم.');
    }

    let before: Record<string, any> | null = null;
    let savedRow: any = null;
    let actionType = 'kb_company_created';

    if (id) {
      const existingRes = await tx.query(`SELECT * FROM kb_companies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
      if (!existingRes.rows.length) {
        throw new Error('NOT_FOUND: شركة التأجير المطلوبة غير موجودة.');
      }
      before = mapCompanyRow(existingRes.rows[0]);
      actionType = 'kb_company_updated';

      const updRes = await tx.query(
        `UPDATE kb_companies
         SET name = $2,
             normalized_name = $3,
             logo_url = $4,
             short_description = $5,
             images_json = $6::jsonb,
             phone = $7,
             email = $8,
             website = $9,
             status = $10,
             cities_json = $11::jsonb,
             service_types_json = $12::jsonb,
             internal_notes = $13,
             updated_by_id = $14,
             updated_by_name = $15,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          name,
          normalizedName,
          logoUrl,
          shortDescription,
          JSON.stringify(images),
          phone,
          email,
          website,
          status,
          JSON.stringify(cities),
          JSON.stringify(serviceTypes),
          internalNotes,
          actorId,
          actorName
        ]
      );
      savedRow = updRes.rows[0];
      await syncCompanyCitiesFromBranches(tx, id);
      const refreshed = await tx.query(`SELECT * FROM kb_companies WHERE id = $1 LIMIT 1`, [id]);
      if (refreshed.rows.length) savedRow = refreshed.rows[0];
    } else {
      const newId = generateId('KBCMP');
      const insRes = await tx.query(
        `INSERT INTO kb_companies (
          id, name, normalized_name, logo_url, short_description, images_json,
          phone, email, website, status, cities_json, service_types_json, internal_notes,
          created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb,
          $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13,
          $14, $15, $14, $15, NOW(), NOW()
        ) RETURNING *`,
        [
          newId,
          name,
          normalizedName,
          logoUrl,
          shortDescription,
          JSON.stringify(images),
          phone,
          email,
          website,
          status,
          JSON.stringify(cities),
          JSON.stringify(serviceTypes),
          internalNotes,
          actorId,
          actorName
        ]
      );
      savedRow = insRes.rows[0];
    }

    const mapped = mapCompanyRow(savedRow);
    await logKbAudit(tx, session, {
      entityType: 'KbCompany',
      entityId: mapped.id,
      actionType,
      titleSnapshot: mapped.name,
      details: `${actionType === 'kb_company_created' ? 'إضافة شركة تأجير' : 'تحديث شركة تأجير'}: ${mapped.name}`,
      beforeJson: before,
      afterJson: mapped
    });
    return { company: mapped };
  });
}

export async function deleteKbCompany(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbPerm(session, 'kb_delete_content', 'لا تملك صلاحية حذف شركات التأجير.');
  const id = str(payload.id);
  if (!id) throw new Error('VALIDATION_ERROR: معرف الشركة مطلوب.');

  return executor.withTransaction(async (tx) => {
    const existingRes = await tx.query(`SELECT * FROM kb_companies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
    if (!existingRes.rows.length) {
      throw new Error('NOT_FOUND: شركة التأجير غير موجودة.');
    }
    const before = mapCompanyRow(existingRes.rows[0]);
    const actorId = str(session.user.id);
    const actorName = str(session.user.name || session.user.username);

    await tx.query(
      `UPDATE kb_companies SET deleted_at = NOW(), updated_by_id = $2, updated_by_name = $3, updated_at = NOW() WHERE id = $1`,
      [id, actorId, actorName]
    );
    await tx.query(
      `UPDATE kb_branches SET deleted_at = NOW(), updated_by_id = $2, updated_by_name = $3, updated_at = NOW() WHERE company_id = $1 AND deleted_at IS NULL`,
      [id, actorId, actorName]
    );

    await logKbAudit(tx, session, {
      entityType: 'KbCompany',
      entityId: id,
      actionType: 'kb_company_deleted',
      titleSnapshot: before.name,
      details: `حذف شركة تأجير من مركز المعرفة: ${before.name}`,
      beforeJson: before,
      afterJson: { deleted: true }
    });
    return { deletedId: id };
  });
}

export async function getKbBranches(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbView(session);
  const { page, pageSize, offset } = normalizePagination(payload, 30, 150);
  const companyId = str(payload.companyId);
  const city = str(payload.city);
  const status = str(payload.status);
  const search = str(payload.search);

  const res = await executor.query(
    `SELECT b.*, COALESCE(c.name, '') AS company_name
     FROM kb_branches b
     LEFT JOIN kb_companies c ON c.id = b.company_id
     WHERE b.deleted_at IS NULL AND (c.id IS NULL OR c.deleted_at IS NULL)
     ORDER BY c.name ASC, b.city ASC, b.branch_name ASC`
  );

  let mapped = (res.rows || []).map(mapBranchRow);
  const citiesSet = normalizeStringList(mapped.map((b) => b.city).filter(Boolean)).sort((a, b) => a.localeCompare(b, 'ar'));

  if (companyId) mapped = mapped.filter((b) => b.companyId === companyId);
  if (city) {
    const normCity = normalizeArabicSearchText(city);
    mapped = mapped.filter((b) => normalizeArabicSearchText(b.city) === normCity);
  }
  if (status === 'active' || status === 'inactive') mapped = mapped.filter((b) => b.status === status);
  if (search) {
    const normQ = normalizeArabicSearchText(search);
    mapped = mapped.filter((b) => {
      const hay = normalizeArabicSearchText([
        b.branchName,
        b.companyName,
        b.city,
        b.district,
        b.fullAddress,
        b.phone,
        b.services.join(' ')
      ].join(' '));
      return hay.includes(normQ);
    });
  }

  const total = mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const items = mapped.slice(offset, offset + pageSize);

  return {
    items,
    cities: citiesSet,
    pagination: { page, pageSize, total, totalPages }
  };
}

export async function saveKbBranch(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbPerm(session, 'kb_manage_companies', 'لا تملك صلاحية إضافة أو تعديل الفروع.');
  const id = str(payload.id);
  const companyId = str(payload.companyId);
  const branchName = str(payload.branchName);
  const city = str(payload.city);
  if (!companyId) throw new Error('VALIDATION_ERROR: يجب اختيار شركة التأجير التابع لها الفرع.');
  if (!branchName) throw new Error('VALIDATION_ERROR: اسم الفرع مطلوب.');
  if (!city) throw new Error('VALIDATION_ERROR: المدينة مطلوبة.');

  const district = str(payload.district);
  const fullAddress = str(payload.fullAddress);
  const googleMapsUrl = sanitizeUrl(payload.googleMapsUrl, false);
  const phone = str(payload.phone);
  const workingHours = str(payload.workingHours);
  const status = str(payload.status) === 'inactive' ? 'inactive' : 'active';
  const services = normalizeStringList(payload.services);
  const notes = str(payload.notes);
  const normalizedKey = buildBranchNormalizedKey(companyId, city, branchName);
  const actorId = str(session.user.id);
  const actorName = str(session.user.name || session.user.username);

  return executor.withTransaction(async (tx) => {
    const compRes = await tx.query<{ id: string; name: string }>(
      `SELECT id, name FROM kb_companies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
      [companyId]
    );
    if (!compRes.rows.length) {
      throw new Error('NOT_FOUND: شركة التأجير المحددة غير موجودة.');
    }
    const companyName = str(compRes.rows[0].name);

    const dupRes = await tx.query<{ id: string }>(
      `SELECT id FROM kb_branches WHERE normalized_key = $1 AND deleted_at IS NULL AND ($2 = '' OR id <> $2) LIMIT 1`,
      [normalizedKey, id]
    );
    if (dupRes.rows.length) {
      throw new Error('DUPLICATE_ENTRY: يوجد فرع بنفس الاسم في نفس المدينة لهذه الشركة.');
    }

    let before: Record<string, any> | null = null;
    let savedRow: any = null;
    let actionType = 'kb_branch_created';

    if (id) {
      const existingRes = await tx.query(`SELECT * FROM kb_branches WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
      if (!existingRes.rows.length) {
        throw new Error('NOT_FOUND: الفرع المطلوب غير موجود.');
      }
      before = mapBranchRow({ ...existingRes.rows[0], company_name: companyName });
      actionType = 'kb_branch_updated';

      const updRes = await tx.query(
        `UPDATE kb_branches
         SET company_id = $2,
             branch_name = $3,
             normalized_key = $4,
             city = $5,
             district = $6,
             full_address = $7,
             google_maps_url = $8,
             phone = $9,
             working_hours = $10,
             status = $11,
             services_json = $12::jsonb,
             notes = $13,
             updated_by_id = $14,
             updated_by_name = $15,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id, companyId, branchName, normalizedKey, city, district, fullAddress,
          googleMapsUrl, phone, workingHours, status, JSON.stringify(services), notes,
          actorId, actorName
        ]
      );
      savedRow = updRes.rows[0];
    } else {
      const newId = generateId('KBBR');
      const insRes = await tx.query(
        `INSERT INTO kb_branches (
          id, company_id, branch_name, normalized_key, city, district, full_address,
          google_maps_url, phone, working_hours, status, services_json, notes,
          created_by_id, created_by_name, updated_by_id, updated_by_name, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12::jsonb, $13,
          $14, $15, $14, $15, NOW(), NOW()
        ) RETURNING *`,
        [
          newId, companyId, branchName, normalizedKey, city, district, fullAddress,
          googleMapsUrl, phone, workingHours, status, JSON.stringify(services), notes,
          actorId, actorName
        ]
      );
      savedRow = insRes.rows[0];
    }

    await syncCompanyCitiesFromBranches(tx, companyId);
    const mapped = mapBranchRow({ ...savedRow, company_name: companyName });
    await logKbAudit(tx, session, {
      entityType: 'KbBranch',
      entityId: mapped.id,
      actionType,
      titleSnapshot: `${companyName} — ${mapped.branchName}`,
      details: `${actionType === 'kb_branch_created' ? 'إضافة فرع' : 'تحديث فرع'}: ${mapped.branchName} (${mapped.city}) - ${companyName}`,
      beforeJson: before,
      afterJson: mapped
    });
    return { branch: mapped };
  });
}

export async function deleteKbBranch(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbPerm(session, 'kb_delete_content', 'لا تملك صلاحية حذف الفروع.');
  const id = str(payload.id);
  if (!id) throw new Error('VALIDATION_ERROR: معرف الفرع مطلوب.');

  return executor.withTransaction(async (tx) => {
    const existingRes = await tx.query(
      `SELECT b.*, COALESCE(c.name, '') AS company_name
       FROM kb_branches b
       LEFT JOIN kb_companies c ON c.id = b.company_id
       WHERE b.id = $1 AND b.deleted_at IS NULL LIMIT 1`,
      [id]
    );
    if (!existingRes.rows.length) {
      throw new Error('NOT_FOUND: الفرع غير موجود.');
    }
    const before = mapBranchRow(existingRes.rows[0]);
    const actorId = str(session.user.id);
    const actorName = str(session.user.name || session.user.username);

    await tx.query(
      `UPDATE kb_branches SET deleted_at = NOW(), updated_by_id = $2, updated_by_name = $3, updated_at = NOW() WHERE id = $1`,
      [id, actorId, actorName]
    );
    await syncCompanyCitiesFromBranches(tx, before.companyId);

    await logKbAudit(tx, session, {
      entityType: 'KbBranch',
      entityId: id,
      actionType: 'kb_branch_deleted',
      titleSnapshot: `${before.companyName} — ${before.branchName}`,
      details: `حذف فرع: ${before.branchName} (${before.city})`,
      beforeJson: before,
      afterJson: { deleted: true }
    });
    return { deletedId: id };
  });
}

export async function getKbPolicies(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbView(session);
  const { page, pageSize, offset } = normalizePagination(payload, 20, 100);
  const sectionKey = str(payload.sectionKey);
  const category = str(payload.category);
  const companyId = str(payload.companyId);
  const city = str(payload.city);
  const publishStatus = str(payload.publishStatus);
  const search = str(payload.search);
  const canEdit = canPerm(session, 'kb_manage_policies') || canPerm(session, 'kb_publish_content');

  const res = await executor.query(
    `SELECT p.*, COALESCE(c.name, '') AS company_name
     FROM kb_policies p
     LEFT JOIN kb_companies c ON c.id = p.company_id
     WHERE p.deleted_at IS NULL
     ORDER BY p.updated_at DESC, p.created_at DESC`
  );

  let mapped = (res.rows || []).map(mapPolicyRow);
  if (!canEdit) {
    mapped = mapped.filter((p) => p.publishStatus === 'published');
  } else if (publishStatus && publishStatus !== 'all') {
    mapped = mapped.filter((p) => p.publishStatus === publishStatus);
  }

  if (sectionKey && sectionKey !== 'all') mapped = mapped.filter((p) => p.sectionKey === sectionKey);
  if (category && category !== 'all') mapped = mapped.filter((p) => p.category === category);
  if (companyId) mapped = mapped.filter((p) => p.companyId === companyId);
  if (city) {
    const normCity = normalizeArabicSearchText(city);
    mapped = mapped.filter((p) => normalizeArabicSearchText(p.city) === normCity);
  }
  if (search) {
    mapped = mapped
      .map((p) => ({
        item: p,
        score: scoreKbTextMatch(search, p.title, [p.descriptionText, p.companyName, p.city, p.category], p.keywords)
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }

  const total = mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const items = mapped.slice(offset, offset + pageSize);

  return {
    items,
    pagination: { page, pageSize, total, totalPages }
  };
}

export async function saveKbPolicy(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbPerm(session, 'kb_manage_policies', 'لا تملك صلاحية إضافة أو تعديل السياسات والشروط.');
  const id = str(payload.id);
  const title = str(payload.title);
  if (!title) throw new Error('VALIDATION_ERROR: عنوان السياسة مطلوب.');

  const rawHtml = payload.descriptionHtml !== undefined ? payload.descriptionHtml : payload.descriptionText;
  const descriptionHtml = sanitizeKbRichHtml(rawHtml);
  const descriptionText = extractPlainTextFromHtml(descriptionHtml);
  if (!descriptionText) throw new Error('VALIDATION_ERROR: محتوى السياسة مطلوب.');

  const category = str(payload.category || 'rental_gate');
  const sectionKey = getSectionForPolicyCategory(category, str(payload.sectionKey));
  const companyId = str(payload.companyId);
  const city = str(payload.city);
  const keywords = normalizeStringList(payload.keywords);
  const attachments = normalizeAttachments(payload.attachments);

  let publishStatus = str(payload.publishStatus || 'published');
  if (!['published', 'draft', 'archived'].includes(publishStatus)) publishStatus = 'published';
  if ((publishStatus === 'published' || publishStatus === 'archived') && !canPerm(session, 'kb_publish_content')) {
    publishStatus = 'draft';
  }

  const normalizedKey = buildPolicyNormalizedKey(sectionKey, category, companyId, city, title);
  const actorId = str(session.user.id);
  const actorName = str(session.user.name || session.user.username);

  return executor.withTransaction(async (tx) => {
    const dupRes = await tx.query<{ id: string }>(
      `SELECT id FROM kb_policies WHERE normalized_key = $1 AND deleted_at IS NULL AND ($2 = '' OR id <> $2) LIMIT 1`,
      [normalizedKey, id]
    );
    if (dupRes.rows.length) {
      throw new Error('DUPLICATE_ENTRY: توجد سياسة مسجلة مسبقاً بنفس العنوان في هذا القسم.');
    }

    let companyName = '';
    if (companyId) {
      const cRes = await tx.query<{ name: string }>(`SELECT name FROM kb_companies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [companyId]);
      if (!cRes.rows.length) throw new Error('NOT_FOUND: الشركة المرتبطة بالسياسة غير موجودة.');
      companyName = str(cRes.rows[0].name);
    }

    let before: Record<string, any> | null = null;
    let savedRow: any = null;
    let actionType = 'kb_policy_created';

    if (id) {
      const existingRes = await tx.query(`SELECT * FROM kb_policies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
      if (!existingRes.rows.length) throw new Error('NOT_FOUND: السياسة المطلوبة غير موجودة.');
      before = mapPolicyRow({ ...existingRes.rows[0], company_name: companyName });
      actionType = before.publishStatus !== 'archived' && publishStatus === 'archived' ? 'kb_policy_archived' : 'kb_policy_updated';

      const updRes = await tx.query(
        `UPDATE kb_policies
         SET title = $2,
             normalized_key = $3,
             description_html = $4,
             description_text = $5,
             section_key = $6,
             category = $7,
             company_id = $8,
             city = $9,
             keywords_json = $10::jsonb,
             attachments_json = $11::jsonb,
             publish_status = $12,
             updated_by_id = $13,
             updated_by_name = $14,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id, title, normalizedKey, descriptionHtml, descriptionText,
          sectionKey, category, companyId, city,
          JSON.stringify(keywords), JSON.stringify(attachments),
          publishStatus, actorId, actorName
        ]
      );
      savedRow = updRes.rows[0];
    } else {
      const newId = generateId('KBPOL');
      const insRes = await tx.query(
        `INSERT INTO kb_policies (
          id, title, normalized_key, description_html, description_text,
          section_key, category, company_id, city, keywords_json, attachments_json,
          publish_status, created_by_id, created_by_name, updated_by_id, updated_by_name,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10::jsonb, $11::jsonb,
          $12, $13, $14, $13, $14,
          NOW(), NOW()
        ) RETURNING *`,
        [
          newId, title, normalizedKey, descriptionHtml, descriptionText,
          sectionKey, category, companyId, city,
          JSON.stringify(keywords), JSON.stringify(attachments),
          publishStatus, actorId, actorName
        ]
      );
      savedRow = insRes.rows[0];
    }

    const mapped = mapPolicyRow({ ...savedRow, company_name: companyName });
    await logKbAudit(tx, session, {
      entityType: 'KbPolicy',
      entityId: mapped.id,
      actionType,
      titleSnapshot: mapped.title,
      details: `${actionType === 'kb_policy_created' ? 'إضافة سياسة' : (actionType === 'kb_policy_archived' ? 'أرشفة سياسة' : 'تحديث سياسة')}: ${mapped.title}`,
      beforeJson: before,
      afterJson: mapped
    });
    return { policy: mapped };
  });
}

export async function deleteKbPolicy(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbPerm(session, 'kb_delete_content', 'لا تملك صلاحية حذف السياسات.');
  const id = str(payload.id);
  if (!id) throw new Error('VALIDATION_ERROR: معرف السياسة مطلوب.');

  return executor.withTransaction(async (tx) => {
    const existingRes = await tx.query(`SELECT * FROM kb_policies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
    if (!existingRes.rows.length) throw new Error('NOT_FOUND: السياسة غير موجودة.');
    const before = mapPolicyRow(existingRes.rows[0]);
    const actorId = str(session.user.id);
    const actorName = str(session.user.name || session.user.username);

    await tx.query(
      `UPDATE kb_policies SET deleted_at = NOW(), updated_by_id = $2, updated_by_name = $3, updated_at = NOW() WHERE id = $1`,
      [id, actorId, actorName]
    );
    await logKbAudit(tx, session, {
      entityType: 'KbPolicy',
      entityId: id,
      actionType: 'kb_policy_deleted',
      titleSnapshot: before.title,
      details: `حذف سياسة: ${before.title}`,
      beforeJson: before,
      afterJson: { deleted: true }
    });
    return { deletedId: id };
  });
}

export async function recordKbPolicyView(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbView(session);
  const id = str(payload.id);
  if (!id) return { ok: false };
  const isSearchHit = Boolean(payload.fromSearch);
  await executor.query(
    `UPDATE kb_policies
     SET usage_count = usage_count + 1,
         search_hit_count = search_hit_count + $2
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, isSearchHit ? 1 : 0]
  );
  return { ok: true, id };
}

export async function getKbFaqs(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbView(session);
  const { page, pageSize, offset } = normalizePagination(payload, 24, 100);
  const category = str(payload.category);
  const companyId = str(payload.companyId);
  const publishStatus = str(payload.publishStatus);
  const sortBy = str(payload.sortBy || 'updated');
  const search = str(payload.search);
  const canEdit = canPerm(session, 'kb_manage_faqs') || canPerm(session, 'kb_publish_content');

  const orderClause =
    sortBy === 'most_used'
      ? 'f.usage_count DESC, f.updated_at DESC'
      : (sortBy === 'most_searched'
          ? 'f.search_hit_count DESC, f.usage_count DESC, f.updated_at DESC'
          : 'f.updated_at DESC, f.created_at DESC');

  const res = await executor.query(
    `SELECT f.*, COALESCE(c.name, '') AS company_name
     FROM kb_faqs f
     LEFT JOIN kb_companies c ON c.id = f.company_id
     WHERE f.deleted_at IS NULL
     ORDER BY ${orderClause}`
  );

  let mapped = (res.rows || []).map(mapFaqRow);
  if (!canEdit) {
    mapped = mapped.filter((f) => f.publishStatus === 'published');
  } else if (publishStatus && publishStatus !== 'all') {
    mapped = mapped.filter((f) => f.publishStatus === publishStatus);
  }
  if (category && category !== 'all') mapped = mapped.filter((f) => f.category === category);
  if (companyId) mapped = mapped.filter((f) => f.companyId === companyId);

  if (search) {
    mapped = mapped
      .map((f) => ({
        item: f,
        score: scoreKbTextMatch(search, f.question, [f.answerText, f.companyName, f.category], f.keywords)
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }

  const mostSearchedHighlights = mapped
    .filter((f) => f.publishStatus === 'published' && (f.searchHitCount > 0 || f.usageCount > 0))
    .slice()
    .sort((a, b) => (b.searchHitCount - a.searchHitCount) || (b.usageCount - a.usageCount))
    .slice(0, 5);

  const total = mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const items = mapped.slice(offset, offset + pageSize);

  return {
    items,
    mostSearchedHighlights,
    pagination: { page, pageSize, total, totalPages }
  };
}

export async function saveKbFaq(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbPerm(session, 'kb_manage_faqs', 'لا تملك صلاحية إضافة أو تعديل الأسئلة الشائعة.');
  const id = str(payload.id);
  const question = str(payload.question);
  if (!question) throw new Error('VALIDATION_ERROR: نص السؤال مطلوب.');

  const rawAnswer = payload.answerHtml !== undefined ? payload.answerHtml : payload.answerText;
  const answerHtml = sanitizeKbRichHtml(rawAnswer);
  const answerText = extractPlainTextFromHtml(answerHtml);
  if (!answerText) throw new Error('VALIDATION_ERROR: نص الإجابة مطلوب.');

  const category = str(payload.category || 'general');
  const companyId = str(payload.companyId);
  const keywords = normalizeStringList(payload.keywords);
  let publishStatus = str(payload.publishStatus || 'published');
  if (!['published', 'draft', 'archived'].includes(publishStatus)) publishStatus = 'published';
  if (publishStatus === 'archived' && !canPerm(session, 'kb_publish_content') && !canPerm(session, 'kb_manage_faqs')) {
    publishStatus = 'draft';
  }

  const normalizedKey = buildFaqNormalizedKey(companyId, question);
  const actorId = str(session.user.id);
  const actorName = str(session.user.name || session.user.username);

  return executor.withTransaction(async (tx) => {
    const dupRes = await tx.query<{ id: string }>(
      `SELECT id FROM kb_faqs WHERE normalized_key = $1 AND deleted_at IS NULL AND ($2 = '' OR id <> $2) LIMIT 1`,
      [normalizedKey, id]
    );
    if (dupRes.rows.length) {
      throw new Error('DUPLICATE_ENTRY: يوجد سؤال شائع مسجل مسبقاً بنفس الصياغة.');
    }

    let companyName = '';
    if (companyId) {
      const cRes = await tx.query<{ name: string }>(`SELECT name FROM kb_companies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [companyId]);
      if (!cRes.rows.length) throw new Error('NOT_FOUND: الشركة المرتبطة غير موجودة.');
      companyName = str(cRes.rows[0].name);
    }

    let before: Record<string, any> | null = null;
    let savedRow: any = null;
    let actionType = 'kb_faq_created';

    if (id) {
      const existingRes = await tx.query(`SELECT * FROM kb_faqs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
      if (!existingRes.rows.length) throw new Error('NOT_FOUND: السؤال المطلوب غير موجود.');
      before = mapFaqRow({ ...existingRes.rows[0], company_name: companyName });
      actionType = before.publishStatus !== 'archived' && publishStatus === 'archived' ? 'kb_faq_archived' : 'kb_faq_updated';

      const updRes = await tx.query(
        `UPDATE kb_faqs
         SET question = $2,
             normalized_key = $3,
             answer_html = $4,
             answer_text = $5,
             category = $6,
             company_id = $7,
             keywords_json = $8::jsonb,
             publish_status = $9,
             updated_by_id = $10,
             updated_by_name = $11,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id, question, normalizedKey, answerHtml, answerText,
          category, companyId, JSON.stringify(keywords), publishStatus,
          actorId, actorName
        ]
      );
      savedRow = updRes.rows[0];
    } else {
      const newId = generateId('KBFAQ');
      const insRes = await tx.query(
        `INSERT INTO kb_faqs (
          id, question, normalized_key, answer_html, answer_text,
          category, company_id, keywords_json, publish_status,
          created_by_id, created_by_name, updated_by_id, updated_by_name,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8::jsonb, $9,
          $10, $11, $10, $11,
          NOW(), NOW()
        ) RETURNING *`,
        [
          newId, question, normalizedKey, answerHtml, answerText,
          category, companyId, JSON.stringify(keywords), publishStatus,
          actorId, actorName
        ]
      );
      savedRow = insRes.rows[0];
    }

    const mapped = mapFaqRow({ ...savedRow, company_name: companyName });
    await logKbAudit(tx, session, {
      entityType: 'KbFaq',
      entityId: mapped.id,
      actionType,
      titleSnapshot: mapped.question,
      details: `${actionType === 'kb_faq_created' ? 'إضافة سؤال شائع' : 'تحديث سؤال شائع'}: ${mapped.question}`,
      beforeJson: before,
      afterJson: mapped
    });
    return { faq: mapped };
  });
}

export async function deleteKbFaq(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbPerm(session, 'kb_delete_content', 'لا تملك صلاحية حذف الأسئلة الشائعة.');
  const id = str(payload.id);
  if (!id) throw new Error('VALIDATION_ERROR: معرف السؤال مطلوب.');

  return executor.withTransaction(async (tx) => {
    const existingRes = await tx.query(`SELECT * FROM kb_faqs WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
    if (!existingRes.rows.length) throw new Error('NOT_FOUND: السؤال غير موجود.');
    const before = mapFaqRow(existingRes.rows[0]);
    const actorId = str(session.user.id);
    const actorName = str(session.user.name || session.user.username);

    await tx.query(
      `UPDATE kb_faqs SET deleted_at = NOW(), updated_by_id = $2, updated_by_name = $3, updated_at = NOW() WHERE id = $1`,
      [id, actorId, actorName]
    );
    await logKbAudit(tx, session, {
      entityType: 'KbFaq',
      entityId: id,
      actionType: 'kb_faq_deleted',
      titleSnapshot: before.question,
      details: `حذف سؤال شائع: ${before.question}`,
      beforeJson: before,
      afterJson: { deleted: true }
    });
    return { deletedId: id };
  });
}

export async function recordKbFaqUsage(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbView(session);
  const id = str(payload.id);
  if (!id) return { ok: false };
  const fromSearch = Boolean(payload.fromSearch);
  await executor.query(
    `UPDATE kb_faqs
     SET usage_count = usage_count + 1,
         search_hit_count = search_hit_count + $2
     WHERE id = $1 AND deleted_at IS NULL`,
    [id, fromSearch ? 1 : 0]
  );
  return { ok: true, id };
}

export async function getKbQuickReplies(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbView(session);
  const { page, pageSize, offset } = normalizePagination(payload, 24, 100);
  const category = str(payload.category);
  const language = str(payload.language);
  const companyId = str(payload.companyId);
  const status = str(payload.status);
  const sortBy = str(payload.sortBy || 'most_used');
  const search = str(payload.search);
  const canEdit = canPerm(session, 'kb_manage_quick_replies') || canPerm(session, 'kb_publish_content');

  const orderClause =
    sortBy === 'updated'
      ? 'q.updated_at DESC, q.usage_count DESC'
      : 'q.usage_count DESC, q.updated_at DESC';

  const res = await executor.query(
    `SELECT q.*, COALESCE(c.name, '') AS company_name
     FROM kb_quick_replies q
     LEFT JOIN kb_companies c ON c.id = q.company_id
     WHERE q.deleted_at IS NULL
     ORDER BY ${orderClause}`
  );

  let mapped = (res.rows || []).map(mapQuickReplyRow);
  if (!canEdit) {
    mapped = mapped.filter((r) => r.status === 'active');
  } else if (status && status !== 'all') {
    mapped = mapped.filter((r) => r.status === status);
  }
  if (category && category !== 'all') mapped = mapped.filter((r) => r.category === category);
  if (language === 'ar' || language === 'en') mapped = mapped.filter((r) => r.language === language);
  if (companyId) mapped = mapped.filter((r) => r.companyId === companyId);

  if (search) {
    mapped = mapped
      .map((r) => ({
        item: r,
        score: scoreKbTextMatch(search, r.title, [r.messageText, r.companyName, r.category], r.keywords)
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
  }

  const mostUsed = mapped
    .filter((r) => r.status === 'active' && r.usageCount > 0)
    .slice()
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 6);

  const total = mapped.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const items = mapped.slice(offset, offset + pageSize);

  return {
    items,
    mostUsed,
    pagination: { page, pageSize, total, totalPages }
  };
}

export async function saveKbQuickReply(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbPerm(session, 'kb_manage_quick_replies', 'لا تملك صلاحية إضافة أو تعديل الردود الجاهزة.');
  const id = str(payload.id);
  const title = str(payload.title);
  const messageText = str(payload.messageText);
  if (!title) throw new Error('VALIDATION_ERROR: عنوان الرد الجاهز مطلوب.');
  if (!messageText) throw new Error('VALIDATION_ERROR: نص الرد الجاهز مطلوب.');

  const category = str(payload.category || 'greeting');
  const language = str(payload.language) === 'en' ? 'en' : 'ar';
  const companyId = str(payload.companyId);
  const keywords = normalizeStringList(payload.keywords);
  let status = str(payload.status || 'active');
  if (!['active', 'draft', 'archived'].includes(status)) status = 'active';

  const normalizedKey = buildQuickReplyNormalizedKey(language, companyId, title);
  const actorId = str(session.user.id);
  const actorName = str(session.user.name || session.user.username);

  return executor.withTransaction(async (tx) => {
    const dupRes = await tx.query<{ id: string }>(
      `SELECT id FROM kb_quick_replies WHERE normalized_key = $1 AND deleted_at IS NULL AND ($2 = '' OR id <> $2) LIMIT 1`,
      [normalizedKey, id]
    );
    if (dupRes.rows.length) {
      throw new Error('DUPLICATE_ENTRY: يوجد رد جاهز مسجل مسبقاً بنفس العنوان واللغة.');
    }

    let companyName = '';
    if (companyId) {
      const cRes = await tx.query<{ name: string }>(`SELECT name FROM kb_companies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [companyId]);
      if (!cRes.rows.length) throw new Error('NOT_FOUND: الشركة المرتبطة غير موجودة.');
      companyName = str(cRes.rows[0].name);
    }

    let before: Record<string, any> | null = null;
    let savedRow: any = null;
    let actionType = 'kb_quick_reply_created';

    if (id) {
      const existingRes = await tx.query(`SELECT * FROM kb_quick_replies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
      if (!existingRes.rows.length) throw new Error('NOT_FOUND: الرد الجاهز المطلوب غير موجود.');
      before = mapQuickReplyRow({ ...existingRes.rows[0], company_name: companyName });
      actionType = before.status !== 'archived' && status === 'archived' ? 'kb_quick_reply_archived' : 'kb_quick_reply_updated';

      const updRes = await tx.query(
        `UPDATE kb_quick_replies
         SET title = $2,
             normalized_key = $3,
             message_text = $4,
             category = $5,
             keywords_json = $6::jsonb,
             language = $7,
             company_id = $8,
             status = $9,
             updated_by_id = $10,
             updated_by_name = $11,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id, title, normalizedKey, messageText, category,
          JSON.stringify(keywords), language, companyId, status,
          actorId, actorName
        ]
      );
      savedRow = updRes.rows[0];
    } else {
      const newId = generateId('KBQR');
      const insRes = await tx.query(
        `INSERT INTO kb_quick_replies (
          id, title, normalized_key, message_text, category, keywords_json,
          language, company_id, status,
          created_by_id, created_by_name, updated_by_id, updated_by_name,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb,
          $7, $8, $9,
          $10, $11, $10, $11,
          NOW(), NOW()
        ) RETURNING *`,
        [
          newId, title, normalizedKey, messageText, category,
          JSON.stringify(keywords), language, companyId, status,
          actorId, actorName
        ]
      );
      savedRow = insRes.rows[0];
    }

    const mapped = mapQuickReplyRow({ ...savedRow, company_name: companyName });
    await logKbAudit(tx, session, {
      entityType: 'KbQuickReply',
      entityId: mapped.id,
      actionType,
      titleSnapshot: mapped.title,
      details: `${actionType === 'kb_quick_reply_created' ? 'إضافة رد جاهز' : 'تحديث رد جاهز'}: ${mapped.title}`,
      beforeJson: before,
      afterJson: mapped
    });
    return { quickReply: mapped };
  });
}

export async function deleteKbQuickReply(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbPerm(session, 'kb_delete_content', 'لا تملك صلاحية حذف الردود الجاهزة.');
  const id = str(payload.id);
  if (!id) throw new Error('VALIDATION_ERROR: معرف الرد الجاهز مطلوب.');

  return executor.withTransaction(async (tx) => {
    const existingRes = await tx.query(`SELECT * FROM kb_quick_replies WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
    if (!existingRes.rows.length) throw new Error('NOT_FOUND: الرد الجاهز غير موجود.');
    const before = mapQuickReplyRow(existingRes.rows[0]);
    const actorId = str(session.user.id);
    const actorName = str(session.user.name || session.user.username);

    await tx.query(
      `UPDATE kb_quick_replies SET deleted_at = NOW(), updated_by_id = $2, updated_by_name = $3, updated_at = NOW() WHERE id = $1`,
      [id, actorId, actorName]
    );
    await logKbAudit(tx, session, {
      entityType: 'KbQuickReply',
      entityId: id,
      actionType: 'kb_quick_reply_deleted',
      titleSnapshot: before.title,
      details: `حذف رد جاهز: ${before.title}`,
      beforeJson: before,
      afterJson: { deleted: true }
    });
    return { deletedId: id };
  });
}

export async function recordKbQuickReplyUsage(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbView(session);
  const id = str(payload.id);
  if (!id) return { ok: false };
  await executor.query(
    `UPDATE kb_quick_replies SET usage_count = usage_count + 1 WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return { ok: true, id };
}

export async function searchKnowledgeBase(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbView(session);
  const queryText = str(payload.query || payload.search);
  const contentType = str(payload.contentType || 'all');
  const category = str(payload.category);
  const companyId = str(payload.companyId);
  const city = str(payload.city);
  const limit = Math.min(80, Math.max(10, Math.round(num(payload.limit, 40))));

  const canSeePolicyDrafts = canPerm(session, 'kb_manage_policies') || canPerm(session, 'kb_publish_content');
  const canSeeFaqDrafts = canPerm(session, 'kb_manage_faqs') || canPerm(session, 'kb_publish_content');
  const canSeeReplyDrafts = canPerm(session, 'kb_manage_quick_replies') || canPerm(session, 'kb_publish_content');

  const [compRes, brRes, polRes, faqRes, qrRes] = await Promise.all([
    (contentType === 'all' || contentType === 'company')
      ? executor.query(`SELECT * FROM kb_companies WHERE deleted_at IS NULL`)
      : Promise.resolve({ rows: [] }),
    (contentType === 'all' || contentType === 'branch')
      ? executor.query(`SELECT b.*, COALESCE(c.name, '') AS company_name FROM kb_branches b LEFT JOIN kb_companies c ON c.id = b.company_id WHERE b.deleted_at IS NULL`)
      : Promise.resolve({ rows: [] }),
    (contentType === 'all' || contentType === 'policy')
      ? executor.query(`SELECT p.*, COALESCE(c.name, '') AS company_name FROM kb_policies p LEFT JOIN kb_companies c ON c.id = p.company_id WHERE p.deleted_at IS NULL`)
      : Promise.resolve({ rows: [] }),
    (contentType === 'all' || contentType === 'faq')
      ? executor.query(`SELECT f.*, COALESCE(c.name, '') AS company_name FROM kb_faqs f LEFT JOIN kb_companies c ON c.id = f.company_id WHERE f.deleted_at IS NULL`)
      : Promise.resolve({ rows: [] }),
    (contentType === 'all' || contentType === 'quick_reply')
      ? executor.query(`SELECT q.*, COALESCE(c.name, '') AS company_name FROM kb_quick_replies q LEFT JOIN kb_companies c ON c.id = q.company_id WHERE q.deleted_at IS NULL`)
      : Promise.resolve({ rows: [] })
  ]);

  const normCityFilter = normalizeArabicSearchText(city);
  const results: KbUnifiedSearchResultItem[] = [];

  for (const row of compRes.rows || []) {
    const c = mapCompanyRow(row);
    if (companyId && c.id !== companyId) continue;
    if (normCityFilter && !c.cities.some((ct) => normalizeArabicSearchText(ct) === normCityFilter)) continue;
    if (category) continue;
    const score = scoreKbTextMatch(queryText, c.name, [c.shortDescription, c.cities.join(' '), c.serviceTypes.join(' '), c.phone], c.cities);
    if (score <= 0) continue;
    results.push({
      id: c.id,
      entityType: 'company',
      title: c.name,
      subtitle: c.cities.join('، ') || c.shortDescription.slice(0, 80),
      snippet: c.shortDescription.slice(0, 140),
      companyId: c.id,
      companyName: c.name,
      city: c.cities[0] || '',
      category: '',
      sectionKey: 'companies',
      status: c.status,
      usageCount: 0,
      updatedAt: c.updatedAt,
      score
    });
  }

  for (const row of brRes.rows || []) {
    const b = mapBranchRow(row);
    if (companyId && b.companyId !== companyId) continue;
    if (normCityFilter && normalizeArabicSearchText(b.city) !== normCityFilter) continue;
    if (category) continue;
    const score = scoreKbTextMatch(queryText, b.branchName, [b.companyName, b.city, b.district, b.fullAddress, b.services.join(' ')], [b.city, b.district]);
    if (score <= 0) continue;
    results.push({
      id: b.id,
      entityType: 'branch',
      title: b.branchName,
      subtitle: `${b.companyName} — ${b.city}${b.district ? ' · ' + b.district : ''}`,
      snippet: b.fullAddress || b.workingHours || b.phone,
      companyId: b.companyId,
      companyName: b.companyName,
      city: b.city,
      category: '',
      sectionKey: 'branches',
      status: b.status,
      usageCount: 0,
      updatedAt: b.updatedAt,
      score
    });
  }

  for (const row of polRes.rows || []) {
    const p = mapPolicyRow(row);
    if (!canSeePolicyDrafts && p.publishStatus !== 'published') continue;
    if (companyId && p.companyId !== companyId) continue;
    if (normCityFilter && normalizeArabicSearchText(p.city) !== normCityFilter) continue;
    if (category && p.category !== category) continue;
    const score = scoreKbTextMatch(queryText, p.title, [p.descriptionText, p.companyName, p.city], p.keywords);
    if (score <= 0) continue;
    results.push({
      id: p.id,
      entityType: 'policy',
      title: p.title,
      subtitle: `${p.companyName ? p.companyName + ' · ' : ''}${p.category}`,
      snippet: p.descriptionText.slice(0, 150),
      companyId: p.companyId,
      companyName: p.companyName,
      city: p.city,
      category: p.category,
      sectionKey: p.sectionKey,
      status: p.publishStatus,
      usageCount: p.usageCount,
      updatedAt: p.updatedAt,
      score
    });
  }

  for (const row of faqRes.rows || []) {
    const f = mapFaqRow(row);
    if (!canSeeFaqDrafts && f.publishStatus !== 'published') continue;
    if (companyId && f.companyId !== companyId) continue;
    if (normCityFilter) continue;
    if (category && f.category !== category) continue;
    const score = scoreKbTextMatch(queryText, f.question, [f.answerText, f.companyName], f.keywords);
    if (score <= 0) continue;
    results.push({
      id: f.id,
      entityType: 'faq',
      title: f.question,
      subtitle: f.companyName || f.category,
      snippet: f.answerText.slice(0, 150),
      companyId: f.companyId,
      companyName: f.companyName,
      city: '',
      category: f.category,
      sectionKey: 'faq',
      status: f.publishStatus,
      usageCount: f.usageCount,
      updatedAt: f.updatedAt,
      score
    });
  }

  for (const row of qrRes.rows || []) {
    const q = mapQuickReplyRow(row);
    if (!canSeeReplyDrafts && q.status !== 'active') continue;
    if (companyId && q.companyId !== companyId) continue;
    if (normCityFilter) continue;
    if (category && q.category !== category) continue;
    const score = scoreKbTextMatch(queryText, q.title, [q.messageText, q.companyName], q.keywords);
    if (score <= 0) continue;
    results.push({
      id: q.id,
      entityType: 'quick_reply',
      title: q.title,
      subtitle: `${q.language.toUpperCase()} · ${q.category}`,
      snippet: q.messageText.slice(0, 150),
      companyId: q.companyId,
      companyName: q.companyName,
      city: '',
      category: q.category,
      sectionKey: 'quick_replies',
      status: q.status,
      usageCount: q.usageCount,
      updatedAt: q.updatedAt,
      score
    });
  }

  results.sort((a, b) => (b.score - a.score) || (b.usageCount - a.usageCount));
  const top = results.slice(0, limit);

  return {
    query: queryText,
    totalMatches: results.length,
    items: top
  };
}

export async function getKbAuditHistory(executor: DbExecutor, session: AuthSession, payload: Record<string, any> = {}) {
  assertKbView(session);
  const { page, pageSize, offset } = normalizePagination(payload, 25, 100);
  const entityType = str(payload.entityType);
  const entityId = str(payload.entityId);

  const whereParts: string[] = [];
  const params: any[] = [];
  if (entityType) {
    params.push(entityType);
    whereParts.push(`entity_type = $${params.length}`);
  }
  if (entityId) {
    params.push(entityId);
    whereParts.push(`entity_id = $${params.length}`);
  }
  const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const [countRes, rowsRes] = await Promise.all([
    executor.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM kb_revisions ${whereClause}`, params),
    executor.query(
      `SELECT * FROM kb_revisions ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    )
  ]);

  const total = Number(countRes.rows?.[0]?.total || 0);
  return {
    items: (rowsRes.rows || []).map((r: any) => ({
      id: str(r.id),
      entityType: str(r.entity_type),
      entityId: str(r.entity_id),
      actionType: str(r.action_type),
      titleSnapshot: str(r.title_snapshot),
      before: parseJsonVal(r.before_json, {}),
      after: parseJsonVal(r.after_json, {}),
      actorId: str(r.actor_id),
      actorName: str(r.actor_name),
      createdAt: toIso(r.created_at)
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  };
}

export async function exportKbBackup(executor: DbExecutor, session: AuthSession) {
  assertKbView(session);
  const [companiesRes, branchesRes, policiesRes, faqsRes, repliesRes, revisionsRes] = await Promise.all([
    executor.query(`SELECT * FROM kb_companies WHERE deleted_at IS NULL ORDER BY name ASC`),
    executor.query(`SELECT b.*, COALESCE(c.name, '') AS company_name FROM kb_branches b LEFT JOIN kb_companies c ON c.id = b.company_id WHERE b.deleted_at IS NULL ORDER BY b.created_at ASC`),
    executor.query(`SELECT p.*, COALESCE(c.name, '') AS company_name FROM kb_policies p LEFT JOIN kb_companies c ON c.id = p.company_id WHERE p.deleted_at IS NULL ORDER BY p.created_at ASC`),
    executor.query(`SELECT f.*, COALESCE(c.name, '') AS company_name FROM kb_faqs f LEFT JOIN kb_companies c ON c.id = f.company_id WHERE f.deleted_at IS NULL ORDER BY f.created_at ASC`),
    executor.query(`SELECT q.*, COALESCE(c.name, '') AS company_name FROM kb_quick_replies q LEFT JOIN kb_companies c ON c.id = q.company_id WHERE q.deleted_at IS NULL ORDER BY q.created_at ASC`),
    executor.query(`SELECT * FROM kb_revisions ORDER BY created_at DESC LIMIT 200`)
  ]);

  return {
    exportedAt: new Date().toISOString(),
    exportedBy: str(session.user.name || session.user.username),
    source: 'Neon PostgreSQL (Knowledge Base)',
    companies: (companiesRes.rows || []).map((r: any) => mapCompanyRow(r)),
    branches: (branchesRes.rows || []).map(mapBranchRow),
    policies: (policiesRes.rows || []).map(mapPolicyRow),
    faqs: (faqsRes.rows || []).map(mapFaqRow),
    quickReplies: (repliesRes.rows || []).map(mapQuickReplyRow),
    revisions: (revisionsRes.rows || []).map((r: any) => ({
      id: str(r.id),
      entityType: str(r.entity_type),
      entityId: str(r.entity_id),
      actionType: str(r.action_type),
      titleSnapshot: str(r.title_snapshot),
      actorName: str(r.actor_name),
      createdAt: toIso(r.created_at)
    }))
  };
}
