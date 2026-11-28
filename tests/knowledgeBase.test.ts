import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthSession } from '../backend/auth';
import type { DbClient, DbExecutor, QueryResult, QueryResultRow } from '../backend/db';
import {
  KB_SECTIONS,
  extractPlainTextFromHtml,
  extractQuickReplyVariables,
  getSectionForPolicyCategory,
  mergeCompanyAndBranchCities,
  normalizeArabicSearchText,
  renderQuickReplyTemplate,
  sanitizeKbRichHtml,
  sanitizeUrl,
  scoreKbTextMatch
} from '../backend/kbLogic';
import {
  deleteKbCompany,
  deleteKbFaq,
  deleteKbPolicy,
  deleteKbQuickReply,
  getKnowledgeBaseDashboard,
  saveKbBranch,
  saveKbCompany,
  saveKbFaq,
  saveKbPolicy,
  saveKbQuickReply
} from '../backend/kbService';

function makeSession(role: string, permissions: string[] = []): AuthSession {
  const nowIso = new Date().toISOString();
  return {
    tokenHash: `hash_${role}`,
    employeeId: `EMP_${role.toUpperCase()}`,
    username: role,
    role,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    user: {
      id: `EMP_${role.toUpperCase()}`,
      name: `${role} User`,
      username: role,
      phone: '',
      email: '',
      jobTitle: role,
      role,
      permissions,
      status: 'active',
      lastActivity: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso
    }
  };
}

interface KbMemStore {
  companies: any[];
  branches: any[];
  policies: any[];
  faqs: any[];
  quickReplies: any[];
  revisions: any[];
  activities: any[];
  queries: string[];
}

