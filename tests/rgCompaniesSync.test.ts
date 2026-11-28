import test from 'node:test';
import assert from 'node:assert/strict';
import type { AuthSession } from '../backend/auth';
import type { DbExecutor, QueryResult, QueryResultRow } from '../backend/db';
import {
  mergeSyncedCompaniesWithCars,
  normalizeCompanyCarsList
} from '../backend/kbLogic';
import {
  fetchRgCompaniesAndCars,
  validateAllowedRgExternalUrl
} from '../backend/rgApiClient';
import { syncKbCompaniesFromApi } from '../backend/kbService';

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

interface SyncMockStore {
  companies: any[];
  branches: any[];
  revisions: any[];
  activities: any[];
  queries: string[];
}

function createSyncMockExecutor(initial?: Partial<SyncMockStore>): { executor: DbExecutor; store: SyncMockStore } {
  const db: SyncMockStore = {
    companies: initial?.companies ? [...initial.companies] : [],
    branches: initial?.branches ? [...initial.branches] : [],
    revisions: initial?.revisions ? [...initial.revisions] : [],
    activities: initial?.activities ? [...initial.activities] : [],
    queries: []
  };

  const query = async <T extends QueryResultRow = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> => {
    const clean = sql.replace(/\s+/g, ' ').trim();
    db.queries.push(clean);

    if (clean.startsWith('SELECT * FROM kb_companies WHERE deleted_at IS NULL')) {
      const active = db.companies.filter((c) => !c.deleted_at);
      return { rows: active, rowCount: active.length } as unknown as QueryResult<T>;
    }

    if (clean.startsWith('INSERT INTO kb_companies')) {
      const [
        id, sourceCompanyId, name, normalizedName, logoUrl, shortDescription,
        phone, email, website, status, citiesJson, serviceTypesJson,
        carsJson, carsCount, internalNotes, actorId, actorName
      ] = params;
      const now = new Date().toISOString();
      const row = {
        id,
        source_company_id: sourceCompanyId,
        name,
        normalized_name: normalizedName,
        logo_url: logoUrl,
        short_description: shortDescription,
        images_json: [],
        phone,
        email,
        website,
        status,
        cities_json: JSON.parse(citiesJson),
        service_types_json: JSON.parse(serviceTypesJson),
        cars_json: JSON.parse(carsJson),
        cars_count: carsCount,
        internal_notes: internalNotes,
        last_synced_at: now,
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

    if (clean.startsWith('UPDATE kb_companies SET source_company_id = $2')) {
      const [
        id, sourceCompanyId, name, normalizedName, logoUrl, shortDescription,
        phone, email, website, status, citiesJson, serviceTypesJson,
        carsJson, carsCount, internalNotes, actorId, actorName
      ] = params;
      const target = db.companies.find((c) => c.id === id);
      assert.ok(target, `Expected kb_companies row for ${id}`);
      target.source_company_id = sourceCompanyId;
      target.name = name;
      target.normalized_name = normalizedName;
      target.logo_url = logoUrl;
      target.short_description = shortDescription;
      target.phone = phone;
      target.email = email;
      target.website = website;
      target.status = status;
      target.cities_json = JSON.parse(citiesJson);
      target.service_types_json = JSON.parse(serviceTypesJson);
      target.cars_json = JSON.parse(carsJson);
      target.cars_count = carsCount;
      target.internal_notes = internalNotes;
      target.last_synced_at = new Date().toISOString();
      target.updated_by_id = actorId;
      target.updated_by_name = actorName;
      target.updated_at = new Date().toISOString();
      return { rows: [target], rowCount: 1 } as unknown as QueryResult<T>;
    }

    if (clean.startsWith('SELECT id FROM kb_branches WHERE normalized_key = $1')) {
      const [bKey] = params;
      const found = db.branches.filter((b) => !b.deleted_at && b.normalized_key === bKey);
      return { rows: found.map((b) => ({ id: b.id })), rowCount: found.length } as unknown as QueryResult<T>;
    }

    if (clean.startsWith('INSERT INTO kb_branches')) {
      const [
        id, companyId, branchName, normalizedKey, city, district, fullAddress,
        googleMapsUrl, phone, workingHours, status, servicesJson, actorId, actorName
      ] = params;
      const now = new Date().toISOString();
      const row = {
        id,
        company_id: companyId,
        branch_name: branchName,
        normalized_key: normalizedKey,
        city,
        district,
        full_address: fullAddress,
        google_maps_url: googleMapsUrl,
        phone,
        working_hours: workingHours,
        status,
        services_json: JSON.parse(servicesJson),
        notes: '',
        created_by_id: actorId,
        created_by_name: actorName,
        updated_by_id: actorId,
        updated_by_name: actorName,
        created_at: now,
        updated_at: now,
        deleted_at: null
      };
      db.branches.push(row);
      return { rows: [row], rowCount: 1 } as unknown as QueryResult<T>;
    }

    if (clean.startsWith('INSERT INTO kb_revisions')) {
      db.revisions.push({
        id: params[0],
        entity_type: params[1],
        entity_id: params[2],
        action_type: params[3],
        title_snapshot: params[4],
        before_json: JSON.parse(params[5]),
        after_json: JSON.parse(params[6]),
        actor_id: params[7],
        actor_name: params[8]
      });
      return { rows: [], rowCount: 1 } as unknown as QueryResult<T>;
    }

    if (clean.startsWith('INSERT INTO activity_log')) {
      db.activities.push({ id: params[0], action_type: params[4], details: params[7] });
      return { rows: [], rowCount: 1 } as unknown as QueryResult<T>;
    }

    if (clean.includes('FROM system_settings') || clean.includes('FROM app_settings')) {
      return { rows: [], rowCount: 0 } as unknown as QueryResult<T>;
    }

    throw new Error(`Unhandled SQL in sync test mock: ${clean}`);
  };

  const executor: DbExecutor = {
    query: query as any,
    async withTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn({ query });
    }
  };

  return { executor, store: db };
}

function jsonResponse(data: any, status = 200, contentType = 'application/json'): Response {
  return new Response(typeof data === 'string' ? data : JSON.stringify(data), {
    status,
    headers: { 'content-type': contentType }
  });
}

test('validateAllowedRgExternalUrl enforces HTTPS and strict Rental Gate host allowlist', () => {
  assert.equal(
    validateAllowedRgExternalUrl('https://api.rentalgate.net/api/companies'),
    'https://api.rentalgate.net/api/companies'
  );
  assert.equal(
    validateAllowedRgExternalUrl('https://admin.rentalgate.net/api/company/cars'),
    'https://admin.rentalgate.net/api/company/cars'
  );

  assert.throws(() => validateAllowedRgExternalUrl('http://api.rentalgate.net/api/companies'), /FORBIDDEN_HOST/);
  assert.throws(() => validateAllowedRgExternalUrl('https://127.0.0.1/api/companies'), /FORBIDDEN_HOST/);
  assert.throws(() => validateAllowedRgExternalUrl('https://169.254.169.254/latest/meta-data'), /FORBIDDEN_HOST/);
  assert.throws(() => validateAllowedRgExternalUrl('https://evil.example.com/companies'), /FORBIDDEN_HOST/);
});

test('normalizeCompanyCarsList and mergeSyncedCompaniesWithCars normalize Spring & nested payloads', () => {
  const rawCompanies = [
    {
      companyId: 10,
      arabicName: 'شركة ذيب لتأجير السيارات',
      englishName: 'Theeb Rent a Car',
      phone: '920000572',
      email: 'care@theeb.sa',
      active: true,
      cities: [{ arabicName: 'الرياض' }, { arabicName: 'جدة' }],
      branches: [
        { arabicName: 'فرع مطار الملك خالد', city: { arabicName: 'الرياض' }, phone: '0112223344', workingHours: '24 ساعة' }
      ],
      serviceTypes: ['مطار', 'توصيل']
    }
  ];

  const rawCars = [
    {
      ccId: 501,
      company: { id: 10, arabicName: 'شركة ذيب لتأجير السيارات' },
      car: {
        carNameAr: 'تويوتا كامري',
        carNameEn: 'Toyota Camry',
        brand: { arabicName: 'تويوتا' },
        category: { arabicName: 'سيدان' },
        modelYear: 2025
      },
      dailyPrice: 215,
      transmission: 'أوتوماتيك',
      seats: 5,
      active: true,
      branches: [{ arabicName: 'فرع مطار الملك خالد' }]
    },
    // Duplicate ccId should deduplicate cleanly
    {
      ccId: 501,
      companyId: 10,
      carNameAr: 'تويوتا كامري',
      dailyPrice: 215
    },
    // Company discovered solely from /company-cars payload
    {
      ccId: 909,
      company: { id: 99, arabicName: 'الوفاق لتأجير السيارات', city: 'الدمام' },
      carNameAr: 'هيونداي أكسنت',
      brandNameAr: 'هيونداي',
      categoryNameAr: 'اقتصادية',
      year: 2024,
      dailyPrice: 120,
      seats: 5
    }
  ];

  const merged = mergeSyncedCompaniesWithCars(rawCompanies, rawCars);
  assert.equal(merged.length, 2);

  const theeb = merged.find((c) => c.sourceCompanyId === '10');
  assert.ok(theeb);
  assert.equal(theeb.carsCount, 1);
  assert.equal(theeb.cars[0].id, '501');
  assert.equal(theeb.cars[0].carName, 'تويوتا كامري');
  assert.equal(theeb.cars[0].brand, 'تويوتا');
  assert.equal(theeb.cars[0].dailyPrice, 215);
  assert.equal(theeb.branches.length, 1);
  assert.deepEqual(theeb.cities, ['الرياض', 'جدة']);

  const wefaq = merged.find((c) => c.sourceCompanyId === '99');
  assert.ok(wefaq);
  assert.equal(wefaq.carsCount, 1);
  assert.equal(wefaq.cars[0].carName, 'هيونداي أكسنت');

  // Direct list check
  const direct = normalizeCompanyCarsList(rawCars);
  assert.equal(direct.length, 2);
});

test('fetchRgCompaniesAndCars handles Spring pagination and endpoint fallback while rejecting HTML/invalid hosts', async () => {
  const { executor } = createSyncMockExecutor();
  const seenUrls: string[] = [];

  const mockFetch: typeof fetch = async (input) => {
    const url = String(input);
    seenUrls.push(url);
    if (url.includes('/api/companies?page=0')) {
      return jsonResponse({
        content: [{ id: 1, arabicName: 'بدجت السعودية' }],
        totalPages: 2,
        totalElements: 2,
        last: false
      });
    }
    if (url.includes('/api/companies?page=1')) {
      return jsonResponse({
        content: [{ id: 2, arabicName: 'المفتاح لتأجير السيارات' }],
        totalPages: 2,
        totalElements: 2,
        last: true
      });
    }
    if (url.includes('/api/company-cars')) {
      // Simulate first endpoint 404 -> falls back to /api/company/cars -> HTML -> admin
      return jsonResponse({ message: 'Not Found' }, 404);
    }
    if (url.startsWith('https://api.rentalgate.net/api/company/cars')) {
      return jsonResponse({
        content: [
          { ccId: 77, companyId: 1, carNameAr: 'كيا K5', brandNameAr: 'كيا', categoryNameAr: 'سيدان', dailyPrice: 190 }
        ],
        last: true
      });
    }
    if (url.startsWith('https://admin.rentalgate.net/api/company/cars')) {
      return jsonResponse('<!doctype html><html><body>SPA</body></html>', 200, 'text/html');
    }
    return jsonResponse({}, 404);
  };

  const res = await fetchRgCompaniesAndCars(executor, {
    rgToken: 'rg_valid_test_token_123456',
    fetchFn: mockFetch
  });

  assert.equal(res.companiesCount, 2);
  assert.equal(res.carsCount, 1);
  assert.ok(seenUrls.some((u) => u.includes('/api/companies?page=1')));
  assert.ok(res.endpointsUsed.companyCars.includes('/api/company/cars'));

  // Missing token fails cleanly
  await assert.rejects(
    () => fetchRgCompaniesAndCars(executor, { rgToken: '', fetchFn: mockFetch }),
    /NO_RG_TOKEN/
  );

  // Disallowed override fails closed
  await assert.rejects(
    () => fetchRgCompaniesAndCars(executor, {
      rgToken: 'rg_valid_test_token_123456',
      companiesUrl: 'https://evil.example.com/api/companies',
      fetchFn: mockFetch
    }),
    /FORBIDDEN_HOST/
  );

  // Auth 401/403 propagates structured auth error
  await assert.rejects(
    () => fetchRgCompaniesAndCars(executor, {
      rgToken: 'rg_valid_test_token_123456',
      fetchFn: async () => jsonResponse({ message: 'Forbidden' }, 403)
    }),
    /RG_API_FORBIDDEN_403/
  );
});

test('syncKbCompaniesFromApi enforces RBAC, upserts companies & branches idempotently, and preserves manual notes', async () => {
  const { executor, store } = createSyncMockExecutor({
    companies: [
      {
        id: 'KBCMP_MANUAL_1',
        source_company_id: '',
        name: 'شركة ذيب لتأجير السيارات',
        normalized_name: 'شركه ذيب لتاجير السيارات',
        logo_url: '',
        short_description: 'وصف يدوي',
        images_json: [],
        phone: '920000572',
        email: '',
        website: '',
        status: 'active',
        cities_json: ['الخبر'],
        service_types_json: ['تأجير يومي'],
        cars_json: [],
        cars_count: 0,
        internal_notes: 'ملاحظة مهمة لا يجب مسحها عند المزامنة',
        deleted_at: null
      }
    ]
  });

  const agentSession = makeSession('agent', ['view_knowledge_base']);
  await assert.rejects(
    () => syncKbCompaniesFromApi(executor, agentSession, {}, {
      fetchRgFn: async () => ({
        companiesCount: 0,
        carsCount: 0,
        rawCompanies: [],
        rawCars: [],
        endpointsUsed: { companies: '', companyCars: '' },
        warnings: []
      })
    }),
    /FORBIDDEN/
  );

  const supervisorSession = makeSession('supervisor', ['view_knowledge_base', 'kb_manage_companies']);
  const firstRun = await syncKbCompaniesFromApi(executor, supervisorSession, {}, {
    fetchRgFn: async () => ({
      companiesCount: 2,
      carsCount: 2,
      rawCompanies: [
        {
          id: 10,
          arabicName: 'شركة ذيب لتأجير السيارات',
          phone: '920000572',
          cities: ['الرياض'],
          branches: [{ arabicName: 'فرع العليا', city: 'الرياض', phone: '0115550000' }]
        },
        {
          id: 20,
          arabicName: 'شركة يلو لتأجير السيارات',
          phone: '920002909',
          cities: ['جدة'],
          branches: [{ arabicName: 'فرع مطار جدة', city: 'جدة' }]
        }
      ],
      rawCars: [
        { ccId: 'C1', companyId: 10, carNameAr: 'هيونداي إلنترا', brandNameAr: 'هيونداي', categoryNameAr: 'سيدان', dailyPrice: 145 },
        { ccId: 'C2', companyId: 20, carNameAr: 'نيسان صني', brandNameAr: 'نيسان', categoryNameAr: 'اقتصادية', dailyPrice: 110 }
      ],
      endpointsUsed: {
        companies: 'https://api.rentalgate.net/api/companies',
        companyCars: 'https://api.rentalgate.net/api/company-cars'
      },
      warnings: []
    })
  });

  assert.equal(firstRun.updatedCount, 1);
  assert.equal(firstRun.insertedCount, 1);
  assert.equal(firstRun.totalCompanies, 2);
  assert.equal(firstRun.totalCars, 2);
  assert.equal(firstRun.branchesSyncedCount, 2);
  assert.equal(store.companies.length, 2);
  assert.equal(store.branches.length, 2);
  assert.equal(store.revisions.length, 1);
  assert.equal(store.revisions[0].action_type, 'kb_companies_synced');

  const updatedTheeb = store.companies.find((c) => c.id === 'KBCMP_MANUAL_1');
  assert.ok(updatedTheeb);
  assert.equal(updatedTheeb.source_company_id, '10');
  assert.equal(updatedTheeb.internal_notes, 'ملاحظة مهمة لا يجب مسحها عند المزامنة');
  assert.ok(updatedTheeb.cities_json.includes('الخبر'));
  assert.ok(updatedTheeb.cities_json.includes('الرياض'));
  assert.equal(updatedTheeb.cars_count, 1);

  // Re-running same payload should update idempotently without duplicate companies or branches
  const secondRun = await syncKbCompaniesFromApi(executor, supervisorSession, {}, {
    fetchRgFn: async () => ({
      companiesCount: 2,
      carsCount: 2,
      rawCompanies: [
        {
          id: 10,
          arabicName: 'شركة ذيب لتأجير السيارات',
          phone: '920000572',
          cities: ['الرياض'],
          branches: [{ arabicName: 'فرع العليا', city: 'الرياض', phone: '0115550000' }]
        },
        {
          id: 20,
          arabicName: 'شركة يلو لتأجير السيارات',
          phone: '920002909',
          cities: ['جدة'],
          branches: [{ arabicName: 'فرع مطار جدة', city: 'جدة' }]
        }
      ],
      rawCars: [
        { ccId: 'C1', companyId: 10, carNameAr: 'هيونداي إلنترا', brandNameAr: 'هيونداي', categoryNameAr: 'سيدان', dailyPrice: 145 },
        { ccId: 'C2', companyId: 20, carNameAr: 'نيسان صني', brandNameAr: 'نيسان', categoryNameAr: 'اقتصادية', dailyPrice: 110 }
      ],
      endpointsUsed: {
        companies: 'https://api.rentalgate.net/api/companies',
        companyCars: 'https://api.rentalgate.net/api/company-cars'
      },
      warnings: []
    })
  });

  assert.equal(secondRun.insertedCount, 0);
  assert.equal(secondRun.updatedCount, 2);
  assert.equal(secondRun.branchesSyncedCount, 0);
  assert.equal(store.companies.length, 2);
  assert.equal(store.branches.length, 2);
});