function createKbMockExecutor(store?: KbMemStore): { executor: DbExecutor; store: KbMemStore } {
  const db: KbMemStore = store || {
    companies: [],
    branches: [],
    policies: [],
    faqs: [],
    quickReplies: [],
    revisions: [],
    activities: [],
    queries: []
  };

  const query = async <T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> => {
    const clean = sql.replace(/\s+/g, ' ').trim();
    db.queries.push(clean);

    // Duplicate company check
    if (clean.startsWith('SELECT id FROM kb_companies WHERE normalized_name = $1')) {
      const [normName, excludeId] = params;
      const found = db.companies.filter((c) => !c.deleted_at && c.normalized_name === normName && (!excludeId || c.id !== excludeId));
      return { rows: found.map((c) => ({ id: c.id })), rowCount: found.length } as unknown as QueryResult<T>;
    }

    // Select company by id
    if (clean.startsWith('SELECT * FROM kb_companies WHERE id = $1')) {
      const [id] = params;
      const rows = db.companies.filter((c) => c.id === id && (!clean.includes('deleted_at IS NULL') || !c.deleted_at));
      return { rows, rowCount: rows.length } as unknown as QueryResult<T>;
    }

    // Insert company
    if (clean.startsWith('INSERT INTO kb_companies')) {
      const [
        id, name, normalizedName, logoUrl, shortDescription, imagesJson,
        phone, email, website, status, citiesJson, serviceTypesJson, internalNotes,
        actorId, actorName
      ] = params;
      const now = new Date().toISOString();
      const row = {
        id,
        name,
        normalized_name: normalizedName,
        logo_url: logoUrl,
        short_description: shortDescription,
        images_json: JSON.parse(imagesJson),
        phone,
        email,
        website,
        status,
        cities_json: JSON.parse(citiesJson),
        service_types_json: JSON.parse(serviceTypesJson),
        internal_notes: internalNotes,
        created_by_id: actorId,
        created_by_name: actorName,
        updated_by_id: actorId,
        updated_by_name: actorName,
        created_at: now,
        updated_at: now,
        deleted_at: null
      };
      db.companies.push(row);
      return { rows: [row], rowCount: 1 } as unknown as QueryResult<T>;
    }

    // Soft-delete company & cascading branches
    if (clean.startsWith('UPDATE kb_companies SET deleted_at = NOW()')) {
      const [id, actorId, actorName] = params;
      for (const c of db.companies) {
        if (c.id === id) {
          c.deleted_at = new Date().toISOString();
          c.updated_by_id = actorId;
          c.updated_by_name = actorName;
        }
      }
      return { rows: [], rowCount: 1 } as unknown as QueryResult<T>;
    }
    if (clean.startsWith('UPDATE kb_branches SET deleted_at = NOW()')) {
      const [companyId] = params;
      for (const b of db.branches) {
        if (b.company_id === companyId && !b.deleted_at) {
          b.deleted_at = new Date().toISOString();
        }
      }
      return { rows: [], rowCount: 1 } as unknown as QueryResult<T>;
    }

    // Policy duplicate / insert
    if (clean.startsWith('SELECT id FROM kb_policies WHERE normalized_key = $1')) {
      return { rows: [], rowCount: 0 } as unknown as QueryResult<T>;
    }
    if (clean.startsWith('SELECT name FROM kb_companies WHERE id = $1')) {
      const [cid] = params;
      const comp = db.companies.find((c) => c.id === cid && !c.deleted_at);
      return { rows: comp ? [{ name: comp.name }] : [], rowCount: comp ? 1 : 0 } as unknown as QueryResult<T>;
    }
    if (clean.startsWith('INSERT INTO kb_policies')) {
      const [
        id, title, normKey, descHtml, descText, secKey, cat, companyId, city,
        kwJson, attJson, pubStatus, actorId, actorName
      ] = params;
      const now = new Date().toISOString();
      const row = {
        id,
        title,
        normalized_key: normKey,
        description_html: descHtml,
        description_text: descText,
        section_key: secKey,
        category: cat,
        company_id: companyId,
        city,
        keywords_json: JSON.parse(kwJson),
        attachments_json: JSON.parse(attJson),
        publish_status: pubStatus,
        usage_count: 0,
        search_hit_count: 0,
        created_by_id: actorId,
        created_by_name: actorName,
        updated_by_id: actorId,
        updated_by_name: actorName,
        created_at: now,
        updated_at: now,
        deleted_at: null
      };
      db.policies.push(row);
      return { rows: [row], rowCount: 1 } as unknown as QueryResult<T>;
    }

    // FAQ duplicate / insert
    if (clean.startsWith('SELECT id FROM kb_faqs WHERE normalized_key = $1')) {
      return { rows: [], rowCount: 0 } as unknown as QueryResult<T>;
    }
    if (clean.startsWith('INSERT INTO kb_faqs')) {
      const [
        id, question, normKey, ansHtml, ansText, cat, companyId,
        kwJson, pubStatus, actorId, actorName
      ] = params;
      const now = new Date().toISOString();
      const row = {
        id,
        question,
        normalized_key: normKey,
        answer_html: ansHtml,
        answer_text: ansText,
        category: cat,
        company_id: companyId,
        keywords_json: JSON.parse(kwJson),
        publish_status: pubStatus,
        usage_count: 0,
        search_hit_count: 0,
        created_by_id: actorId,
        created_by_name: actorName,
        updated_by_id: actorId,
        updated_by_name: actorName,
        created_at: now,
        updated_at: now,
        deleted_at: null
      };
      db.faqs.push(row);
      return { rows: [row], rowCount: 1 } as unknown as QueryResult<T>;
    }

    // Quick Reply duplicate / insert
    if (clean.startsWith('SELECT id FROM kb_quick_replies WHERE normalized_key = $1')) {
      return { rows: [], rowCount: 0 } as unknown as QueryResult<T>;
    }
    if (clean.startsWith('INSERT INTO kb_quick_replies')) {
      const [
        id, title, normKey, msgText, cat, kwJson, lang, companyId, status, actorId, actorName
      ] = params;
      const now = new Date().toISOString();
      const row = {
        id,
        title,
        normalized_key: normKey,
        message_text: msgText,
        category: cat,
        keywords_json: JSON.parse(kwJson),
        language: lang,
        company_id: companyId,
        status,
        usage_count: 0,
        created_by_id: actorId,
        created_by_name: actorName,
        updated_by_id: actorId,
        updated_by_name: actorName,
        created_at: now,
        updated_at: now,
        deleted_at: null
      };
      db.quickReplies.push(row);
      return { rows: [row], rowCount: 1 } as unknown as QueryResult<T>;
    }

    // Revisions & Activity Log
    if (clean.startsWith('INSERT INTO kb_revisions')) {
      db.revisions.push({ id: params[0], entityType: params[1], entityId: params[2], actionType: params[3], titleSnapshot: params[4] });
      return { rows: [], rowCount: 1 } as unknown as QueryResult<T>;
    }
    if (clean.startsWith('INSERT INTO activity_log')) {
      db.activities.push({ id: params[0], employeeId: params[1], actionType: params[3], entityType: params[4], entityId: params[5] });
      return { rows: [], rowCount: 1 } as unknown as QueryResult<T>;
    }

    // Dashboard queries fallback
    if (clean.includes('FROM kb_companies WHERE deleted_at IS NULL ORDER BY name ASC')) {
      const rows = db.companies.filter((c) => !c.deleted_at);
      return { rows, rowCount: rows.length } as unknown as QueryResult<T>;
    }
    if (clean.includes('FROM kb_branches WHERE deleted_at IS NULL')) {
      const rows = db.branches.filter((b) => !b.deleted_at);
      return { rows, rowCount: rows.length } as unknown as QueryResult<T>;
    }
    if (clean.includes('FROM kb_policies WHERE deleted_at IS NULL')) {
      const rows = db.policies.filter((p) => !p.deleted_at);
      return { rows: [{ total: rows.length, published: rows.filter((p) => p.publish_status === 'published').length }], rowCount: 1 } as unknown as QueryResult<T>;
    }
    if (clean.includes('FROM kb_faqs WHERE deleted_at IS NULL')) {
      const rows = db.faqs.filter((f) => !f.deleted_at);
      return { rows: [{ total: rows.length, published: rows.filter((f) => f.publish_status === 'published').length }], rowCount: 1 } as unknown as QueryResult<T>;
    }
    if (clean.includes('FROM kb_quick_replies WHERE deleted_at IS NULL')) {
      const rows = db.quickReplies.filter((q) => !q.deleted_at);
      return { rows: [{ total: rows.length, active: rows.filter((q) => q.status === 'active').length }], rowCount: 1 } as unknown as QueryResult<T>;
    }

    return { rows: [], rowCount: 0 } as unknown as QueryResult<T>;
  };

  return {
    store: db,
    executor: {
      query,
      async withTransaction<R>(fn: (tx: DbClient) => Promise<R>): Promise<R> {
        return fn({ query });
      }
    }
  };
}

test('KB defines all 9 required sections in order', () => {
  assert.equal(KB_SECTIONS.length, 9);
  assert.deepEqual(
    KB_SECTIONS.map((s) => s.id),
    [
      'overview',
      'companies',
      'branches',
      'rental_gate_policies',
      'company_policies',
      'booking_pickup_terms',
      'cancellation_refunds',
      'faq',
      'quick_replies'
    ]
  );
});

test('sanitizeKbRichHtml strips XSS vectors while keeping safe rich text markup', () => {
  const dirty =
    '<h3 onclick="alert(1)">شروط الحجز</h3>' +
    '<script>fetch("https://evil.test")</script>' +
    '<iframe src="https://evil.test/x"></iframe>' +
    '<p>يرجى إحضار <strong>الهوية الوطنية</strong> و<a href="javascript:alert(2)">رابط خبيث</a> أو ' +
    '<a href="https://rentalgate.sa/terms">الشروط الرسمية</a></p>' +
    '<ul><li>العمر 21 عاماً فأكثر</li></ul>';

  const clean = sanitizeKbRichHtml(dirty);
  assert.equal(/<script/i.test(clean), false);
  assert.equal(/<iframe/i.test(clean), false);
  assert.equal(/onclick=/i.test(clean), false);
  assert.equal(/javascript:/i.test(clean), false);
  assert.match(clean, /<h3>شروط الحجز<\/h3>/);
  assert.match(clean, /<strong>الهوية الوطنية<\/strong>/);
  assert.match(clean, /href="https:\/\/rentalgate\.sa\/terms" target="_blank" rel="noopener noreferrer"/);
  assert.match(clean, /<ul><li>العمر 21 عاماً فأكثر<\/li><\/ul>/);

  const plain = extractPlainTextFromHtml(clean);
  assert.match(plain, /شروط الحجز/);
  assert.match(plain, /العمر 21 عاماً فأكثر/);
});

test('sanitizeUrl blocks dangerous protocols and normalizes valid domains', () => {
  assert.equal(sanitizeUrl('javascript:alert(1)'), '');
  assert.equal(sanitizeUrl('data:text/html,<script>1</script>'), '');
  assert.equal(sanitizeUrl('https://maps.google.com/?q=riyadh'), 'https://maps.google.com/?q=riyadh');
  assert.equal(sanitizeUrl('rentalgate.sa/info'), 'https://rentalgate.sa/info');
});

test('Quick reply variable substitution works for copying without auto-sending', () => {
  const tpl = 'أهلاً {customer_name}، حجزك رقم {booking_number} لدى {company_name} فرع {branch_name} بتاريخ {pickup_date}.';
  assert.deepEqual(extractQuickReplyVariables(tpl), [
    'customer_name',
    'booking_number',
    'company_name',
    'branch_name',
    'pickup_date'
  ]);

  const rendered = renderQuickReplyTemplate(tpl, {
    customer_name: 'أحمد العتيبي',
    booking_number: 'RG-99401',
    company_name: 'شركة يلو',
    branch_name: 'مطار الملك خالد',
    pickup_date: ''
  });
  assert.equal(
    rendered,
    'أهلاً أحمد العتيبي، حجزك رقم RG-99401 لدى شركة يلو فرع مطار الملك خالد بتاريخ {pickup_date}.'
  );
});

test('mergeCompanyAndBranchCities deduplicates Arabic variants cleanly for outer company cards', () => {
  const cities = mergeCompanyAndBranchCities(['الرياض', 'جدة'], ['الرياض', 'الدمام', 'مكة المكرمة', 'مكه المكرمة']);
  assert.deepEqual(cities, ['الرياض', 'جدة', 'الدمام', 'مكة المكرمة']);
  assert.equal(normalizeArabicSearchText('أبها  المدينة'), 'ابها المدينه');
  assert.equal(getSectionForPolicyCategory('cancellation_policy'), 'cancellation_refunds');
  assert.equal(getSectionForPolicyCategory('age_license_terms'), 'booking_pickup_terms');
  assert.ok(scoreKbTextMatch('الرياض مطار', 'فرع مطار الرياض الدولي', ['الرياض'], ['استلام']) > 0);
});

test('RBAC: agent can view and manage FAQs/Quick Replies, but cannot edit companies, branches, policies, or delete', async () => {
  const { executor, store } = createKbMockExecutor();
  const agent = makeSession('agent', [
    'view_knowledge_base',
    'kb_manage_faqs',
    'kb_manage_quick_replies'
  ]);

  // Agent can view dashboard
  const dash = await getKnowledgeBaseDashboard(executor, agent);
  assert.equal(dash.kpis.totalCompanies, 0);

  // Agent CANNOT add company, branch, or policy
  await assert.rejects(
    () => saveKbCompany(executor, agent, { name: 'شركة اختبار' }),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => saveKbBranch(executor, agent, { companyId: 'KBCMP_1', branchName: 'فرع 1', city: 'الرياض' }),
    /FORBIDDEN/
  );
  await assert.rejects(
    () => saveKbPolicy(executor, agent, { title: 'سياسة اختبار', descriptionHtml: '<p>نص</p>' }),
    /FORBIDDEN/
  );

  // Agent CAN add FAQ & Quick Reply
  const faqRes = await saveKbFaq(executor, agent, {
    question: 'ما هو الحد الأدنى للعمر؟',
    answerText: 'الحد الأدنى للعمر هو 21 عاماً.',
    category: 'documents_age'
  });
  assert.equal(faqRes.faq.question, 'ما هو الحد الأدنى للعمر؟');

  const qrRes = await saveKbQuickReply(executor, agent, {
    title: 'تأكيد استلام',
    messageText: 'مرحباً {customer_name} تم تأكيد الحجز {booking_number}',
    category: 'bookings',
    language: 'ar'
  });
  assert.equal(qrRes.quickReply.title, 'تأكيد استلام');

  // Agent CANNOT delete anything
  await assert.rejects(() => deleteKbFaq(executor, agent, { id: faqRes.faq.id }), /FORBIDDEN/);
  await assert.rejects(() => deleteKbQuickReply(executor, agent, { id: qrRes.quickReply.id }), /FORBIDDEN/);
  await assert.rejects(() => deleteKbPolicy(executor, agent, { id: 'KBPOL_1' }), /FORBIDDEN/);
  await assert.rejects(() => deleteKbCompany(executor, agent, { id: 'KBCMP_1' }), /FORBIDDEN/);

  assert.equal(store.revisions.length, 2);
  assert.equal(store.activities.length, 2);
  // Knowledge Base never writes to sheets_sync_outbox
  assert.equal(store.queries.some((q) => q.includes('sheets_sync_outbox')), false);
});

test('Supervisor can create companies & policies with duplicate prevention and audit trail, but cannot delete', async () => {
  const { executor, store } = createKbMockExecutor();
  const supervisor = makeSession('supervisor', [
    'view_knowledge_base',
    'kb_manage_companies',
    'kb_manage_policies',
    'kb_manage_faqs',
    'kb_manage_quick_replies',
    'kb_publish_content'
  ]);
  const manager = makeSession('general_manager', [
    'view_knowledge_base',
    'kb_manage_companies',
    'kb_manage_policies',
    'kb_delete_content'
  ]);

  const created = await saveKbCompany(executor, supervisor, {
    name: 'الوفاق لتأجير السيارات',
    cities: 'الرياض، جدة',
    serviceTypes: 'تأجير يومي، مطار',
    status: 'active'
  });
  assert.deepEqual(created.company.cities, ['الرياض', 'جدة']);

  // Duplicate company name rejected cleanly
  await assert.rejects(
    () => saveKbCompany(executor, supervisor, { name: 'الوفاق لتأجير السيارات', cities: 'الدمام' }),
    /DUPLICATE_ENTRY/
  );

  // Supervisor can save policy with sanitized HTML
  const pol = await saveKbPolicy(executor, supervisor, {
    title: 'شروط استلام السيارة في المطار',
    category: 'pickup_return_terms',
    companyId: created.company.id,
    city: 'الرياض',
    descriptionHtml: '<p>إحضار الرخصة</p><script>alert(9)</script>'
  });
  assert.equal(pol.policy.sectionKey, 'booking_pickup_terms');
  assert.equal(pol.policy.descriptionHtml.includes('script'), false);

  // Supervisor cannot delete
  await assert.rejects(
    () => deleteKbCompany(executor, supervisor, { id: created.company.id }),
    /FORBIDDEN/
  );

  // General manager CAN delete & logs revision + activity
  const delRes = await deleteKbCompany(executor, manager, { id: created.company.id });
  assert.equal(delRes.deletedId, created.company.id);
  assert.equal(store.revisions.length, 3);
  assert.equal(store.activities.length, 3);
});
