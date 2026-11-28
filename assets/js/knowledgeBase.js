/**
 * RENTAL GATE CRM — Knowledge Base Module (مركز المعرفة)
 * 9 Integrated Sections · Neon PostgreSQL Backed · RBAC · Live Smart Search · Variable Quick Replies
 */
(function (root) {
  'use strict';

  var KB_SECTIONS = [
    { id: 'overview', ar: 'نظرة عامة', en: 'Overview', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
    { id: 'companies', ar: 'شركات التأجير', en: 'Rental Companies', icon: 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9v.01M9 12v.01M9 15v.01M9 18v.01' },
    { id: 'branches', ar: 'الفروع والعناوين', en: 'Branches & Locations', icon: 'M12 21s-6-4.35-6-10a6 6 0 1 1 12 0c0 5.65-6 10-6 10zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z' },
    { id: 'rental_gate_policies', ar: 'سياسات بوابة التأجير', en: 'Rental Gate Policies', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z' },
    { id: 'company_policies', ar: 'سياسات شركات التأجير', en: 'Company Policies', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8' },
    { id: 'booking_pickup_terms', ar: 'شروط الحجز والاستلام', en: 'Booking & Pickup Terms', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' },
    { id: 'cancellation_refunds', ar: 'الإلغاء والاسترداد', en: 'Cancellation & Refunds', icon: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5' },
    { id: 'faq', ar: 'الأسئلة الشائعة', en: 'FAQ', icon: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
    { id: 'quick_replies', ar: 'الردود الجاهزة', en: 'Quick Replies', icon: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }
  ];

  var POLICY_CATEGORIES = [
    { id: 'rental_gate', section: 'rental_gate_policies', ar: 'سياسات بوابة التأجير', en: 'Rental Gate Policies' },
    { id: 'company_policy', section: 'company_policies', ar: 'سياسات شركات التأجير', en: 'Company Policies' },
    { id: 'booking_terms', section: 'booking_pickup_terms', ar: 'شروط الحجز', en: 'Booking Terms' },
    { id: 'pickup_return_terms', section: 'booking_pickup_terms', ar: 'شروط الاستلام والتسليم', en: 'Pickup & Return Terms' },
    { id: 'age_license_terms', section: 'booking_pickup_terms', ar: 'شروط العمر ورخصة القيادة', en: 'Age & Driver License Terms' },
    { id: 'mileage_policy', section: 'booking_pickup_terms', ar: 'سياسة الكيلومترات', en: 'Mileage Policy' },
    { id: 'delivery_pickup_policy', section: 'booking_pickup_terms', ar: 'سياسة التوصيل والاستلام', en: 'Delivery & Pickup Policy' },
    { id: 'delay_extension_policy', section: 'booking_pickup_terms', ar: 'سياسة التأخير والتمديد', en: 'Delay & Extension Policy' },
    { id: 'cancellation_policy', section: 'cancellation_refunds', ar: 'سياسة الإلغاء', en: 'Cancellation Policy' },
    { id: 'refund_policy', section: 'cancellation_refunds', ar: 'سياسة الاسترداد', en: 'Refund Policy' },
    { id: 'wallet_points_policy', section: 'cancellation_refunds', ar: 'سياسة المحفظة والنقاط', en: 'Wallet & Points Policy' }
  ];

  var FAQ_CATEGORIES = [
    { id: 'general', ar: 'عام', en: 'General' },
    { id: 'booking', ar: 'الحجوزات', en: 'Bookings' },
    { id: 'pickup_return', ar: 'الاستلام والتسليم', en: 'Pickup & Return' },
    { id: 'documents_age', ar: 'المستندات والعمر والرخصة', en: 'Documents, Age & License' },
    { id: 'payments_refunds', ar: 'الدفع والإلغاء والاسترداد', en: 'Payments & Refunds' },
    { id: 'mileage_delivery', ar: 'الكيلومترات والتوصيل', en: 'Mileage & Delivery' },
    { id: 'wallet_points', ar: 'المحفظة والنقاط', en: 'Wallet & Points' },
    { id: 'company_specific', ar: 'سياسات شركات التأجير', en: 'Rental Companies' },
    { id: 'complaints', ar: 'الشكاوى والدعم', en: 'Complaints & Support' }
  ];

  var QUICK_REPLY_CATEGORIES = [
    { id: 'greeting', ar: 'الترحيب وإنهاء المحادثة', en: 'Greeting & Closing' },
    { id: 'bookings', ar: 'الحجوزات', en: 'Bookings' },
    { id: 'payments_invoices', ar: 'الدفع والفواتير', en: 'Payments & Invoices' },
    { id: 'delivery_pickup', ar: 'التوصيل والاستلام', en: 'Delivery & Pickup' },
    { id: 'extensions_delays', ar: 'التمديد والتأخير', en: 'Extensions & Delays' },
    { id: 'cancellation_refunds', ar: 'الإلغاء والاسترداد', en: 'Cancellation & Refunds' },
    { id: 'wallet_points', ar: 'المحفظة والنقاط', en: 'Wallet & Points' },
    { id: 'complaints_issues', ar: 'الشكاوى والمشكلات', en: 'Complaints & Issues' },
    { id: 'coverage_cities', ar: 'التغطية والمدن', en: 'Coverage & Cities' },
    { id: 'rental_companies', ar: 'شركات التأجير', en: 'Rental Companies' }
  ];

  var DYNAMIC_VARS = [
    { key: 'customer_name', token: '{customer_name}', ar: 'اسم العميل', en: 'Customer Name' },
    { key: 'booking_number', token: '{booking_number}', ar: 'رقم الحجز', en: 'Booking Number' },
    { key: 'company_name', token: '{company_name}', ar: 'اسم الشركة', en: 'Company Name' },
    { key: 'branch_name', token: '{branch_name}', ar: 'اسم الفرع', en: 'Branch Name' },
    { key: 'pickup_date', token: '{pickup_date}', ar: 'تاريخ الاستلام', en: 'Pickup Date' }
  ];

  var kbState = {
    tab: 'overview',
    searchQuery: '',
    searchContentType: 'all',
    searchCompanyId: '',
    searchCity: '',
    searchCategory: '',
    searchResults: null,
    searchLoading: false,
    dashboard: null,
    companies: { items: [], cities: [], search: '', city: '', status: '', page: 1, pagination: { page: 1, totalPages: 1, total: 0 } },
    branches: { items: [], cities: [], search: '', companyId: '', city: '', status: '', page: 1, pagination: { page: 1, totalPages: 1, total: 0 } },
    policies: { items: [], search: '', category: 'all', companyId: '', city: '', publishStatus: 'all', page: 1, pagination: { page: 1, totalPages: 1, total: 0 } },
    faqs: { items: [], mostSearchedHighlights: [], search: '', category: 'all', companyId: '', publishStatus: 'all', sortBy: 'updated', page: 1, pagination: { page: 1, totalPages: 1, total: 0 } },
    quickReplies: { items: [], mostUsed: [], search: '', category: 'all', language: 'all', companyId: '', status: 'all', sortBy: 'most_used', page: 1, pagination: { page: 1, totalPages: 1, total: 0 } },
    selectedCompanyId: '',
    selectedCompanyDetail: null,
    companyBranchCityFilter: '',
    companyBranchSearch: '',
    expandedPolicyIds: {},
    expandedFaqIds: {},
    quickVarValues: {
      customer_name: '',
      booking_number: '',
      company_name: '',
      branch_name: '',
      pickup_date: ''
    },
    highlightEntityId: '',
    loading: false
  };

  var searchTimer = null;
  var deltaBound = false;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function isEn(ctx) {
    var lang = (ctx && ctx.lang) || (root.RGApp && root.RGApp.getLang && root.RGApp.getLang()) || 'ar';
    return lang === 'en';
  }

  function lbl(item, ctx) {
    if (!item) return '';
    return isEn(ctx) ? (item.en || item.ar || '') : (item.ar || item.en || '');
  }

  function canPerm(ctx, permKey) {
    var u = (ctx && ctx.user) || (root.RGAuth && root.RGAuth.getUser ? root.RGAuth.getUser() : null);
    if (!u) return false;
    if (String(u.role || '').toLowerCase() === 'developer') return true;
    if (root.RGCrmCore && typeof root.RGCrmCore.canUserPerform === 'function') {
      return Boolean(root.RGCrmCore.canUserPerform(u, permKey));
    }
    return String(u.role || '').toLowerCase() === 'general_manager';
  }

  function sanitizeClientUrl(raw, allowImg) {
    var v = String(raw == null ? '' : raw).trim();
    if (!v) return '';
    var compact = v.replace(/[\u0000-\u0020]+/g, '').toLowerCase();
    if (compact.indexOf('javascript:') === 0 || compact.indexOf('vbscript:') === 0 || compact.indexOf('data:text/') === 0) return '';
    if (allowImg && /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=]+$/i.test(compact)) return v;
    if (compact.indexOf('https://') === 0 || compact.indexOf('http://') === 0 || compact.indexOf('mailto:') === 0 || compact.indexOf('tel:') === 0 || v.indexOf('/') === 0 || v.indexOf('./') === 0) return v;
    if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(v)) return 'https://' + v;
    return '';
  }

  function sanitizeDisplayHtml(rawHtml) {
    var s = String(rawHtml == null ? '' : rawHtml).trim();
    if (!s) return '';
    s = s.replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\s*(script|style|iframe|object|embed|svg|math|noscript|template)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*(script|style|iframe|object|embed|svg|math|meta|link|base|form|input|button|textarea)\b[^>]*\/?>/gi, '');
    if (!/<[a-z][\s\S]*>/i.test(s)) {
      return '<p>' + esc(s).replace(/\n/g, '<br />') + '</p>';
    }
    var allowed = { p: 1, br: 1, b: 1, strong: 1, i: 1, em: 1, u: 1, s: 1, del: 1, h3: 1, h4: 1, h5: 1, ul: 1, ol: 1, li: 1, blockquote: 1, code: 1, pre: 1, hr: 1, a: 1, span: 1, div: 1, img: 1 };
    return s.replace(/<\s*(\/?)\s*([a-zA-Z0-9]+)([^>]*)>/g, function (_m, slash, rawTag, rawAttrs) {
      var tag = String(rawTag || '').toLowerCase();
      if (!allowed[tag]) return '';
      if (slash) return (tag === 'br' || tag === 'hr' || tag === 'img') ? '' : '</' + tag + '>';
      var attrsStr = String(rawAttrs || '');
      var parts = [];
      if (tag === 'a') {
        var hm = attrsStr.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        var href = sanitizeClientUrl((hm && (hm[1] || hm[2] || hm[3])) || '', false);
        if (href) {
          parts.push('href="' + esc(href) + '"');
          if (href.indexOf('http://') === 0 || href.indexOf('https://') === 0) {
            parts.push('target="_blank" rel="noopener noreferrer"');
          }
        }
      } else if (tag === 'img') {
        var sm = attrsStr.match(/src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
        var src = sanitizeClientUrl((sm && (sm[1] || sm[2] || sm[3])) || '', true);
        if (!src) return '';
        parts.push('src="' + esc(src) + '" loading="lazy"');
        return '<img ' + parts.join(' ') + ' />';
      }
      if (tag === 'br' || tag === 'hr') return '<' + tag + ' />';
      return parts.length ? '<' + tag + ' ' + parts.join(' ') + '>' : '<' + tag + '>';
    });
  }

  function renderIcon(pathData, size) {
    var sz = size || 16;
    return '<svg width="' + sz + '" height="' + sz + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + pathData + '"/></svg>';
  }

  function fmtDate(val, ctx) {
    if (!val) return '-';
    if (ctx && ctx.formatDateTime) return ctx.formatDateTime(val);
    if (root.RGApp && root.RGApp.formatDateTime) return root.RGApp.formatDateTime(val);
    return String(val).replace('T', ' ').slice(0, 16);
  }

  function toast(ctx, msg, type) {
    if (ctx && typeof ctx.toast === 'function') ctx.toast(msg, type || 'info');
    else if (root.RGApp && typeof root.RGApp.toast === 'function') root.RGApp.toast(msg, type || 'info');
  }

  function openModal(opts) {
    if (root.RGApp && typeof root.RGApp.openModal === 'function') {
      return root.RGApp.openModal(opts);
    }
    var modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return { close: function () {} };
    modalRoot.innerHTML =
      '<div class="modal-backdrop" id="kb-fallback-backdrop">' +
        '<div class="modal-dialog ' + (opts.size || 'lg') + '" role="dialog" aria-modal="true">' +
          '<div class="modal-header">' +
            '<h3 class="modal-title">' + esc(opts.title || '') + '</h3>' +
            '<button type="button" class="icon-btn" id="kb-modal-close" aria-label="Close">×</button>' +
          '</div>' +
          '<div class="modal-body" id="kb-modal-body"></div>' +
          (opts.footerHtml ? '<div class="modal-footer">' + opts.footerHtml + '</div>' : '') +
        '</div>' +
      '</div>';
    var body = document.getElementById('kb-modal-body');
    if (body) body.innerHTML = opts.bodyHtml || '';
    var closeFn = function () { modalRoot.innerHTML = ''; };
    var clsBtn = document.getElementById('kb-modal-close');
    var bd = document.getElementById('kb-fallback-backdrop');
    if (clsBtn) clsBtn.addEventListener('click', closeFn);
    if (bd) bd.addEventListener('click', function (e) { if (e.target === bd) closeFn(); });
    return { close: closeFn, body: body, dialog: modalRoot.querySelector('.modal-dialog') };
  }

  async function callApi(action, payload) {
    var token = root.RGAuth && root.RGAuth.getToken ? root.RGAuth.getToken() : '';
    var res = await root.RGApi.call(action, token, payload || {});
    if (!res || !res.success) {
      throw new Error((res && res.message) || 'تعذر تنفيذ الطلب.');
    }
    return res.data;
  }

  async function copyToClipboard(text, ctx, successMsg) {
    var clean = String(text == null ? '' : text);
    if (!clean) return false;
    var ok = false;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(clean);
        ok = true;
      }
    } catch (_eClip) {}
    if (!ok) {
      try {
        var ta = document.createElement('textarea');
        ta.value = clean;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch (_eFb) {}
    }
    if (ok) {
      toast(ctx, successMsg || (isEn(ctx) ? 'Copied to clipboard' : 'تم النسخ إلى الحافظة'), 'success');
    } else {
      toast(ctx, isEn(ctx) ? 'Copy failed — please copy manually' : 'تعذر النسخ التلقائي — يرجى النسخ يدوياً', 'warning');
    }
    return ok;
  }

  function substituteQuickVariables(template, vars) {
    var v = vars || {};
    return String(template == null ? '' : template).replace(/\{([a-zA-Z0-9_]+)\}/g, function (full, k) {
      var val = v[k];
      return (val !== undefined && val !== null && String(val).trim()) ? String(val).trim() : full;
    });
  }

  function extractTemplateVariables(template) {
    var matches = String(template == null ? '' : template).match(/\{([a-zA-Z0-9_]+)\}/g) || [];
    var seen = {};
    var out = [];
    matches.forEach(function (m) {
      var k = m.slice(1, -1).trim();
      if (k && !seen[k]) {
        seen[k] = true;
        out.push(k);
      }
    });
    return out;
  }

  function getCategoryLabel(list, id, ctx) {
    var found = list.find(function (x) { return x.id === id; });
    return found ? lbl(found, ctx) : (id || '-');
  }

  function getSectionLabel(id, ctx) {
    var found = KB_SECTIONS.find(function (s) { return s.id === id; });
    return found ? lbl(found, ctx) : (id || '');
  }

  function isPolicySection(tabId) {
    return (
      tabId === 'rental_gate_policies' ||
      tabId === 'company_policies' ||
      tabId === 'booking_pickup_terms' ||
      tabId === 'cancellation_refunds'
    );
  }

  function statusBadgeHtml(st, ctx) {
    var s = String(st || 'active');
    var en = isEn(ctx);
    if (s === 'active' || s === 'published') {
      return '<span class="rg-kb-badge is-success">' + (s === 'published' ? (en ? 'Published' : 'منشور') : (en ? 'Active' : 'نشطة')) + '</span>';
    }
    if (s === 'draft') {
      return '<span class="rg-kb-badge is-warning">' + (en ? 'Draft' : 'مسودة') + '</span>';
    }
    if (s === 'archived') {
      return '<span class="rg-kb-badge is-neutral">' + (en ? 'Archived' : 'مؤرشف') + '</span>';
    }
    return '<span class="rg-kb-badge is-danger">' + (en ? 'Inactive' : 'غير نشطة') + '</span>';
  }

  function entityBadgeHtml(entityType, ctx) {
    var en = isEn(ctx);
    var map = {
      company: { ar: 'شركة تأجير', en: 'Company', cls: 'is-info' },
      branch: { ar: 'فرع وموقع', en: 'Branch', cls: 'is-success' },
      policy: { ar: 'سياسة / شرط', en: 'Policy', cls: 'is-brand' },
      faq: { ar: 'سؤال شائع', en: 'FAQ', cls: 'is-warning' },
      quick_reply: { ar: 'رد جاهز', en: 'Quick Reply', cls: 'is-neutral' }
    };
    var cfg = map[entityType] || { ar: entityType, en: entityType, cls: 'is-neutral' };
    return '<span class="rg-kb-badge ' + cfg.cls + '">' + esc(en ? cfg.en : cfg.ar) + '</span>';
  }

  function getCompaniesListForFilter() {
    var dashList = (kbState.dashboard && Array.isArray(kbState.dashboard.companiesSummary)) ? kbState.dashboard.companiesSummary : [];
    var fullList = (kbState.companies && Array.isArray(kbState.companies.items)) ? kbState.companies.items : [];
    var seen = {};
    var out = [];
    dashList.concat(fullList).forEach(function (c) {
      if (!c || !c.id || seen[c.id]) return;
      seen[c.id] = true;
      out.push({ id: c.id, name: c.name });
    });
    return out;
  }

  function getCitiesListForFilter() {
    var c1 = (kbState.dashboard && Array.isArray(kbState.dashboard.coveredCities)) ? kbState.dashboard.coveredCities : [];
    var c2 = (kbState.companies && Array.isArray(kbState.companies.cities)) ? kbState.companies.cities : [];
    var c3 = (kbState.branches && Array.isArray(kbState.branches.cities)) ? kbState.branches.cities : [];
    var seen = {};
    var out = [];
    c1.concat(c2).concat(c3).forEach(function (city) {
      var s = String(city || '').trim();
      if (!s || seen[s]) return;
      seen[s] = true;
      out.push(s);
    });
    return out.sort(function (a, b) { return a.localeCompare(b, 'ar'); });
  }

  async function loadTabData(forceRefresh) {
    if (forceRefresh && root.RGApi && root.RGApi.markScopesStale) {
      root.RGApi.markScopesStale(['knowledgeBase']);
    }
    kbState.dashboard = await callApi('getKnowledgeBaseDashboard', {});

    if (kbState.tab === 'companies') {
      if (kbState.selectedCompanyId) {
        var det = await callApi('getKbCompanies', { companyId: kbState.selectedCompanyId });
        kbState.selectedCompanyDetail = det && det.company ? Object.assign({}, det.company, { branches: det.branches || [] }) : null;
      } else {
        var compRes = await callApi('getKbCompanies', {
          search: kbState.companies.search,
          city: kbState.companies.city,
          status: kbState.companies.status,
          page: kbState.companies.page,
          pageSize: 24
        });
        kbState.companies.items = compRes.items || [];
        kbState.companies.cities = compRes.cities || [];
        kbState.companies.pagination = compRes.pagination || { page: 1, totalPages: 1, total: 0 };
      }
    } else if (kbState.tab === 'branches') {
      var brRes = await callApi('getKbBranches', {
        search: kbState.branches.search,
        companyId: kbState.branches.companyId,
        city: kbState.branches.city,
        status: kbState.branches.status,
        page: kbState.branches.page,
        pageSize: 30
      });
      kbState.branches.items = brRes.items || [];
      kbState.branches.cities = brRes.cities || [];
      kbState.branches.pagination = brRes.pagination || { page: 1, totalPages: 1, total: 0 };
    } else if (isPolicySection(kbState.tab)) {
      var polRes = await callApi('getKbPolicies', {
        sectionKey: kbState.tab,
        category: kbState.policies.category,
        companyId: kbState.policies.companyId,
        city: kbState.policies.city,
        publishStatus: kbState.policies.publishStatus,
        search: kbState.policies.search,
        page: kbState.policies.page,
        pageSize: 20
      });
      kbState.policies.items = polRes.items || [];
      kbState.policies.pagination = polRes.pagination || { page: 1, totalPages: 1, total: 0 };
    } else if (kbState.tab === 'faq') {
      var faqRes = await callApi('getKbFaqs', {
        category: kbState.faqs.category,
        companyId: kbState.faqs.companyId,
        publishStatus: kbState.faqs.publishStatus,
        sortBy: kbState.faqs.sortBy,
        search: kbState.faqs.search,
        page: kbState.faqs.page,
        pageSize: 24
      });
      kbState.faqs.items = faqRes.items || [];
      kbState.faqs.mostSearchedHighlights = faqRes.mostSearchedHighlights || [];
      kbState.faqs.pagination = faqRes.pagination || { page: 1, totalPages: 1, total: 0 };
    } else if (kbState.tab === 'quick_replies') {
      var qrRes = await callApi('getKbQuickReplies', {
        category: kbState.quickReplies.category,
        language: kbState.quickReplies.language,
        companyId: kbState.quickReplies.companyId,
        status: kbState.quickReplies.status,
        sortBy: kbState.quickReplies.sortBy,
        search: kbState.quickReplies.search,
        page: kbState.quickReplies.page,
        pageSize: 24
      });
      kbState.quickReplies.items = qrRes.items || [];
      kbState.quickReplies.mostUsed = qrRes.mostUsed || [];
      kbState.quickReplies.pagination = qrRes.pagination || { page: 1, totalPages: 1, total: 0 };
    }
  }

  function renderHeaderAndSearchHtml(ctx) {
    var en = isEn(ctx);
    var companies = getCompaniesListForFilter();
    var cities = getCitiesListForFilter();
    var canManageAny =
      canPerm(ctx, 'kb_manage_companies') ||
      canPerm(ctx, 'kb_manage_policies') ||
      canPerm(ctx, 'kb_manage_faqs') ||
      canPerm(ctx, 'kb_manage_quick_replies');

    var tabButtonsHtml = KB_SECTIONS.map(function (sec) {
      var active = kbState.tab === sec.id;
      return (
        '<button type="button" class="rg-kb-tab' + (active ? ' is-active' : '') + '" data-kb-tab="' + esc(sec.id) + '" role="tab" aria-selected="' + (active ? 'true' : 'false') + '">' +
          renderIcon(sec.icon, 15) +
          '<span>' + esc(lbl(sec, ctx)) + '</span>' +
        '</button>'
      );
    }).join('');

    return (
      '<section class="rg-kb-shell" data-testid="kb-root">' +
        '<header class="rg-kb-hero surface-card">' +
          '<div class="rg-kb-hero-top">' +
            '<div class="rg-kb-hero-title-wrap">' +
              '<div class="rg-kb-hero-icon">' + renderIcon('M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z', 22) + '</div>' +
              '<div>' +
                '<h2 class="rg-kb-title">' + (en ? 'Knowledge Base | مركز المعرفة' : 'مركز المعرفة | Knowledge Base') + '</h2>' +
                '<p class="rg-kb-subtitle">' + (en
                  ? 'Central operations reference for rental companies, branches, policies, FAQs & dynamic quick replies'
                  : 'المرجع التشغيلي الموحد لخدمة العملاء: شركات التأجير، الفروع، السياسات، الأسئلة الشائعة والردود الجاهزة') + '</p>' +
              '</div>' +
            '</div>' +
            '<div class="rg-kb-hero-actions">' +
              '<button type="button" class="btn btn-sm btn-ghost" data-kb-action="audit-history">' +
                renderIcon('M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 15) +
                '<span>' + (en ? 'Audit Log' : 'سجل التعديلات') + '</span>' +
              '</button>' +
              '<button type="button" class="btn btn-sm btn-ghost" data-kb-action="export-backup">' +
                renderIcon('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', 15) +
                '<span>' + (en ? 'Backup JSON' : 'نسخة احتياطية') + '</span>' +
              '</button>' +
              (canManageAny
                ? '<button type="button" class="btn btn-sm btn-primary" data-kb-action="quick-create">' +
                    renderIcon('M12 5v14M5 12h14', 15) +
                    '<span>' + (en ? 'Add Content' : 'إضافة محتوى') + '</span>' +
                  '</button>'
                : '') +
            '</div>' +
          '</div>' +
          '<div class="rg-kb-smart-search-bar">' +
            '<div class="rg-kb-search-input-wrap">' +
              '<span class="rg-kb-search-icon">' + renderIcon('M21 21l-4.35-4.35M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 17) + '</span>' +
              '<input type="search" id="kb-global-search-input" class="input rg-kb-search-input" value="' + esc(kbState.searchQuery) + '" placeholder="' + esc(en
                ? 'Live search companies, cities, branches, policies, FAQs, or quick replies...'
                : 'بحث ذكي فوري: ابحث باسم شركة، مدينة، فرع، سياسة، سؤال شائع، أو رد جاهز...') + '" autocomplete="off" />' +
              (kbState.searchQuery
                ? '<button type="button" class="rg-kb-clear-btn" data-kb-action="clear-global-search" title="' + (en ? 'Clear' : 'مسح') + '">×</button>'
                : '') +
            '</div>' +
            '<div class="rg-kb-search-filters">' +
              '<select id="kb-global-type" class="input rg-kb-filter-select" aria-label="Content Type">' +
                '<option value="all"' + (kbState.searchContentType === 'all' ? ' selected' : '') + '>' + (en ? 'All Types' : 'كل المحتوى') + '</option>' +
                '<option value="company"' + (kbState.searchContentType === 'company' ? ' selected' : '') + '>' + (en ? 'Companies' : 'شركات التأجير') + '</option>' +
                '<option value="branch"' + (kbState.searchContentType === 'branch' ? ' selected' : '') + '>' + (en ? 'Branches' : 'الفروع') + '</option>' +
                '<option value="policy"' + (kbState.searchContentType === 'policy' ? ' selected' : '') + '>' + (en ? 'Policies' : 'السياسات') + '</option>' +
                '<option value="faq"' + (kbState.searchContentType === 'faq' ? ' selected' : '') + '>' + (en ? 'FAQs' : 'الأسئلة الشائعة') + '</option>' +
                '<option value="quick_reply"' + (kbState.searchContentType === 'quick_reply' ? ' selected' : '') + '>' + (en ? 'Quick Replies' : 'الردود الجاهزة') + '</option>' +
              '</select>' +
              '<select id="kb-global-company" class="input rg-kb-filter-select" aria-label="Company">' +
                '<option value="">' + (en ? 'All Companies' : 'كل الشركات') + '</option>' +
                companies.map(function (c) {
                  return '<option value="' + esc(c.id) + '"' + (kbState.searchCompanyId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
                }).join('') +
              '</select>' +
              '<select id="kb-global-city" class="input rg-kb-filter-select" aria-label="City">' +
                '<option value="">' + (en ? 'All Cities' : 'كل المدن') + '</option>' +
                cities.map(function (ct) {
                  return '<option value="' + esc(ct) + '"' + (kbState.searchCity === ct ? ' selected' : '') + '>' + esc(ct) + '</option>';
                }).join('') +
              '</select>' +
            '</div>' +
          '</div>' +
          renderLiveSearchResultsHtml(ctx) +
        '</header>' +
        '<nav class="rg-kb-tabs" role="tablist" aria-label="Knowledge Base Sections">' + tabButtonsHtml + '</nav>' +
        '<div id="kb-tab-panel" class="rg-kb-panel"></div>' +
      '</section>'
    );
  }

  function renderLiveSearchResultsHtml(ctx) {
    var en = isEn(ctx);
    var hasFilter = Boolean(kbState.searchQuery || kbState.searchCompanyId || kbState.searchCity || (kbState.searchContentType && kbState.searchContentType !== 'all'));
    if (!hasFilter || !kbState.searchResults) return '';
    var items = kbState.searchResults.items || [];
    return (
      '<div class="rg-kb-search-results" data-testid="kb-live-search-results">' +
        '<div class="rg-kb-search-results-head">' +
          '<span>' + (en ? 'Live Search Results' : 'نتائج البحث الفوري') + ' (' + esc(kbState.searchResults.totalMatches || items.length) + ')</span>' +
          '<button type="button" class="btn btn-xs btn-ghost" data-kb-action="clear-global-search">' + (en ? 'Close' : 'إغلاق النتائج') + '</button>' +
        '</div>' +
        (items.length === 0
          ? '<div class="empty-state" style="padding:18px;">' + (en ? 'No matching knowledge base items found.' : 'لا توجد نتائج مطابقة للبحث الحالي.') + '</div>'
          : '<div class="rg-kb-search-results-list">' +
              items.slice(0, 12).map(function (r) {
                return (
                  '<button type="button" class="rg-kb-search-hit" data-kb-jump-type="' + esc(r.entityType) + '" data-kb-jump-section="' + esc(r.sectionKey) + '" data-kb-jump-id="' + esc(r.id) + '" data-kb-jump-company="' + esc(r.companyId) + '">' +
                    '<div class="rg-kb-search-hit-top">' +
                      entityBadgeHtml(r.entityType, ctx) +
                      '<strong>' + esc(r.title) + '</strong>' +
                      (r.city ? '<span class="rg-kb-meta-chip">' + esc(r.city) + '</span>' : '') +
                    '</div>' +
                    (r.subtitle ? '<div class="rg-kb-search-hit-sub">' + esc(r.subtitle) + '</div>' : '') +
                    (r.snippet ? '<div class="rg-kb-search-hit-snip">' + esc(r.snippet) + '</div>' : '') +
                  '</button>'
                );
              }).join('') +
            '</div>') +
      '</div>'
    );
  }

  function renderOverviewHtml(ctx) {
    var en = isEn(ctx);
    var d = kbState.dashboard || { kpis: {}, latestAdded: [], latestUpdated: [], mostUsed: [], mostSearched: [], coveredCities: [] };
    var k = d.kpis || {};
    var kpiCards = [
      { label: en ? 'Rental Companies' : 'شركات التأجير', val: k.totalCompanies || 0, sub: (en ? 'Active: ' : 'النشطة: ') + (k.activeCompanies || 0), tab: 'companies', accent: 'crimson' },
      { label: en ? 'Total Branches' : 'إجمالي الفروع', val: k.totalBranches || 0, sub: en ? 'Across cities' : 'على مستوى المدن', tab: 'branches', accent: 'ink' },
      { label: en ? 'Covered Cities' : 'المدن المغطاة', val: k.coveredCitiesCount || 0, sub: (d.coveredCities || []).slice(0, 3).join('، ') || (en ? 'None yet' : 'لم تضاف مدن بعد'), tab: 'companies', accent: 'emerald' },
      { label: en ? 'Policies & Terms' : 'السياسات والشروط', val: k.totalPolicies || 0, sub: (en ? 'Published: ' : 'المنشورة: ') + (k.publishedPolicies || 0), tab: 'rental_gate_policies', accent: 'amber' },
      { label: en ? 'FAQs' : 'الأسئلة الشائعة', val: k.totalFaqs || 0, sub: (en ? 'Published: ' : 'المنشورة: ') + (k.publishedFaqs || 0), tab: 'faq', accent: 'blue' },
      { label: en ? 'Quick Replies' : 'الردود الجاهزة', val: k.totalQuickReplies || 0, sub: (en ? 'Active: ' : 'المفعلة: ') + (k.activeQuickReplies || 0), tab: 'quick_replies', accent: 'violet' }
    ];

    function renderFeedCard(title, items, emptyTxt, mode) {
      return (
        '<div class="surface-card rg-kb-feed-card">' +
          '<div class="rg-kb-card-head"><h4>' + esc(title) + '</h4></div>' +
          (!items || !items.length
            ? '<div class="empty-state" style="padding:20px 10px;">' + esc(emptyTxt) + '</div>'
            : '<div class="rg-kb-feed-list">' +
                items.map(function (it) {
                  var rightMeta = mode === 'usage'
                    ? '<span class="rg-kb-badge is-neutral">' + esc(it.usageCount || 0) + ' ' + (en ? 'uses' : 'استخدام') + '</span>'
                    : (mode === 'search'
                        ? '<span class="rg-kb-badge is-info">' + esc(it.searchHitCount || it.usageCount || 0) + ' ' + (en ? 'hits' : 'بحث') + '</span>'
                        : '<span class="rg-kb-muted-txt">' + esc(fmtDate(it.at, ctx)) + '</span>');
                  return (
                    '<button type="button" class="rg-kb-feed-row" data-kb-jump-type="' + esc(it.entityType) + '" data-kb-jump-section="' + esc(it.sectionKey) + '" data-kb-jump-id="' + esc(it.id) + '">' +
                      '<div class="rg-kb-feed-row-main">' +
                        entityBadgeHtml(it.entityType, ctx) +
                        '<span class="rg-kb-feed-title">' + esc(it.title) + '</span>' +
                      '</div>' +
                      '<div class="rg-kb-feed-row-meta">' + rightMeta + '</div>' +
                    '</button>'
                  );
                }).join('') +
              '</div>') +
        '</div>'
      );
    }

    var quickAccess = KB_SECTIONS.filter(function (s) { return s.id !== 'overview'; }).map(function (s) {
      return (
        '<button type="button" class="rg-kb-quick-tile" data-kb-tab="' + esc(s.id) + '">' +
          '<span class="rg-kb-quick-tile-icon">' + renderIcon(s.icon, 18) + '</span>' +
          '<span class="rg-kb-quick-tile-label">' + esc(lbl(s, ctx)) + '</span>' +
        '</button>'
      );
    }).join('');

    return (
      '<div class="rg-kb-overview">' +
        '<div class="rg-kb-kpi-grid">' +
          kpiCards.map(function (card) {
            return (
              '<button type="button" class="surface-card rg-kb-kpi-card is-' + card.accent + '" data-kb-tab="' + esc(card.tab) + '">' +
                '<div class="rg-kb-kpi-label">' + esc(card.label) + '</div>' +
                '<div class="rg-kb-kpi-val">' + esc(card.val) + '</div>' +
                '<div class="rg-kb-kpi-sub">' + esc(card.sub) + '</div>' +
              '</button>'
            );
          }).join('') +
        '</div>' +
        '<div class="surface-card rg-kb-quick-panel">' +
          '<div class="rg-kb-card-head">' +
            '<h4>' + (en ? 'Quick Section Access' : 'الوصول السريع للأقسام') + '</h4>' +
            '<span class="rg-kb-muted-txt">' + (en ? 'Jump directly to any Knowledge Base module' : 'انتقل فوراً لأي قسم من أقسام مركز المعرفة') + '</span>' +
          '</div>' +
          '<div class="rg-kb-quick-grid">' + quickAccess + '</div>' +
        '</div>' +
        '<div class="rg-kb-feeds-grid">' +
          renderFeedCard(en ? 'Latest Added Items' : 'أحدث الإضافات', d.latestAdded, en ? 'No content added yet.' : 'لا توجد إضافات مسجلة بعد.', 'time') +
          renderFeedCard(en ? 'Latest Updates' : 'أحدث التعديلات', d.latestUpdated, en ? 'No updates recorded yet.' : 'لا توجد تعديلات مسجلة بعد.', 'time') +
          renderFeedCard(en ? 'Most Used Content' : 'الأكثر استخداماً', d.mostUsed, en ? 'Usage statistics will appear once copies/views begin.' : 'تظهر الإحصائية عند استخدام ونسخ الردود والسياسات.', 'usage') +
          renderFeedCard(en ? 'Most Searched Topics' : 'الأكثر بحثاً', d.mostSearched, en ? 'Search trends appear as agents browse results.' : 'تظهر العناصر الأكثر بحثاً عند استعراض النتائج.', 'search') +
        '</div>' +
      '</div>'
    );
  }

  function renderCompaniesHtml(ctx) {
    var en = isEn(ctx);
    if (kbState.selectedCompanyId && kbState.selectedCompanyDetail) {
      return renderCompanyDetailsHtml(kbState.selectedCompanyDetail, ctx);
    }

    var canEdit = canPerm(ctx, 'kb_manage_companies');
    var canDel = canPerm(ctx, 'kb_delete_content');
    var items = kbState.companies.items || [];
    var cities = getCitiesListForFilter();
    var pg = kbState.companies.pagination || { page: 1, totalPages: 1, total: 0 };

    var toolbar =
      '<div class="surface-card rg-kb-toolbar">' +
        '<div class="rg-kb-toolbar-inputs">' +
          '<input type="search" id="kb-comp-search" class="input" value="' + esc(kbState.companies.search) + '" placeholder="' + (en ? 'Search company name or city...' : 'بحث باسم الشركة أو المدينة أو الخدمة...') + '" />' +
          '<select id="kb-comp-city" class="input">' +
            '<option value="">' + (en ? 'All Cities' : 'كل المدن') + '</option>' +
            cities.map(function (ct) { return '<option value="' + esc(ct) + '"' + (kbState.companies.city === ct ? ' selected' : '') + '>' + esc(ct) + '</option>'; }).join('') +
          '</select>' +
          '<select id="kb-comp-status" class="input">' +
            '<option value="">' + (en ? 'All Statuses' : 'جميع الحالات') + '</option>' +
            '<option value="active"' + (kbState.companies.status === 'active' ? ' selected' : '') + '>' + (en ? 'Active' : 'نشطة') + '</option>' +
            '<option value="inactive"' + (kbState.companies.status === 'inactive' ? ' selected' : '') + '>' + (en ? 'Inactive' : 'غير نشطة') + '</option>' +
          '</select>' +
        '</div>' +
        '<div class="rg-kb-toolbar-actions">' +
          (canEdit
            ? '<button type="button" class="btn btn-sm btn-primary" data-kb-action="add-company">' +
                renderIcon('M12 5v14M5 12h14', 15) + '<span>' + (en ? 'Add Company' : 'إضافة شركة تأجير') + '</span></button>'
            : '') +
        '</div>' +
      '</div>';

    var grid = !items.length
      ? '<div class="surface-card"><div class="empty-state" style="padding:36px 18px;">' + (en ? 'No rental companies added yet.' : 'لا توجد شركات تأجير مضافة في مركز المعرفة بعد.') + '</div></div>'
      : '<div class="rg-kb-company-grid">' +
          items.map(function (c) {
            var initials = String(c.name || '?').trim().slice(0, 2);
            var visibleCities = (c.cities || []).slice(0, 5);
            var extraCount = Math.max(0, (c.cities || []).length - visibleCities.length);
            var citiesMarkup = visibleCities.length
              ? visibleCities.map(function (ct) { return '<span class="rg-kb-city-tag">' + esc(ct) + '</span>'; }).join('') +
                (extraCount ? '<span class="rg-kb-city-tag is-more">+' + extraCount + '</span>' : '')
              : '<span class="rg-kb-muted-txt">' + (en ? 'No cities assigned yet' : 'لم تحدد مدن بعد') + '</span>';

            return (
              '<article class="surface-card rg-kb-company-card" data-kb-company-id="' + esc(c.id) + '">' +
                '<div class="rg-kb-company-card-head" data-kb-open-company="' + esc(c.id) + '" role="button" tabindex="0">' +
                  '<div class="rg-kb-company-brand">' +
                    (c.logoUrl
                      ? '<img src="' + esc(c.logoUrl) + '" alt="' + esc(c.name) + '" class="rg-kb-company-logo" />'
                      : '<div class="rg-kb-company-monogram">' + esc(initials) + '</div>') +
                    '<div>' +
                      '<h3 class="rg-kb-company-name">' + esc(c.name) + '</h3>' +
                      '<div class="rg-kb-company-counts">' +
                        '<span>' + esc(c.branchesCount || 0) + ' ' + (en ? 'Branches' : 'فرع') + '</span>' +
                        '<span>·</span>' +
                        '<span>' + esc(c.citiesCount || (c.cities || []).length) + ' ' + (en ? 'Cities' : 'مدينة') + '</span>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  statusBadgeHtml(c.status, ctx) +
                '</div>' +
                (c.shortDescription ? '<p class="rg-kb-company-desc" data-kb-open-company="' + esc(c.id) + '">' + esc(c.shortDescription) + '</p>' : '') +
                '<div class="rg-kb-company-cities-block" data-kb-open-company="' + esc(c.id) + '">' +
                  '<div class="rg-kb-cities-label">' + (en ? 'Available Cities:' : 'المدن المتوفرة:') + '</div>' +
                  '<div class="rg-kb-cities-wrap">' + citiesMarkup + '</div>' +
                '</div>' +
                '<div class="rg-kb-company-card-foot">' +
                  '<button type="button" class="btn btn-xs btn-ghost" data-kb-open-company="' + esc(c.id) + '">' + (en ? 'View Details & Branches' : 'التفاصيل والفروع') + '</button>' +
                  '<div class="rg-kb-row-actions">' +
                    (canEdit ? '<button type="button" class="btn btn-xs btn-ghost" data-kb-edit-company="' + esc(c.id) + '">' + (en ? 'Edit' : 'تعديل') + '</button>' : '') +
                    (canDel ? '<button type="button" class="btn btn-xs btn-danger-ghost" data-kb-delete-company="' + esc(c.id) + '">' + (en ? 'Delete' : 'حذف') + '</button>' : '') +
                  '</div>' +
                '</div>' +
              '</article>'
            );
          }).join('') +
        '</div>';

    return toolbar + grid + renderPaginationHtml('companies', pg, ctx);
  }

  function renderCompanyDetailsHtml(c, ctx) {
    var en = isEn(ctx);
    var canEdit = canPerm(ctx, 'kb_manage_companies');
    var canDel = canPerm(ctx, 'kb_delete_content');
    var allBranches = Array.isArray(c.branches) ? c.branches : [];
    var filterCity = kbState.companyBranchCityFilter;
    var filterSearch = String(kbState.companyBranchSearch || '').trim().toLowerCase();

    var visibleBranches = allBranches.filter(function (b) {
      if (filterCity && String(b.city || '') !== filterCity) return false;
      if (filterSearch) {
        var text = [b.branchName, b.city, b.district, b.fullAddress, b.phone, (b.services || []).join(' ')].join(' ').toLowerCase();
        if (text.indexOf(filterSearch) === -1) return false;
      }
      return true;
    });

    var branchCities = [];
    allBranches.forEach(function (b) {
      if (b.city && branchCities.indexOf(b.city) === -1) branchCities.push(b.city);
    });

    return (
      '<div class="rg-kb-company-detail">' +
        '<div class="surface-card rg-kb-detail-header">' +
          '<div class="rg-kb-detail-top">' +
            '<div class="rg-kb-detail-brand">' +
              '<button type="button" class="btn btn-sm btn-ghost" data-kb-action="back-to-companies">' + (en ? '← All Companies' : '→ كافة الشركات') + '</button>' +
              (c.logoUrl
                ? '<img src="' + esc(c.logoUrl) + '" alt="' + esc(c.name) + '" class="rg-kb-company-logo lg" />'
                : '<div class="rg-kb-company-monogram lg">' + esc(String(c.name || '?').slice(0, 2)) + '</div>') +
              '<div>' +
                '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                  '<h3 style="margin:0;">' + esc(c.name) + '</h3>' +
                  statusBadgeHtml(c.status, ctx) +
                '</div>' +
                '<div class="rg-kb-muted-txt" style="margin-top:4px;">' +
                  esc(c.branchesCount || allBranches.length) + ' ' + (en ? 'Branches' : 'فرع') + ' · ' +
                  esc((c.cities || []).length) + ' ' + (en ? 'Cities' : 'مدينة') +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="rg-kb-row-actions">' +
              (canEdit ? '<button type="button" class="btn btn-sm btn-ghost" data-kb-edit-company="' + esc(c.id) + '">' + (en ? 'Edit Company' : 'تعديل الشركة') + '</button>' : '') +
              (canEdit ? '<button type="button" class="btn btn-sm btn-primary" data-kb-add-branch-for="' + esc(c.id) + '">' + (en ? '+ Add Branch' : '+ إضافة فرع') + '</button>' : '') +
            '</div>' +
          '</div>' +
          (c.shortDescription ? '<p class="rg-kb-detail-desc">' + esc(c.shortDescription) + '</p>' : '') +
          '<div class="rg-kb-detail-meta-grid">' +
            '<div class="rg-kb-meta-box"><span class="rg-kb-meta-lbl">' + (en ? 'Phone' : 'رقم التواصل') + '</span><strong>' + esc(c.phone || '-') + '</strong></div>' +
            '<div class="rg-kb-meta-box"><span class="rg-kb-meta-lbl">' + (en ? 'Email' : 'البريد الإلكتروني') + '</span><strong>' + esc(c.email || '-') + '</strong></div>' +
            '<div class="rg-kb-meta-box"><span class="rg-kb-meta-lbl">' + (en ? 'Website' : 'الموقع الإلكتروني') + '</span>' +
              (c.website ? '<a href="' + esc(c.website) + '" target="_blank" rel="noopener noreferrer" class="rg-kb-link">' + esc(c.website) + '</a>' : '<strong>-</strong>') +
            '</div>' +
            '<div class="rg-kb-meta-box"><span class="rg-kb-meta-lbl">' + (en ? 'Last Updated' : 'آخر تحديث') + '</span><strong>' + esc(fmtDate(c.updatedAt, ctx)) + (c.updatedByName ? ' · ' + esc(c.updatedByName) : '') + '</strong></div>' +
          '</div>' +
          '<div class="rg-kb-detail-tags-row">' +
            '<div><span class="rg-kb-cities-label">' + (en ? 'Cities Covered:' : 'المدن المغطاة:') + '</span> ' +
              ((c.cities || []).length ? c.cities.map(function (ct) { return '<span class="rg-kb-city-tag">' + esc(ct) + '</span>'; }).join('') : '-') +
            '</div>' +
            '<div><span class="rg-kb-cities-label">' + (en ? 'Service Types:' : 'أنواع الخدمات:') + '</span> ' +
              ((c.serviceTypes || []).length ? c.serviceTypes.map(function (sv) { return '<span class="rg-kb-meta-chip">' + esc(sv) + '</span>'; }).join('') : '-') +
            '</div>' +
          '</div>' +
          (c.images && c.images.length
            ? '<div class="rg-kb-gallery">' + c.images.map(function (imgUrl) {
                return '<a href="' + esc(imgUrl) + '" target="_blank" rel="noopener noreferrer"><img src="' + esc(imgUrl) + '" alt="' + esc(c.name) + '" class="rg-kb-gallery-img" loading="lazy" /></a>';
              }).join('') + '</div>'
            : '') +
          (c.internalNotes
            ? '<div class="rg-kb-internal-note"><strong>' + (en ? 'Internal Staff Notes:' : 'ملاحظات داخلية للموظفين:') + '</strong> ' + esc(c.internalNotes) + '</div>'
            : '') +
        '</div>' +
        '<div class="surface-card rg-kb-toolbar">' +
          '<div class="rg-kb-toolbar-inputs">' +
            '<input type="search" id="kb-comp-branch-search" class="input" value="' + esc(kbState.companyBranchSearch) + '" placeholder="' + (en ? 'Search branch by name or address...' : 'بحث في الفروع بالاسم أو الحي...') + '" />' +
            '<select id="kb-comp-branch-city" class="input">' +
              '<option value="">' + (en ? 'All Branch Cities' : 'كل مدن الشركة') + '</option>' +
              branchCities.map(function (ct) { return '<option value="' + esc(ct) + '"' + (filterCity === ct ? ' selected' : '') + '>' + esc(ct) + '</option>'; }).join('') +
            '</select>' +
          '</div>' +
          '<div class="rg-kb-muted-txt">' + esc(visibleBranches.length) + ' / ' + esc(allBranches.length) + ' ' + (en ? 'branches' : 'فرع') + '</div>' +
        '</div>' +
        (!visibleBranches.length
          ? '<div class="surface-card"><div class="empty-state" style="padding:28px 16px;">' + (en ? 'No branches match the filter.' : 'لا توجد فروع مطابقة للتصفية الحالية.') + '</div></div>'
          : '<div class="rg-kb-branches-grid">' +
              visibleBranches.map(function (b) { return renderBranchCardHtml(b, ctx, canEdit, canDel, true); }).join('') +
            '</div>') +
      '</div>'
    );
  }

  function renderBranchCardHtml(b, ctx, canEdit, canDel, hideCompanyHeader) {
    var en = isEn(ctx);
    return (
      '<article class="surface-card rg-kb-branch-card">' +
        '<div class="rg-kb-branch-head">' +
          '<div>' +
            (!hideCompanyHeader && b.companyName ? '<div class="rg-kb-branch-comp">' + esc(b.companyName) + '</div>' : '') +
            '<h4 class="rg-kb-branch-title">' + esc(b.branchName) + '</h4>' +
            '<div class="rg-kb-branch-loc">' +
              '<span class="rg-kb-city-tag">' + esc(b.city) + '</span>' +
              (b.district ? '<span class="rg-kb-meta-chip">' + esc(b.district) + '</span>' : '') +
            '</div>' +
          '</div>' +
          statusBadgeHtml(b.status, ctx) +
        '</div>' +
        '<div class="rg-kb-branch-body">' +
          (b.fullAddress ? '<div><strong>' + (en ? 'Address:' : 'العنوان:') + '</strong> ' + esc(b.fullAddress) + '</div>' : '') +
          (b.phone ? '<div><strong>' + (en ? 'Phone:' : 'الهاتف:') + '</strong> <span dir="ltr">' + esc(b.phone) + '</span></div>' : '') +
          (b.workingHours ? '<div><strong>' + (en ? 'Hours:' : 'ساعات العمل:') + '</strong> ' + esc(b.workingHours) + '</div>' : '') +
          (b.services && b.services.length
            ? '<div class="rg-kb-branch-services">' + b.services.map(function (s) { return '<span class="rg-kb-meta-chip">' + esc(s) + '</span>'; }).join('') + '</div>'
            : '') +
          (b.notes ? '<div class="rg-kb-internal-note compact">' + esc(b.notes) + '</div>' : '') +
        '</div>' +
        '<div class="rg-kb-branch-foot">' +
          (b.googleMapsUrl
            ? '<a href="' + esc(b.googleMapsUrl) + '" target="_blank" rel="noopener noreferrer" class="btn btn-xs btn-ghost">' +
                renderIcon('M12 21s-6-4.35-6-10a6 6 0 1 1 12 0c0 5.65-6 10-6 10z', 14) +
                '<span>Google Maps</span></a>'
            : '<span></span>') +
          '<div class="rg-kb-row-actions">' +
            (canEdit ? '<button type="button" class="btn btn-xs btn-ghost" data-kb-edit-branch="' + esc(b.id) + '">' + (en ? 'Edit' : 'تعديل') + '</button>' : '') +
            (canDel ? '<button type="button" class="btn btn-xs btn-danger-ghost" data-kb-delete-branch="' + esc(b.id) + '">' + (en ? 'Delete' : 'حذف') + '</button>' : '') +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderBranchesDirectoryHtml(ctx) {
    var en = isEn(ctx);
    var canEdit = canPerm(ctx, 'kb_manage_companies');
    var canDel = canPerm(ctx, 'kb_delete_content');
    var companies = getCompaniesListForFilter();
    var cities = getCitiesListForFilter();
    var items = kbState.branches.items || [];
    var pg = kbState.branches.pagination || { page: 1, totalPages: 1, total: 0 };

    return (
      '<div class="surface-card rg-kb-toolbar">' +
        '<div class="rg-kb-toolbar-inputs">' +
          '<input type="search" id="kb-br-search" class="input" value="' + esc(kbState.branches.search) + '" placeholder="' + (en ? 'Search branch, district, address, phone...' : 'بحث باسم الفرع أو الحي أو العنوان أو الهاتف...') + '" />' +
          '<select id="kb-br-company" class="input">' +
            '<option value="">' + (en ? 'All Companies' : 'كل الشركات') + '</option>' +
            companies.map(function (c) { return '<option value="' + esc(c.id) + '"' + (kbState.branches.companyId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
          '</select>' +
          '<select id="kb-br-city" class="input">' +
            '<option value="">' + (en ? 'All Cities' : 'كل المدن') + '</option>' +
            cities.map(function (ct) { return '<option value="' + esc(ct) + '"' + (kbState.branches.city === ct ? ' selected' : '') + '>' + esc(ct) + '</option>'; }).join('') +
          '</select>' +
          '<select id="kb-br-status" class="input">' +
            '<option value="">' + (en ? 'All Statuses' : 'كل الحالات') + '</option>' +
            '<option value="active"' + (kbState.branches.status === 'active' ? ' selected' : '') + '>' + (en ? 'Active' : 'نشط') + '</option>' +
            '<option value="inactive"' + (kbState.branches.status === 'inactive' ? ' selected' : '') + '>' + (en ? 'Inactive' : 'غير نشط') + '</option>' +
          '</select>' +
        '</div>' +
        '<div class="rg-kb-toolbar-actions">' +
          (canEdit
            ? '<button type="button" class="btn btn-sm btn-primary" data-kb-action="add-branch">' +
                renderIcon('M12 5v14M5 12h14', 15) + '<span>' + (en ? 'Add Branch' : 'إضافة فرع جديد') + '</span></button>'
            : '') +
        '</div>' +
      '</div>' +
      (!items.length
        ? '<div class="surface-card"><div class="empty-state" style="padding:36px 18px;">' + (en ? 'No branches registered yet.' : 'لا توجد فروع مسجلة بعد.') + '</div></div>'
        : '<div class="rg-kb-branches-grid">' +
            items.map(function (b) { return renderBranchCardHtml(b, ctx, canEdit, canDel, false); }).join('') +
          '</div>') +
      renderPaginationHtml('branches', pg, ctx)
    );
  }

  function renderPoliciesHtml(ctx) {
    var en = isEn(ctx);
    var canEdit = canPerm(ctx, 'kb_manage_policies');
    var canDel = canPerm(ctx, 'kb_delete_content');
    var companies = getCompaniesListForFilter();
    var cities = getCitiesListForFilter();
    var sectionCats = POLICY_CATEGORIES.filter(function (c) { return c.section === kbState.tab; });
    var items = kbState.policies.items || [];
    var pg = kbState.policies.pagination || { page: 1, totalPages: 1, total: 0 };

    return (
      '<div class="surface-card rg-kb-toolbar">' +
        '<div class="rg-kb-toolbar-inputs">' +
          '<input type="search" id="kb-pol-search" class="input" value="' + esc(kbState.policies.search) + '" placeholder="' + (en ? 'Search policy title, content, keywords...' : 'بحث في السياسات والشروط والكلمات المفتاحية...') + '" />' +
          '<select id="kb-pol-cat" class="input">' +
            '<option value="all">' + (en ? 'All Categories' : 'كل التصنيفات') + '</option>' +
            (sectionCats.length ? sectionCats : POLICY_CATEGORIES).map(function (c) {
              return '<option value="' + esc(c.id) + '"' + (kbState.policies.category === c.id ? ' selected' : '') + '>' + esc(lbl(c, ctx)) + '</option>';
            }).join('') +
          '</select>' +
          '<select id="kb-pol-company" class="input">' +
            '<option value="">' + (en ? 'All / General' : 'عام + كل الشركات') + '</option>' +
            companies.map(function (c) { return '<option value="' + esc(c.id) + '"' + (kbState.policies.companyId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
          '</select>' +
          '<select id="kb-pol-city" class="input">' +
            '<option value="">' + (en ? 'All Cities' : 'كل المدن') + '</option>' +
            cities.map(function (ct) { return '<option value="' + esc(ct) + '"' + (kbState.policies.city === ct ? ' selected' : '') + '>' + esc(ct) + '</option>'; }).join('') +
          '</select>' +
          (canEdit
            ? '<select id="kb-pol-status" class="input">' +
                '<option value="all"' + (kbState.policies.publishStatus === 'all' ? ' selected' : '') + '>' + (en ? 'All Statuses' : 'جميع حالات النشر') + '</option>' +
                '<option value="published"' + (kbState.policies.publishStatus === 'published' ? ' selected' : '') + '>' + (en ? 'Published' : 'منشور') + '</option>' +
                '<option value="draft"' + (kbState.policies.publishStatus === 'draft' ? ' selected' : '') + '>' + (en ? 'Draft' : 'مسودة') + '</option>' +
                '<option value="archived"' + (kbState.policies.publishStatus === 'archived' ? ' selected' : '') + '>' + (en ? 'Archived' : 'مؤرشف') + '</option>' +
              '</select>'
            : '') +
        '</div>' +
        '<div class="rg-kb-toolbar-actions">' +
          (canEdit
            ? '<button type="button" class="btn btn-sm btn-primary" data-kb-action="add-policy">' +
                renderIcon('M12 5v14M5 12h14', 15) + '<span>' + (en ? 'Add Policy' : 'إضافة سياسة / شرط') + '</span></button>'
            : '') +
        '</div>' +
      '</div>' +
      (!items.length
        ? '<div class="surface-card"><div class="empty-state" style="padding:36px 18px;">' + (en ? 'No policies in this section yet.' : 'لا توجد سياسات أو شروط مسجلة في هذا القسم بعد.') + '</div></div>'
        : '<div class="rg-kb-accordion-list">' +
            items.map(function (p, idx) {
              var expanded = Boolean(kbState.expandedPolicyIds[p.id] || idx === 0 || kbState.highlightEntityId === p.id);
              return (
                '<article class="surface-card rg-kb-accordion-card' + (expanded ? ' is-open' : '') + (kbState.highlightEntityId === p.id ? ' is-highlight' : '') + '">' +
                  '<div class="rg-kb-accordion-head" data-kb-toggle-policy="' + esc(p.id) + '" role="button" tabindex="0" aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
                    '<div class="rg-kb-accordion-title-col">' +
                      '<div class="rg-kb-accordion-badges">' +
                        '<span class="rg-kb-badge is-brand">' + esc(getCategoryLabel(POLICY_CATEGORIES, p.category, ctx)) + '</span>' +
                        (p.companyName ? '<span class="rg-kb-meta-chip">' + esc(p.companyName) + '</span>' : '') +
                        (p.city ? '<span class="rg-kb-city-tag">' + esc(p.city) + '</span>' : '') +
                        statusBadgeHtml(p.publishStatus, ctx) +
                      '</div>' +
                      '<h4 class="rg-kb-accordion-title">' + esc(p.title) + '</h4>' +
                      '<div class="rg-kb-muted-txt">' +
                        (en ? 'Updated: ' : 'آخر تحديث: ') + esc(fmtDate(p.updatedAt, ctx)) +
                        (p.updatedByName ? ' · ' + esc(p.updatedByName) : '') +
                        ' · ' + esc(p.usageCount || 0) + ' ' + (en ? 'views' : 'عرض') +
                      '</div>' +
                    '</div>' +
                    '<div class="rg-kb-accordion-chevron">' + renderIcon(expanded ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6', 18) + '</div>' +
                  '</div>' +
                  (expanded
                    ? '<div class="rg-kb-accordion-body">' +
                        '<div class="rg-kb-rich-content">' + sanitizeDisplayHtml(p.descriptionHtml || p.descriptionText) + '</div>' +
                        (p.keywords && p.keywords.length
                          ? '<div class="rg-kb-keywords-row">' + p.keywords.map(function (kw) { return '<span class="rg-kb-meta-chip">#' + esc(kw) + '</span>'; }).join('') + '</div>'
                          : '') +
                        (p.attachments && p.attachments.length
                          ? '<div class="rg-kb-attachments-row"><strong>' + (en ? 'Attachments & Links:' : 'المرفقات والروابط:') + '</strong>' +
                              p.attachments.map(function (att) {
                                return '<a href="' + esc(att.url) + '" target="_blank" rel="noopener noreferrer" class="rg-kb-attachment-link">' +
                                  renderIcon('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 14) +
                                  '<span>' + esc(att.label || att.url) + '</span></a>';
                              }).join('') +
                            '</div>'
                          : '') +
                        '<div class="rg-kb-card-foot">' +
                          '<button type="button" class="btn btn-xs btn-ghost" data-kb-copy-policy="' + esc(p.id) + '">' +
                            renderIcon('M8 17.929H6c-1.105 0-2-.912-2-2.036V5.036C4 3.91 4.895 3 6 3h8c1.105 0 2 .911 2 2.036v1.866m-6 14.06h8c1.105 0 2-.91 2-2.035V8.93c0-1.124-.895-2.036-2-2.036h-8c-1.105 0-2 .912-2 2.036v10c0 1.124.895 2.036 2 2.036z', 14) +
                            '<span>' + (en ? 'Copy Text' : 'نسخ النص') + '</span></button>' +
                          '<div class="rg-kb-row-actions">' +
                            (canEdit ? '<button type="button" class="btn btn-xs btn-ghost" data-kb-edit-policy="' + esc(p.id) + '">' + (en ? 'Edit' : 'تعديل') + '</button>' : '') +
                            (canDel ? '<button type="button" class="btn btn-xs btn-danger-ghost" data-kb-delete-policy="' + esc(p.id) + '">' + (en ? 'Delete' : 'حذف') + '</button>' : '') +
                          '</div>' +
                        '</div>' +
                      '</div>'
                    : '') +
                '</article>'
              );
            }).join('') +
          '</div>') +
      renderPaginationHtml('policies', pg, ctx)
    );
  }

  function renderFaqHtml(ctx) {
    var en = isEn(ctx);
    var canEdit = canPerm(ctx, 'kb_manage_faqs');
    var canDel = canPerm(ctx, 'kb_delete_content');
    var companies = getCompaniesListForFilter();
    var items = kbState.faqs.items || [];
    var highlights = kbState.faqs.mostSearchedHighlights || [];
    var pg = kbState.faqs.pagination || { page: 1, totalPages: 1, total: 0 };

    var highlightStrip = highlights.length
      ? '<div class="surface-card rg-kb-highlights-strip">' +
          '<div class="rg-kb-card-head"><h4>' + (en ? 'Most Searched & Used FAQs' : 'الأسئلة الأكثر بحثاً واستخداماً') + '</h4></div>' +
          '<div class="rg-kb-highlights-chips">' +
            highlights.map(function (h) {
              return '<button type="button" class="rg-kb-highlight-btn" data-kb-toggle-faq="' + esc(h.id) + '">' +
                '<span>' + esc(h.question) + '</span>' +
                '<span class="rg-kb-badge is-info">' + esc(h.searchHitCount || h.usageCount || 0) + '</span>' +
              '</button>';
            }).join('') +
          '</div>' +
        '</div>'
      : '';

    return (
      '<div class="surface-card rg-kb-toolbar">' +
        '<div class="rg-kb-toolbar-inputs">' +
          '<input type="search" id="kb-faq-search" class="input" value="' + esc(kbState.faqs.search) + '" placeholder="' + (en ? 'Search FAQ questions, answers, keywords...' : 'بحث في الأسئلة الشائعة والإجابات...') + '" />' +
          '<select id="kb-faq-cat" class="input">' +
            '<option value="all">' + (en ? 'All Categories' : 'كل التصنيفات') + '</option>' +
            FAQ_CATEGORIES.map(function (c) {
              return '<option value="' + esc(c.id) + '"' + (kbState.faqs.category === c.id ? ' selected' : '') + '>' + esc(lbl(c, ctx)) + '</option>';
            }).join('') +
          '</select>' +
          '<select id="kb-faq-company" class="input">' +
            '<option value="">' + (en ? 'All Companies' : 'كل الشركات') + '</option>' +
            companies.map(function (c) { return '<option value="' + esc(c.id) + '"' + (kbState.faqs.companyId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
          '</select>' +
          '<select id="kb-faq-sort" class="input">' +
            '<option value="updated"' + (kbState.faqs.sortBy === 'updated' ? ' selected' : '') + '>' + (en ? 'Latest Updated' : 'الأحدث') + '</option>' +
            '<option value="most_used"' + (kbState.faqs.sortBy === 'most_used' ? ' selected' : '') + '>' + (en ? 'Most Used' : 'الأكثر استخداماً') + '</option>' +
            '<option value="most_searched"' + (kbState.faqs.sortBy === 'most_searched' ? ' selected' : '') + '>' + (en ? 'Most Searched' : 'الأكثر بحثاً') + '</option>' +
          '</select>' +
        '</div>' +
        '<div class="rg-kb-toolbar-actions">' +
          (canEdit
            ? '<button type="button" class="btn btn-sm btn-primary" data-kb-action="add-faq">' +
                renderIcon('M12 5v14M5 12h14', 15) + '<span>' + (en ? 'Add FAQ' : 'إضافة سؤال شائع') + '</span></button>'
            : '') +
        '</div>' +
      '</div>' +
      highlightStrip +
      (!items.length
        ? '<div class="surface-card"><div class="empty-state" style="padding:36px 18px;">' + (en ? 'No FAQs added yet.' : 'لا توجد أسئلة شائعة مسجلة بعد.') + '</div></div>'
        : '<div class="rg-kb-accordion-list">' +
            items.map(function (f, idx) {
              var expanded = Boolean(kbState.expandedFaqIds[f.id] || idx === 0 || kbState.highlightEntityId === f.id);
              return (
                '<article class="surface-card rg-kb-accordion-card' + (expanded ? ' is-open' : '') + '">' +
                  '<div class="rg-kb-accordion-head" data-kb-toggle-faq="' + esc(f.id) + '" role="button" tabindex="0" aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
                    '<div class="rg-kb-accordion-title-col">' +
                      '<div class="rg-kb-accordion-badges">' +
                        '<span class="rg-kb-badge is-warning">' + esc(getCategoryLabel(FAQ_CATEGORIES, f.category, ctx)) + '</span>' +
                        (f.companyName ? '<span class="rg-kb-meta-chip">' + esc(f.companyName) + '</span>' : '') +
                        statusBadgeHtml(f.publishStatus, ctx) +
                      '</div>' +
                      '<h4 class="rg-kb-accordion-title">' + esc(f.question) + '</h4>' +
                      '<div class="rg-kb-muted-txt">' +
                        esc(fmtDate(f.updatedAt, ctx)) + ' · ' + esc(f.usageCount || 0) + ' ' + (en ? 'copies' : 'نسخة') +
                      '</div>' +
                    '</div>' +
                    '<div class="rg-kb-accordion-chevron">' + renderIcon(expanded ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6', 18) + '</div>' +
                  '</div>' +
                  (expanded
                    ? '<div class="rg-kb-accordion-body">' +
                        '<div class="rg-kb-rich-content">' + sanitizeDisplayHtml(f.answerHtml || f.answerText) + '</div>' +
                        '<div class="rg-kb-card-foot">' +
                          '<button type="button" class="btn btn-xs btn-primary" data-kb-copy-faq="' + esc(f.id) + '">' +
                            renderIcon('M8 17.929H6c-1.105 0-2-.912-2-2.036V5.036C4 3.91 4.895 3 6 3h8c1.105 0 2 .911 2 2.036v1.866m-6 14.06h8c1.105 0 2-.91 2-2.035V8.93c0-1.124-.895-2.036-2-2.036h-8c-1.105 0-2 .912-2 2.036v10c0 1.124.895 2.036 2 2.036z', 14) +
                            '<span>' + (en ? 'Copy Answer' : 'نسخ الإجابة') + '</span></button>' +
                          '<div class="rg-kb-row-actions">' +
                            (canEdit ? '<button type="button" class="btn btn-xs btn-ghost" data-kb-edit-faq="' + esc(f.id) + '">' + (en ? 'Edit' : 'تعديل') + '</button>' : '') +
                            (canDel ? '<button type="button" class="btn btn-xs btn-danger-ghost" data-kb-delete-faq="' + esc(f.id) + '">' + (en ? 'Delete' : 'حذف') + '</button>' : '') +
                          '</div>' +
                        '</div>' +
                      '</div>'
                    : '') +
                '</article>'
              );
            }).join('') +
          '</div>') +
      renderPaginationHtml('faqs', pg, ctx)
    );
  }

  function renderQuickRepliesHtml(ctx) {
    var en = isEn(ctx);
    var canEdit = canPerm(ctx, 'kb_manage_quick_replies');
    var canDel = canPerm(ctx, 'kb_delete_content');
    var companies = getCompaniesListForFilter();
    var items = kbState.quickReplies.items || [];
    var mostUsed = kbState.quickReplies.mostUsed || [];
    var pg = kbState.quickReplies.pagination || { page: 1, totalPages: 1, total: 0 };

    var varFillBar =
      '<div class="surface-card rg-kb-vars-panel">' +
        '<div class="rg-kb-card-head">' +
          '<h4>' + (en ? 'Dynamic Variable Fill (Copies Only — Never Auto-Sends)' : 'تعبئة المتغيرات التلقائية (للنسخ اليدوي فقط — دون إرسال تلقائي)') + '</h4>' +
          '<span class="rg-kb-muted-txt">' + (en ? 'Pre-fill values below to replace variables when copying replies' : 'عبّئ القيم أدناه لتطبيقها مباشرة عند نسخ أي رد') + '</span>' +
        '</div>' +
        '<div class="rg-kb-vars-grid">' +
          DYNAMIC_VARS.map(function (dv) {
            return (
              '<label class="rg-kb-var-field">' +
                '<span>' + esc(lbl(dv, ctx)) + ' <code>' + esc(dv.token) + '</code></span>' +
                '<input type="text" class="input input-sm" data-kb-var-key="' + esc(dv.key) + '" value="' + esc(kbState.quickVarValues[dv.key] || '') + '" placeholder="' + esc(lbl(dv, ctx)) + '" />' +
              '</label>'
            );
          }).join('') +
        '</div>' +
      '</div>';

    var mostUsedStrip = mostUsed.length
      ? '<div class="surface-card rg-kb-highlights-strip">' +
          '<div class="rg-kb-card-head"><h4>' + (en ? 'Most Used Quick Replies' : 'الردود الأكثر استخداماً') + '</h4></div>' +
          '<div class="rg-kb-highlights-chips">' +
            mostUsed.map(function (m) {
              return '<button type="button" class="rg-kb-highlight-btn" data-kb-copy-reply="' + esc(m.id) + '">' +
                '<span>' + esc(m.title) + '</span>' +
                '<span class="rg-kb-badge is-brand">' + esc(m.usageCount || 0) + '</span>' +
              '</button>';
            }).join('') +
          '</div>' +
        '</div>'
      : '';

    return (
      '<div class="surface-card rg-kb-toolbar">' +
        '<div class="rg-kb-toolbar-inputs">' +
          '<input type="search" id="kb-qr-search" class="input" value="' + esc(kbState.quickReplies.search) + '" placeholder="' + (en ? 'Search reply title, message text, keywords...' : 'بحث في الردود الجاهزة أو الكلمات المفتاحية...') + '" />' +
          '<select id="kb-qr-cat" class="input">' +
            '<option value="all">' + (en ? 'All Categories' : 'كل التصنيفات') + '</option>' +
            QUICK_REPLY_CATEGORIES.map(function (c) {
              return '<option value="' + esc(c.id) + '"' + (kbState.quickReplies.category === c.id ? ' selected' : '') + '>' + esc(lbl(c, ctx)) + '</option>';
            }).join('') +
          '</select>' +
          '<select id="kb-qr-lang" class="input">' +
            '<option value="all">' + (en ? 'All Languages' : 'كل اللغات') + '</option>' +
            '<option value="ar"' + (kbState.quickReplies.language === 'ar' ? ' selected' : '') + '>العربية (AR)</option>' +
            '<option value="en"' + (kbState.quickReplies.language === 'en' ? ' selected' : '') + '>English (EN)</option>' +
          '</select>' +
          '<select id="kb-qr-company" class="input">' +
            '<option value="">' + (en ? 'All Companies' : 'كل الشركات') + '</option>' +
            companies.map(function (c) { return '<option value="' + esc(c.id) + '"' + (kbState.quickReplies.companyId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
          '</select>' +
          '<select id="kb-qr-sort" class="input">' +
            '<option value="most_used"' + (kbState.quickReplies.sortBy === 'most_used' ? ' selected' : '') + '>' + (en ? 'Most Used' : 'الأكثر استخداماً') + '</option>' +
            '<option value="updated"' + (kbState.quickReplies.sortBy === 'updated' ? ' selected' : '') + '>' + (en ? 'Latest Updated' : 'الأحدث') + '</option>' +
          '</select>' +
        '</div>' +
        '<div class="rg-kb-toolbar-actions">' +
          (canEdit
            ? '<button type="button" class="btn btn-sm btn-primary" data-kb-action="add-quick-reply">' +
                renderIcon('M12 5v14M5 12h14', 15) + '<span>' + (en ? 'Add Quick Reply' : 'إضافة رد جاهز') + '</span></button>'
            : '') +
        '</div>' +
      '</div>' +
      varFillBar +
      mostUsedStrip +
      (!items.length
        ? '<div class="surface-card"><div class="empty-state" style="padding:36px 18px;">' + (en ? 'No quick replies added yet.' : 'لا توجد ردود جاهزة مسجلة بعد.') + '</div></div>'
        : '<div class="rg-kb-replies-grid">' +
            items.map(function (qr) {
              var preview = substituteQuickVariables(qr.messageText, kbState.quickVarValues);
              var tplVars = extractTemplateVariables(qr.messageText);
              return (
                '<article class="surface-card rg-kb-reply-card">' +
                  '<div class="rg-kb-reply-head">' +
                    '<div>' +
                      '<div class="rg-kb-accordion-badges">' +
                        '<span class="rg-kb-badge is-brand">' + esc(getCategoryLabel(QUICK_REPLY_CATEGORIES, qr.category, ctx)) + '</span>' +
                        '<span class="rg-kb-badge is-info">' + esc(String(qr.language || 'ar').toUpperCase()) + '</span>' +
                        (qr.companyName ? '<span class="rg-kb-meta-chip">' + esc(qr.companyName) + '</span>' : '') +
                        statusBadgeHtml(qr.status, ctx) +
                      '</div>' +
                      '<h4 class="rg-kb-reply-title">' + esc(qr.title) + '</h4>' +
                    '</div>' +
                    '<span class="rg-kb-muted-txt">' + esc(qr.usageCount || 0) + ' ' + (en ? 'uses' : 'استخدام') + '</span>' +
                  '</div>' +
                  '<pre class="rg-kb-reply-body" dir="' + (qr.language === 'en' ? 'ltr' : 'rtl') + '">' + esc(preview) + '</pre>' +
                  (tplVars.length
                    ? '<div class="rg-kb-keywords-row">' + tplVars.map(function (vk) { return '<span class="rg-kb-meta-chip">{' + esc(vk) + '}</span>'; }).join('') + '</div>'
                    : '') +
                  '<div class="rg-kb-card-foot">' +
                    '<div class="rg-kb-row-actions">' +
                      '<button type="button" class="btn btn-xs btn-primary" data-kb-copy-reply="' + esc(qr.id) + '">' +
                        renderIcon('M8 17.929H6c-1.105 0-2-.912-2-2.036V5.036C4 3.91 4.895 3 6 3h8c1.105 0 2 .911 2 2.036v1.866m-6 14.06h8c1.105 0 2-.91 2-2.035V8.93c0-1.124-.895-2.036-2-2.036h-8c-1.105 0-2 .912-2 2.036v10c0 1.124.895 2.036 2 2.036z', 14) +
                        '<span>' + (en ? 'Copy Reply' : 'نسخ الرد') + '</span></button>' +
                      (tplVars.length
                        ? '<button type="button" class="btn btn-xs btn-ghost" data-kb-fill-copy-reply="' + esc(qr.id) + '">' + (en ? 'Fill Variables & Copy' : 'تعبئة ونسخ') + '</button>'
                        : '') +
                    '</div>' +
                    '<div class="rg-kb-row-actions">' +
                      (canEdit ? '<button type="button" class="btn btn-xs btn-ghost" data-kb-edit-reply="' + esc(qr.id) + '">' + (en ? 'Edit' : 'تعديل') + '</button>' : '') +
                      (canDel ? '<button type="button" class="btn btn-xs btn-danger-ghost" data-kb-delete-reply="' + esc(qr.id) + '">' + (en ? 'Delete' : 'حذف') + '</button>' : '') +
                    '</div>' +
                  '</div>' +
                '</article>'
              );
            }).join('') +
          '</div>') +
      renderPaginationHtml('quickReplies', pg, ctx)
    );
  }

  function renderPaginationHtml(stateKey, pg, ctx) {
    if (!pg || (pg.totalPages || 1) <= 1) return '';
    var en = isEn(ctx);
    return (
      '<div class="rg-kb-pagination">' +
        '<span class="rg-kb-muted-txt">' + (en ? 'Page' : 'صفحة') + ' ' + esc(pg.page) + ' / ' + esc(pg.totalPages) + ' (' + esc(pg.total) + ')</span>' +
        '<div class="rg-kb-row-actions">' +
          '<button type="button" class="btn btn-xs btn-ghost" data-kb-page-scope="' + esc(stateKey) + '" data-kb-page-val="' + esc(Math.max(1, pg.page - 1)) + '"' + (pg.page <= 1 ? ' disabled' : '') + '>' + (en ? 'Previous' : 'السابق') + '</button>' +
          '<button type="button" class="btn btn-xs btn-ghost" data-kb-page-scope="' + esc(stateKey) + '" data-kb-page-val="' + esc(Math.min(pg.totalPages, pg.page + 1)) + '"' + (pg.page >= pg.totalPages ? ' disabled' : '') + '>' + (en ? 'Next' : 'التالي') + '</button>' +
        '</div>' +
      '</div>'
    );
  }

  function openCompanyModal(existing, ctx) {
    var en = isEn(ctx);
    var c = existing || {};
    var bodyHtml =
      '<form id="kb-company-form" class="rg-kb-modal-form">' +
        '<div class="rg-kb-form-grid">' +
          '<label class="rg-kb-field"><span>' + (en ? 'Company Name *' : 'اسم شركة التأجير *') + '</span><input type="text" id="kb-cmp-name" class="input" required value="' + esc(c.name || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Status' : 'حالة الشركة') + '</span>' +
            '<select id="kb-cmp-status" class="input">' +
              '<option value="active"' + (c.status !== 'inactive' ? ' selected' : '') + '>' + (en ? 'Active' : 'نشطة') + '</option>' +
              '<option value="inactive"' + (c.status === 'inactive' ? ' selected' : '') + '>' + (en ? 'Inactive' : 'غير نشطة') + '</option>' +
            '</select></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Contact Phone' : 'رقم التواصل') + '</span><input type="text" id="kb-cmp-phone" class="input" value="' + esc(c.phone || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Email' : 'البريد الإلكتروني') + '</span><input type="email" id="kb-cmp-email" class="input" value="' + esc(c.email || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Website' : 'الموقع الإلكتروني') + '</span><input type="text" id="kb-cmp-web" class="input" placeholder="https://..." value="' + esc(c.website || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Logo URL' : 'رابط شعار الشركة') + '</span><input type="text" id="kb-cmp-logo" class="input" placeholder="https://..." value="' + esc(c.logoUrl || '') + '" /></label>' +
        '</div>' +
        '<label class="rg-kb-field"><span>' + (en ? 'Short Description' : 'وصف مختصر') + '</span><textarea id="kb-cmp-desc" class="input" rows="2">' + esc(c.shortDescription || '') + '</textarea></label>' +
        '<div class="rg-kb-form-grid">' +
          '<label class="rg-kb-field"><span>' + (en ? 'Covered Cities (comma-separated)' : 'المدن المتوفرة بها خدمات الشركة (مفصولة بفاصلة)') + '</span><input type="text" id="kb-cmp-cities" class="input" placeholder="الرياض، جدة، الدمام" value="' + esc((c.cities || []).join('، ')) + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Service Types (comma-separated)' : 'أنواع الخدمات المتاحة (مفصولة بفاصلة)') + '</span><input type="text" id="kb-cmp-services" class="input" placeholder="تأجير يومي، توصيل للمطار، تأمين شامل" value="' + esc((c.serviceTypes || []).join('، ')) + '" /></label>' +
        '</div>' +
        '<label class="rg-kb-field"><span>' + (en ? 'Company Image URLs (comma or newline separated)' : 'روابط صور الشركة (مفصولة بفاصلة أو سطر جديد)') + '</span><textarea id="kb-cmp-images" class="input" rows="2">' + esc((c.images || []).join('\n')) + '</textarea></label>' +
        '<label class="rg-kb-field"><span>' + (en ? 'Internal Employee Notes' : 'ملاحظات داخلية للموظفين') + '</span><textarea id="kb-cmp-notes" class="input" rows="2">' + esc(c.internalNotes || '') + '</textarea></label>' +
        '<div class="rg-kb-modal-actions">' +
          '<button type="button" class="btn btn-ghost" id="kb-cmp-cancel">' + (en ? 'Cancel' : 'إلغاء') + '</button>' +
          '<button type="submit" class="btn btn-primary" id="kb-cmp-save">' + (en ? 'Save Company' : 'حفظ بيانات الشركة') + '</button>' +
        '</div>' +
      '</form>';

    var m = openModal({
      title: existing ? (en ? 'Edit Rental Company' : 'تعديل شركة تأجير') : (en ? 'Add Rental Company' : 'إضافة شركة تأجير جديدة'),
      size: 'lg',
      bodyHtml: bodyHtml
    });
    var form = document.getElementById('kb-company-form');
    var cancelBtn = document.getElementById('kb-cmp-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { m.close(); });
    if (form) {
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var btn = document.getElementById('kb-cmp-save');
        if (btn) btn.disabled = true;
        try {
          await callApi('saveKbCompany', {
            id: c.id || '',
            name: document.getElementById('kb-cmp-name').value,
            status: document.getElementById('kb-cmp-status').value,
            phone: document.getElementById('kb-cmp-phone').value,
            email: document.getElementById('kb-cmp-email').value,
            website: document.getElementById('kb-cmp-web').value,
            logoUrl: document.getElementById('kb-cmp-logo').value,
            shortDescription: document.getElementById('kb-cmp-desc').value,
            cities: document.getElementById('kb-cmp-cities').value,
            serviceTypes: document.getElementById('kb-cmp-services').value,
            images: document.getElementById('kb-cmp-images').value,
            internalNotes: document.getElementById('kb-cmp-notes').value
          });
          m.close();
          toast(ctx, en ? 'Company saved successfully' : 'تم حفظ بيانات الشركة بنجاح', 'success');
          await refreshCurrentView(ctx, true);
        } catch (err) {
          toast(ctx, err.message, 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  function openBranchModal(existing, defaultCompanyId, ctx) {
    var en = isEn(ctx);
    var b = existing || {};
    var companies = getCompaniesListForFilter();
    if (!companies.length) {
      toast(ctx, en ? 'Please add a rental company first before adding branches.' : 'يرجى إضافة شركة تأجير أولاً قبل إضافة الفروع.', 'warning');
      return;
    }
    var targetCompId = b.companyId || defaultCompanyId || companies[0].id;
    var bodyHtml =
      '<form id="kb-branch-form" class="rg-kb-modal-form">' +
        '<div class="rg-kb-form-grid">' +
          '<label class="rg-kb-field"><span>' + (en ? 'Rental Company *' : 'شركة التأجير *') + '</span>' +
            '<select id="kb-br-cmp" class="input" required>' +
              companies.map(function (c) { return '<option value="' + esc(c.id) + '"' + (targetCompId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
            '</select></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Branch Name *' : 'اسم الفرع *') + '</span><input type="text" id="kb-br-name" class="input" required value="' + esc(b.branchName || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'City *' : 'المدينة *') + '</span><input type="text" id="kb-br-city" class="input" required value="' + esc(b.city || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'District' : 'الحي') + '</span><input type="text" id="kb-br-district" class="input" value="' + esc(b.district || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Phone' : 'رقم التواصل') + '</span><input type="text" id="kb-br-phone" class="input" value="' + esc(b.phone || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Working Hours' : 'مواعيد العمل') + '</span><input type="text" id="kb-br-hours" class="input" placeholder="السبت - الخميس 8 ص - 11 م" value="' + esc(b.workingHours || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Status' : 'حالة الفرع') + '</span>' +
            '<select id="kb-br-st" class="input">' +
              '<option value="active"' + (b.status !== 'inactive' ? ' selected' : '') + '>' + (en ? 'Active' : 'نشط') + '</option>' +
              '<option value="inactive"' + (b.status === 'inactive' ? ' selected' : '') + '>' + (en ? 'Inactive' : 'غير نشط') + '</option>' +
            '</select></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Google Maps Link' : 'رابط Google Maps') + '</span><input type="text" id="kb-br-maps" class="input" placeholder="https://maps.google.com/..." value="' + esc(b.googleMapsUrl || '') + '" /></label>' +
        '</div>' +
        '<label class="rg-kb-field"><span>' + (en ? 'Full Address' : 'العنوان بالتفصيل') + '</span><input type="text" id="kb-br-addr" class="input" value="' + esc(b.fullAddress || '') + '" /></label>' +
        '<label class="rg-kb-field"><span>' + (en ? 'Available Services at Branch (comma-separated)' : 'الخدمات المتاحة في الفرع (مفصولة بفاصلة)') + '</span><input type="text" id="kb-br-services" class="input" placeholder="استلام مطار، توصيل، خدمة 24 ساعة" value="' + esc((b.services || []).join('، ')) + '" /></label>' +
        '<label class="rg-kb-field"><span>' + (en ? 'Branch Notes' : 'ملاحظات خاصة بالفرع') + '</span><textarea id="kb-br-notes" class="input" rows="2">' + esc(b.notes || '') + '</textarea></label>' +
        '<div class="rg-kb-modal-actions">' +
          '<button type="button" class="btn btn-ghost" id="kb-br-cancel">' + (en ? 'Cancel' : 'إلغاء') + '</button>' +
          '<button type="submit" class="btn btn-primary" id="kb-br-save">' + (en ? 'Save Branch' : 'حفظ الفرع') + '</button>' +
        '</div>' +
      '</form>';

    var m = openModal({
      title: existing ? (en ? 'Edit Branch' : 'تعديل بيانات الفرع') : (en ? 'Add New Branch' : 'إضافة فرع جديد'),
      size: 'lg',
      bodyHtml: bodyHtml
    });
    var form = document.getElementById('kb-branch-form');
    var cancelBtn = document.getElementById('kb-br-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { m.close(); });
    if (form) {
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var btn = document.getElementById('kb-br-save');
        if (btn) btn.disabled = true;
        try {
          await callApi('saveKbBranch', {
            id: b.id || '',
            companyId: document.getElementById('kb-br-cmp').value,
            branchName: document.getElementById('kb-br-name').value,
            city: document.getElementById('kb-br-city').value,
            district: document.getElementById('kb-br-district').value,
            fullAddress: document.getElementById('kb-br-addr').value,
            googleMapsUrl: document.getElementById('kb-br-maps').value,
            phone: document.getElementById('kb-br-phone').value,
            workingHours: document.getElementById('kb-br-hours').value,
            status: document.getElementById('kb-br-st').value,
            services: document.getElementById('kb-br-services').value,
            notes: document.getElementById('kb-br-notes').value
          });
          m.close();
          toast(ctx, en ? 'Branch saved successfully' : 'تم حفظ بيانات الفرع بنجاح', 'success');
          await refreshCurrentView(ctx, true);
        } catch (err) {
          toast(ctx, err.message, 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  function applyRichEditorCommand(editorEl, cmd, value) {
    if (!editorEl) return;
    editorEl.focus();
    try {
      if (cmd === 'h3' || cmd === 'p') {
        document.execCommand('formatBlock', false, cmd === 'h3' ? '<h3>' : '<p>');
      } else if (cmd === 'createLink') {
        var safe = sanitizeClientUrl(value, false);
        if (safe) document.execCommand('createLink', false, safe);
      } else {
        document.execCommand(cmd, false, value || null);
      }
    } catch (_eCmd) {}
  }

  function openPolicyModal(existing, ctx) {
    var en = isEn(ctx);
    var p = existing || {};
    var companies = getCompaniesListForFilter();
    var canPublish = canPerm(ctx, 'kb_publish_content');
    var defaultCat = p.category || (kbState.tab === 'company_policies'
      ? 'company_policy'
      : (kbState.tab === 'booking_pickup_terms'
          ? 'booking_terms'
          : (kbState.tab === 'cancellation_refunds' ? 'cancellation_policy' : 'rental_gate')));

    var attsText = (p.attachments || []).map(function (a) {
      return (a.label ? a.label + ' | ' : '') + a.url;
    }).join('\n');

    var bodyHtml =
      '<form id="kb-policy-form" class="rg-kb-modal-form">' +
        '<div class="rg-kb-form-grid">' +
          '<label class="rg-kb-field"><span>' + (en ? 'Policy Title *' : 'عنوان السياسة / الشرط *') + '</span><input type="text" id="kb-pol-title" class="input" required value="' + esc(p.title || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Category *' : 'التصنيف *') + '</span>' +
            '<select id="kb-pol-m-cat" class="input">' +
              POLICY_CATEGORIES.map(function (c) { return '<option value="' + esc(c.id) + '"' + (defaultCat === c.id ? ' selected' : '') + '>' + esc(lbl(c, ctx)) + '</option>'; }).join('') +
            '</select></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Linked Company (Optional)' : 'شركة التأجير المرتبطة (اختياري)') + '</span>' +
            '<select id="kb-pol-m-cmp" class="input"><option value="">' + (en ? 'General (All Companies)' : 'عام (بوابة التأجير / جميع الشركات)') + '</option>' +
              companies.map(function (c) { return '<option value="' + esc(c.id) + '"' + (p.companyId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
            '</select></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'City (Optional)' : 'المدينة المرتبطة (اختياري)') + '</span><input type="text" id="kb-pol-m-city" class="input" value="' + esc(p.city || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Keywords (comma-separated)' : 'الكلمات المفتاحية (مفصولة بفاصلة)') + '</span><input type="text" id="kb-pol-m-kw" class="input" placeholder="تأمين، رخصة، عمر، إلغاء" value="' + esc((p.keywords || []).join('، ')) + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Publish Status' : 'حالة النشر') + '</span>' +
            '<select id="kb-pol-m-pub" class="input"' + (!canPublish ? ' disabled' : '') + '>' +
              '<option value="published"' + (p.publishStatus !== 'draft' && p.publishStatus !== 'archived' ? ' selected' : '') + '>' + (en ? 'Published' : 'منشور') + '</option>' +
              '<option value="draft"' + (p.publishStatus === 'draft' ? ' selected' : '') + '>' + (en ? 'Draft' : 'مسودة') + '</option>' +
              '<option value="archived"' + (p.publishStatus === 'archived' ? ' selected' : '') + '>' + (en ? 'Archived' : 'مؤرشف') + '</option>' +
            '</select></label>' +
        '</div>' +
        '<div class="rg-kb-field">' +
          '<span>' + (en ? 'Policy Content (Rich Text) *' : 'تفاصيل السياسة (محرر نصوص منسق) *') + '</span>' +
          '<div class="rg-kb-rte-toolbar" role="toolbar">' +
            '<button type="button" class="btn btn-xs btn-ghost" data-rte-cmd="bold"><strong>B</strong></button>' +
            '<button type="button" class="btn btn-xs btn-ghost" data-rte-cmd="italic"><em>I</em></button>' +
            '<button type="button" class="btn btn-xs btn-ghost" data-rte-cmd="underline"><u>U</u></button>' +
            '<button type="button" class="btn btn-xs btn-ghost" data-rte-cmd="h3">H3</button>' +
            '<button type="button" class="btn btn-xs btn-ghost" data-rte-cmd="p">P</button>' +
            '<button type="button" class="btn btn-xs btn-ghost" data-rte-cmd="insertUnorderedList">' + (en ? '• List' : '• قائمة') + '</button>' +
            '<button type="button" class="btn btn-xs btn-ghost" data-rte-cmd="insertOrderedList">' + (en ? '1. List' : '1. قائمة') + '</button>' +
            '<button type="button" class="btn btn-xs btn-ghost" data-rte-cmd="removeFormat">' + (en ? 'Clear' : 'مسح التنسيق') + '</button>' +
          '</div>' +
          '<div id="kb-pol-rte" class="rg-kb-rte-editor" contenteditable="true" dir="' + (en ? 'ltr' : 'rtl') + '">' +
            sanitizeDisplayHtml(p.descriptionHtml || p.descriptionText || '') +
          '</div>' +
        '</div>' +
        '<label class="rg-kb-field"><span>' + (en ? 'Attachments / Reference Links (Label | URL per line)' : 'المرفقات والروابط (مثال: اسم الرابط | https://... كل رابط في سطر)') + '</span>' +
          '<textarea id="kb-pol-m-atts" class="input" rows="2" placeholder="دليل التسليم | https://...">' + esc(attsText) + '</textarea></label>' +
        '<div class="rg-kb-modal-actions">' +
          '<button type="button" class="btn btn-ghost" id="kb-pol-cancel">' + (en ? 'Cancel' : 'إلغاء') + '</button>' +
          '<button type="submit" class="btn btn-primary" id="kb-pol-save">' + (en ? 'Save Policy' : 'حفظ السياسة') + '</button>' +
        '</div>' +
      '</form>';

    var m = openModal({
      title: existing ? (en ? 'Edit Policy' : 'تعديل السياسة / الشرط') : (en ? 'Add Policy / Term' : 'إضافة سياسة أو شرط جديد'),
      size: 'lg',
      bodyHtml: bodyHtml
    });

    var rte = document.getElementById('kb-pol-rte');
    document.querySelectorAll('[data-rte-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyRichEditorCommand(rte, btn.getAttribute('data-rte-cmd'));
      });
    });
    var cancelBtn = document.getElementById('kb-pol-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { m.close(); });
    var form = document.getElementById('kb-policy-form');
    if (form) {
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var btn = document.getElementById('kb-pol-save');
        if (btn) btn.disabled = true;
        try {
          var rawAtts = String(document.getElementById('kb-pol-m-atts').value || '').split(/\n+/).map(function (ln) {
            var trimmed = ln.trim();
            if (!trimmed) return null;
            var parts = trimmed.split('|');
            if (parts.length >= 2) {
              return { label: parts[0].trim(), url: parts.slice(1).join('|').trim() };
            }
            return { label: trimmed, url: trimmed };
          }).filter(Boolean);
          var selCat = document.getElementById('kb-pol-m-cat').value;
          var catInfo = POLICY_CATEGORIES.find(function (x) { return x.id === selCat; });
          var savedRes = await callApi('saveKbPolicy', {
            id: p.id || '',
            title: document.getElementById('kb-pol-title').value,
            category: selCat,
            sectionKey: catInfo ? catInfo.section : kbState.tab,
            companyId: document.getElementById('kb-pol-m-cmp').value,
            city: document.getElementById('kb-pol-m-city').value,
            keywords: document.getElementById('kb-pol-m-kw').value,
            publishStatus: document.getElementById('kb-pol-m-pub').value,
            descriptionHtml: rte ? rte.innerHTML : '',
            attachments: rawAtts
          });
          m.close();
          if (savedRes && savedRes.policy && savedRes.policy.sectionKey && isPolicySection(savedRes.policy.sectionKey)) {
            kbState.tab = savedRes.policy.sectionKey;
            kbState.expandedPolicyIds[savedRes.policy.id] = true;
          }
          toast(ctx, en ? 'Policy saved successfully' : 'تم حفظ السياسة بنجاح', 'success');
          await refreshCurrentView(ctx, true);
        } catch (err) {
          toast(ctx, err.message, 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  function openFaqModal(existing, ctx) {
    var en = isEn(ctx);
    var f = existing || {};
    var companies = getCompaniesListForFilter();
    var bodyHtml =
      '<form id="kb-faq-form" class="rg-kb-modal-form">' +
        '<label class="rg-kb-field"><span>' + (en ? 'Question *' : 'السؤال *') + '</span><input type="text" id="kb-faq-m-q" class="input" required value="' + esc(f.question || '') + '" /></label>' +
        '<div class="rg-kb-form-grid">' +
          '<label class="rg-kb-field"><span>' + (en ? 'Category' : 'التصنيف') + '</span>' +
            '<select id="kb-faq-m-cat" class="input">' +
              FAQ_CATEGORIES.map(function (c) { return '<option value="' + esc(c.id) + '"' + ((f.category || 'general') === c.id ? ' selected' : '') + '>' + esc(lbl(c, ctx)) + '</option>'; }).join('') +
            '</select></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Linked Company (Optional)' : 'شركة التأجير (اختياري)') + '</span>' +
            '<select id="kb-faq-m-cmp" class="input"><option value="">' + (en ? 'General' : 'عام') + '</option>' +
              companies.map(function (c) { return '<option value="' + esc(c.id) + '"' + (f.companyId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
            '</select></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Keywords' : 'كلمات مفتاحية') + '</span><input type="text" id="kb-faq-m-kw" class="input" value="' + esc((f.keywords || []).join('، ')) + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Status' : 'حالة النشر') + '</span>' +
            '<select id="kb-faq-m-pub" class="input">' +
              '<option value="published"' + (f.publishStatus !== 'draft' && f.publishStatus !== 'archived' ? ' selected' : '') + '>' + (en ? 'Published' : 'منشور') + '</option>' +
              '<option value="draft"' + (f.publishStatus === 'draft' ? ' selected' : '') + '>' + (en ? 'Draft' : 'مسودة') + '</option>' +
              '<option value="archived"' + (f.publishStatus === 'archived' ? ' selected' : '') + '>' + (en ? 'Archived' : 'مؤرشف') + '</option>' +
            '</select></label>' +
        '</div>' +
        '<label class="rg-kb-field"><span>' + (en ? 'Answer *' : 'الإجابة *') + '</span>' +
          '<textarea id="kb-faq-m-ans" class="input" rows="5" required>' + esc(f.answerText || '') + '</textarea></label>' +
        '<div class="rg-kb-modal-actions">' +
          '<button type="button" class="btn btn-ghost" id="kb-faq-cancel">' + (en ? 'Cancel' : 'إلغاء') + '</button>' +
          '<button type="submit" class="btn btn-primary" id="kb-faq-save">' + (en ? 'Save FAQ' : 'حفظ السؤال') + '</button>' +
        '</div>' +
      '</form>';

    var m = openModal({
      title: existing ? (en ? 'Edit FAQ' : 'تعديل السؤال الشائع') : (en ? 'Add FAQ' : 'إضافة سؤال شائع'),
      size: 'lg',
      bodyHtml: bodyHtml
    });
    var cancelBtn = document.getElementById('kb-faq-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { m.close(); });
    var form = document.getElementById('kb-faq-form');
    if (form) {
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var btn = document.getElementById('kb-faq-save');
        if (btn) btn.disabled = true;
        try {
          await callApi('saveKbFaq', {
            id: f.id || '',
            question: document.getElementById('kb-faq-m-q').value,
            category: document.getElementById('kb-faq-m-cat').value,
            companyId: document.getElementById('kb-faq-m-cmp').value,
            keywords: document.getElementById('kb-faq-m-kw').value,
            publishStatus: document.getElementById('kb-faq-m-pub').value,
            answerText: document.getElementById('kb-faq-m-ans').value
          });
          m.close();
          toast(ctx, en ? 'FAQ saved successfully' : 'تم حفظ السؤال الشائع بنجاح', 'success');
          await refreshCurrentView(ctx, true);
        } catch (err) {
          toast(ctx, err.message, 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  function openQuickReplyModal(existing, ctx) {
    var en = isEn(ctx);
    var qr = existing || {};
    var companies = getCompaniesListForFilter();
    var bodyHtml =
      '<form id="kb-qr-form" class="rg-kb-modal-form">' +
        '<div class="rg-kb-form-grid">' +
          '<label class="rg-kb-field"><span>' + (en ? 'Reply Title *' : 'اسم / عنوان الرد الجاهز *') + '</span><input type="text" id="kb-qr-m-title" class="input" required value="' + esc(qr.title || '') + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Category' : 'التصنيف') + '</span>' +
            '<select id="kb-qr-m-cat" class="input">' +
              QUICK_REPLY_CATEGORIES.map(function (c) { return '<option value="' + esc(c.id) + '"' + ((qr.category || 'greeting') === c.id ? ' selected' : '') + '>' + esc(lbl(c, ctx)) + '</option>'; }).join('') +
            '</select></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Language' : 'اللغة') + '</span>' +
            '<select id="kb-qr-m-lang" class="input">' +
              '<option value="ar"' + (qr.language !== 'en' ? ' selected' : '') + '>العربية (AR)</option>' +
              '<option value="en"' + (qr.language === 'en' ? ' selected' : '') + '>English (EN)</option>' +
            '</select></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Linked Company (Optional)' : 'شركة التأجير (اختياري)') + '</span>' +
            '<select id="kb-qr-m-cmp" class="input"><option value="">' + (en ? 'General' : 'عام') + '</option>' +
              companies.map(function (c) { return '<option value="' + esc(c.id) + '"' + (qr.companyId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') +
            '</select></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Keywords' : 'الكلمات المفتاحية') + '</span><input type="text" id="kb-qr-m-kw" class="input" value="' + esc((qr.keywords || []).join('، ')) + '" /></label>' +
          '<label class="rg-kb-field"><span>' + (en ? 'Status' : 'الحالة') + '</span>' +
            '<select id="kb-qr-m-st" class="input">' +
              '<option value="active"' + (qr.status !== 'draft' && qr.status !== 'archived' ? ' selected' : '') + '>' + (en ? 'Active' : 'مفعل') + '</option>' +
              '<option value="draft"' + (qr.status === 'draft' ? ' selected' : '') + '>' + (en ? 'Draft' : 'مسودة') + '</option>' +
              '<option value="archived"' + (qr.status === 'archived' ? ' selected' : '') + '>' + (en ? 'Archived' : 'مؤرشف') + '</option>' +
            '</select></label>' +
        '</div>' +
        '<div class="rg-kb-field">' +
          '<span>' + (en ? 'Insert Dynamic Variable:' : 'إدراج متغير تلقائي:') + '</span>' +
          '<div class="rg-kb-var-chips">' +
            DYNAMIC_VARS.map(function (dv) {
              return '<button type="button" class="btn btn-xs btn-ghost" data-kb-insert-var="' + esc(dv.token) + '">+ ' + esc(lbl(dv, ctx)) + ' ' + esc(dv.token) + '</button>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<label class="rg-kb-field"><span>' + (en ? 'Message Text *' : 'نص الرسالة الجاهزة *') + '</span>' +
          '<textarea id="kb-qr-m-msg" class="input" rows="5" required placeholder="أهلاً {customer_name}، بخصوص حجزكم رقم {booking_number}...">' + esc(qr.messageText || '') + '</textarea></label>' +
        '<div class="rg-kb-modal-actions">' +
          '<button type="button" class="btn btn-ghost" id="kb-qr-cancel">' + (en ? 'Cancel' : 'إلغاء') + '</button>' +
          '<button type="submit" class="btn btn-primary" id="kb-qr-save">' + (en ? 'Save Quick Reply' : 'حفظ الرد الجاهز') + '</button>' +
        '</div>' +
      '</form>';

    var m = openModal({
      title: existing ? (en ? 'Edit Quick Reply' : 'تعديل الرد الجاهز') : (en ? 'Add Quick Reply' : 'إضافة رد جاهز جديد'),
      size: 'lg',
      bodyHtml: bodyHtml
    });
    var msgBox = document.getElementById('kb-qr-m-msg');
    document.querySelectorAll('[data-kb-insert-var]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!msgBox) return;
        var tok = btn.getAttribute('data-kb-insert-var') || '';
        var start = msgBox.selectionStart || msgBox.value.length;
        var end = msgBox.selectionEnd || msgBox.value.length;
        msgBox.value = msgBox.value.slice(0, start) + tok + msgBox.value.slice(end);
        msgBox.focus();
      });
    });
    var cancelBtn = document.getElementById('kb-qr-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { m.close(); });
    var form = document.getElementById('kb-qr-form');
    if (form) {
      form.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var btn = document.getElementById('kb-qr-save');
        if (btn) btn.disabled = true;
        try {
          await callApi('saveKbQuickReply', {
            id: qr.id || '',
            title: document.getElementById('kb-qr-m-title').value,
            category: document.getElementById('kb-qr-m-cat').value,
            language: document.getElementById('kb-qr-m-lang').value,
            companyId: document.getElementById('kb-qr-m-cmp').value,
            keywords: document.getElementById('kb-qr-m-kw').value,
            status: document.getElementById('kb-qr-m-st').value,
            messageText: document.getElementById('kb-qr-m-msg').value
          });
          m.close();
          toast(ctx, en ? 'Quick reply saved successfully' : 'تم حفظ الرد الجاهز بنجاح', 'success');
          await refreshCurrentView(ctx, true);
        } catch (err) {
          toast(ctx, err.message, 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  function openFillAndCopyReplyModal(qr, ctx) {
    var en = isEn(ctx);
    var vars = extractTemplateVariables(qr.messageText);
    var fieldsHtml = vars.map(function (vk) {
      var meta = DYNAMIC_VARS.find(function (d) { return d.key === vk; });
      return (
        '<label class="rg-kb-field">' +
          '<span>' + esc(meta ? lbl(meta, ctx) : vk) + ' <code>{' + esc(vk) + '}</code></span>' +
          '<input type="text" class="input" data-kb-fill-var="' + esc(vk) + '" value="' + esc(kbState.quickVarValues[vk] || '') + '" />' +
        '</label>'
      );
    }).join('');

    var m = openModal({
      title: (en ? 'Substitute & Copy: ' : 'تعبئة المتغيرات ونسخ الرد: ') + qr.title,
      size: 'md',
      bodyHtml:
        '<div class="rg-kb-modal-form">' +
          '<div class="rg-kb-form-grid">' + fieldsHtml + '</div>' +
          '<label class="rg-kb-field">' +
            '<span>' + (en ? 'Final Preview (Copied to Clipboard Only)' : 'معاينة النص النهائي (للنسخ اليدوي فقط)') + '</span>' +
            '<textarea id="kb-fill-preview" class="input" rows="4" readonly>' + esc(substituteQuickVariables(qr.messageText, kbState.quickVarValues)) + '</textarea>' +
          '</label>' +
          '<div class="rg-kb-modal-actions">' +
            '<button type="button" class="btn btn-ghost" id="kb-fill-cancel">' + (en ? 'Cancel' : 'إلغاء') + '</button>' +
            '<button type="button" class="btn btn-primary" id="kb-fill-copy-btn">' + (en ? 'Copy Final Message' : 'نسخ النص النهائي') + '</button>' +
          '</div>' +
        '</div>'
    });

    var previewEl = document.getElementById('kb-fill-preview');
    function updatePreview() {
      var localVars = Object.assign({}, kbState.quickVarValues);
      document.querySelectorAll('[data-kb-fill-var]').forEach(function (inp) {
        var k = inp.getAttribute('data-kb-fill-var');
        localVars[k] = inp.value;
        kbState.quickVarValues[k] = inp.value;
      });
      if (previewEl) previewEl.value = substituteQuickVariables(qr.messageText, localVars);
    }
    document.querySelectorAll('[data-kb-fill-var]').forEach(function (inp) {
      inp.addEventListener('input', updatePreview);
    });
    var cancelBtn = document.getElementById('kb-fill-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { m.close(); });
    var copyBtn = document.getElementById('kb-fill-copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async function () {
        updatePreview();
        var ok = await copyToClipboard(previewEl ? previewEl.value : qr.messageText, ctx, en ? 'Quick reply copied' : 'تم نسخ الرد الجاهز بنجاح');
        if (ok) {
          await callApi('recordKbQuickReplyUsage', { id: qr.id }).catch(function () {});
          m.close();
          await refreshCurrentView(ctx, true);
        }
      });
    }
  }

  async function openAuditHistoryModal(ctx) {
    var en = isEn(ctx);
    try {
      var data = await callApi('getKbAuditHistory', { page: 1, pageSize: 40 });
      var items = (data && data.items) || [];
      openModal({
        title: en ? 'Knowledge Base Audit & Revision Log' : 'سجل التعديلات والمراجعات لمركز المعرفة',
        size: 'lg',
        bodyHtml: !items.length
          ? '<div class="empty-state" style="padding:28px;">' + (en ? 'No revisions recorded yet.' : 'لا توجد تعديلات مسجلة بعد.') + '</div>'
          : '<div class="rg-kb-audit-list">' +
              items.map(function (it) {
                return (
                  '<div class="rg-kb-audit-row">' +
                    '<div>' +
                      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                        '<span class="rg-kb-badge is-neutral">' + esc(it.actionType) + '</span>' +
                        '<strong>' + esc(it.titleSnapshot || it.entityId) + '</strong>' +
                      '</div>' +
                      '<div class="rg-kb-muted-txt" style="margin-top:4px;">' +
                        esc(it.actorName || '-') + ' · ' + esc(fmtDate(it.createdAt, ctx)) +
                      '</div>' +
                    '</div>' +
                  '</div>'
                );
              }).join('') +
            '</div>'
      });
    } catch (err) {
      toast(ctx, err.message, 'error');
    }
  }

  async function exportBackupJson(ctx) {
    var en = isEn(ctx);
    try {
      var data = await callApi('exportKbBackup', {});
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'rental-gate-kb-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast(ctx, en ? 'Knowledge Base backup downloaded' : 'تم تنزيل نسخة احتياطية من مركز المعرفة', 'success');
    } catch (err) {
      toast(ctx, err.message, 'error');
    }
  }

  async function confirmAndDelete(entityLabel, action, id, ctx) {
    var en = isEn(ctx);
    var m = openModal({
      title: en ? 'Confirm Deletion' : 'تأكيد الحذف',
      size: 'sm',
      bodyHtml:
        '<p style="margin:0 0 16px;">' + (en ? 'Are you sure you want to delete this ' + entityLabel + '? Revisions remain preserved in the audit log.' : 'هل أنت متأكد من حذف ' + entityLabel + '؟ سيظل سجل التعديل محفوظاً في الأرشيف.') + '</p>' +
        '<div class="rg-kb-modal-actions">' +
          '<button type="button" class="btn btn-ghost" id="kb-del-cancel">' + (en ? 'Cancel' : 'إلغاء') + '</button>' +
          '<button type="button" class="btn btn-danger" id="kb-del-confirm">' + (en ? 'Delete' : 'تأكيد الحذف') + '</button>' +
        '</div>'
    });
    var cancelBtn = document.getElementById('kb-del-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function () { m.close(); });
    var confBtn = document.getElementById('kb-del-confirm');
    if (confBtn) {
      confBtn.addEventListener('click', async function () {
        confBtn.disabled = true;
        try {
          await callApi(action, { id: id });
          m.close();
          toast(ctx, en ? 'Deleted successfully' : 'تم الحذف بنجاح', 'success');
          if (action === 'deleteKbCompany' && kbState.selectedCompanyId === id) {
            kbState.selectedCompanyId = '';
            kbState.selectedCompanyDetail = null;
          }
          await refreshCurrentView(ctx, true);
        } catch (err) {
          toast(ctx, err.message, 'error');
          confBtn.disabled = false;
        }
      });
    }
  }

  function renderPanelOnly(slot, ctx) {
    var panel = document.getElementById('kb-tab-panel');
    if (!panel) return;
    if (kbState.tab === 'overview') panel.innerHTML = renderOverviewHtml(ctx);
    else if (kbState.tab === 'companies') panel.innerHTML = renderCompaniesHtml(ctx);
    else if (kbState.tab === 'branches') panel.innerHTML = renderBranchesDirectoryHtml(ctx);
    else if (isPolicySection(kbState.tab)) panel.innerHTML = renderPoliciesHtml(ctx);
    else if (kbState.tab === 'faq') panel.innerHTML = renderFaqHtml(ctx);
    else if (kbState.tab === 'quick_replies') panel.innerHTML = renderQuickRepliesHtml(ctx);
    bindPanelEvents(slot, ctx);
  }

  async function refreshCurrentView(ctx, forceRefresh) {
    var slot = document.querySelector('#page-content .route-view') || document.getElementById('page-content');
    if (!slot) return;
    await loadTabData(Boolean(forceRefresh));
    renderPanelOnly(slot, ctx);
    if (kbState.searchQuery || kbState.searchCompanyId || kbState.searchCity || kbState.searchContentType !== 'all') {
      runLiveSearch(ctx);
    }
  }

  async function runLiveSearch(ctx) {
    var hasFilter = Boolean(kbState.searchQuery || kbState.searchCompanyId || kbState.searchCity || (kbState.searchContentType && kbState.searchContentType !== 'all'));
    if (!hasFilter) {
      kbState.searchResults = null;
      var oldBox = document.querySelector('[data-testid="kb-live-search-results"]');
      if (oldBox) oldBox.remove();
      return;
    }
    try {
      kbState.searchResults = await callApi('searchKnowledgeBase', {
        query: kbState.searchQuery,
        contentType: kbState.searchContentType,
        companyId: kbState.searchCompanyId,
        city: kbState.searchCity,
        category: kbState.searchCategory,
        limit: 40
      });
      var hero = document.querySelector('.rg-kb-hero');
      if (hero) {
        var existingBox = hero.querySelector('[data-testid="kb-live-search-results"]');
        if (existingBox) existingBox.remove();
        var html = renderLiveSearchResultsHtml(ctx);
        if (html) hero.insertAdjacentHTML('beforeend', html);
        bindJumpEvents(ctx);
      }
    } catch (_eSrch) {}
  }

  function bindJumpEvents(ctx) {
    document.querySelectorAll('[data-kb-jump-section]').forEach(function (el) {
      if (el._kbJumpBound) return;
      el._kbJumpBound = true;
      el.addEventListener('click', async function () {
        var sec = el.getAttribute('data-kb-jump-section') || 'overview';
        var eid = el.getAttribute('data-kb-jump-id') || '';
        var etype = el.getAttribute('data-kb-jump-type') || '';
        var compId = el.getAttribute('data-kb-jump-company') || '';
        kbState.highlightEntityId = eid;
        if (etype === 'company') {
          kbState.tab = 'companies';
          kbState.selectedCompanyId = eid;
        } else if (etype === 'branch') {
          if (compId) {
            kbState.tab = 'companies';
            kbState.selectedCompanyId = compId;
          } else {
            kbState.tab = 'branches';
          }
        } else if (etype === 'policy') {
          kbState.tab = isPolicySection(sec) ? sec : 'rental_gate_policies';
          kbState.expandedPolicyIds[eid] = true;
          callApi('recordKbPolicyView', { id: eid, fromSearch: true }).catch(function () {});
        } else if (etype === 'faq') {
          kbState.tab = 'faq';
          kbState.expandedFaqIds[eid] = true;
          callApi('recordKbFaqUsage', { id: eid, fromSearch: true }).catch(function () {});
        } else if (etype === 'quick_reply') {
          kbState.tab = 'quick_replies';
        } else {
          kbState.tab = sec;
        }
        var slot = document.querySelector('#page-content .route-view') || document.getElementById('page-content');
        if (slot) await render(slot, ctx);
      });
    });
  }

  function bindShellEvents(slot, ctx) {
    slot.querySelectorAll('[data-kb-tab]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var nextTab = btn.getAttribute('data-kb-tab');
        if (!nextTab) return;
        kbState.tab = nextTab;
        if (nextTab !== 'companies') kbState.selectedCompanyId = '';
        kbState.highlightEntityId = '';
        await render(slot, ctx);
      });
    });

    var gSearch = document.getElementById('kb-global-search-input');
    if (gSearch) {
      gSearch.addEventListener('input', function () {
        kbState.searchQuery = gSearch.value;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { runLiveSearch(ctx); }, 220);
      });
    }
    var gType = document.getElementById('kb-global-type');
    if (gType) gType.addEventListener('change', function () { kbState.searchContentType = gType.value; runLiveSearch(ctx); });
    var gCmp = document.getElementById('kb-global-company');
    if (gCmp) gCmp.addEventListener('change', function () { kbState.searchCompanyId = gCmp.value; runLiveSearch(ctx); });
    var gCity = document.getElementById('kb-global-city');
    if (gCity) gCity.addEventListener('change', function () { kbState.searchCity = gCity.value; runLiveSearch(ctx); });

    slot.querySelectorAll('[data-kb-action="clear-global-search"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        kbState.searchQuery = '';
        kbState.searchContentType = 'all';
        kbState.searchCompanyId = '';
        kbState.searchCity = '';
        kbState.searchResults = null;
        if (gSearch) gSearch.value = '';
        if (gType) gType.value = 'all';
        if (gCmp) gCmp.value = '';
        if (gCity) gCity.value = '';
        runLiveSearch(ctx);
      });
    });

    var auditBtn = slot.querySelector('[data-kb-action="audit-history"]');
    if (auditBtn) auditBtn.addEventListener('click', function () { openAuditHistoryModal(ctx); });
    var backupBtn = slot.querySelector('[data-kb-action="export-backup"]');
    if (backupBtn) backupBtn.addEventListener('click', function () { exportBackupJson(ctx); });
    var qCreateBtn = slot.querySelector('[data-kb-action="quick-create"]');
    if (qCreateBtn) {
      qCreateBtn.addEventListener('click', function () {
        if (kbState.tab === 'companies' && canPerm(ctx, 'kb_manage_companies')) openCompanyModal(null, ctx);
        else if (kbState.tab === 'branches' && canPerm(ctx, 'kb_manage_companies')) openBranchModal(null, '', ctx);
        else if (isPolicySection(kbState.tab) && canPerm(ctx, 'kb_manage_policies')) openPolicyModal(null, ctx);
        else if (kbState.tab === 'faq' && canPerm(ctx, 'kb_manage_faqs')) openFaqModal(null, ctx);
        else if (kbState.tab === 'quick_replies' && canPerm(ctx, 'kb_manage_quick_replies')) openQuickReplyModal(null, ctx);
        else if (canPerm(ctx, 'kb_manage_companies')) openCompanyModal(null, ctx);
        else if (canPerm(ctx, 'kb_manage_policies')) openPolicyModal(null, ctx);
        else if (canPerm(ctx, 'kb_manage_faqs')) openFaqModal(null, ctx);
        else if (canPerm(ctx, 'kb_manage_quick_replies')) openQuickReplyModal(null, ctx);
      });
    }
  }

  function bindPanelEvents(slot, ctx) {
    var en = isEn(ctx);
    bindJumpEvents(ctx);

    slot.querySelectorAll('#kb-tab-panel [data-kb-tab]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        kbState.tab = btn.getAttribute('data-kb-tab') || 'overview';
        await render(slot, ctx);
      });
    });

    // Companies filters & actions
    var compSearch = document.getElementById('kb-comp-search');
    if (compSearch) {
      compSearch.addEventListener('input', function () {
        kbState.companies.search = compSearch.value;
        kbState.companies.page = 1;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { refreshCurrentView(ctx, false); }, 220);
      });
    }
    var compCity = document.getElementById('kb-comp-city');
    if (compCity) compCity.addEventListener('change', function () { kbState.companies.city = compCity.value; kbState.companies.page = 1; refreshCurrentView(ctx, false); });
    var compStatus = document.getElementById('kb-comp-status');
    if (compStatus) compStatus.addEventListener('change', function () { kbState.companies.status = compStatus.value; kbState.companies.page = 1; refreshCurrentView(ctx, false); });
    var addCompBtn = slot.querySelector('[data-kb-action="add-company"]');
    if (addCompBtn) addCompBtn.addEventListener('click', function () { openCompanyModal(null, ctx); });

    slot.querySelectorAll('[data-kb-open-company]').forEach(function (el) {
      el.addEventListener('click', async function () {
        kbState.selectedCompanyId = el.getAttribute('data-kb-open-company') || '';
        kbState.companyBranchCityFilter = '';
        kbState.companyBranchSearch = '';
        await refreshCurrentView(ctx, false);
      });
    });
    var backCompBtn = slot.querySelector('[data-kb-action="back-to-companies"]');
    if (backCompBtn) {
      backCompBtn.addEventListener('click', async function () {
        kbState.selectedCompanyId = '';
        kbState.selectedCompanyDetail = null;
        await refreshCurrentView(ctx, false);
      });
    }
    slot.querySelectorAll('[data-kb-edit-company]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var cid = btn.getAttribute('data-kb-edit-company');
        var found = (kbState.selectedCompanyDetail && kbState.selectedCompanyDetail.id === cid)
          ? kbState.selectedCompanyDetail
          : (kbState.companies.items || []).find(function (x) { return x.id === cid; });
        openCompanyModal(found, ctx);
      });
    });
    slot.querySelectorAll('[data-kb-delete-company]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        confirmAndDelete(en ? 'rental company' : 'شركة التأجير', 'deleteKbCompany', btn.getAttribute('data-kb-delete-company'), ctx);
      });
    });
    slot.querySelectorAll('[data-kb-add-branch-for]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openBranchModal(null, btn.getAttribute('data-kb-add-branch-for'), ctx);
      });
    });
    var cbSearch = document.getElementById('kb-comp-branch-search');
    if (cbSearch) {
      cbSearch.addEventListener('input', function () {
        kbState.companyBranchSearch = cbSearch.value;
        renderPanelOnly(slot, ctx);
        var nextInp = document.getElementById('kb-comp-branch-search');
        if (nextInp) { nextInp.focus(); nextInp.setSelectionRange(nextInp.value.length, nextInp.value.length); }
      });
    }
    var cbCity = document.getElementById('kb-comp-branch-city');
    if (cbCity) {
      cbCity.addEventListener('change', function () {
        kbState.companyBranchCityFilter = cbCity.value;
        renderPanelOnly(slot, ctx);
      });
    }

    // Branches directory
    var brSearch = document.getElementById('kb-br-search');
    if (brSearch) {
      brSearch.addEventListener('input', function () {
        kbState.branches.search = brSearch.value;
        kbState.branches.page = 1;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { refreshCurrentView(ctx, false); }, 220);
      });
    }
    var brCmp = document.getElementById('kb-br-company');
    if (brCmp) brCmp.addEventListener('change', function () { kbState.branches.companyId = brCmp.value; kbState.branches.page = 1; refreshCurrentView(ctx, false); });
    var brCity = document.getElementById('kb-br-city');
    if (brCity) brCity.addEventListener('change', function () { kbState.branches.city = brCity.value; kbState.branches.page = 1; refreshCurrentView(ctx, false); });
    var brSt = document.getElementById('kb-br-status');
    if (brSt) brSt.addEventListener('change', function () { kbState.branches.status = brSt.value; kbState.branches.page = 1; refreshCurrentView(ctx, false); });
    var addBrBtn = slot.querySelector('[data-kb-action="add-branch"]');
    if (addBrBtn) addBrBtn.addEventListener('click', function () { openBranchModal(null, kbState.branches.companyId || '', ctx); });

    slot.querySelectorAll('[data-kb-edit-branch]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var bid = btn.getAttribute('data-kb-edit-branch');
        var list = (kbState.selectedCompanyDetail && kbState.selectedCompanyDetail.branches) || kbState.branches.items || [];
        var found = list.find(function (x) { return x.id === bid; });
        openBranchModal(found, '', ctx);
      });
    });
    slot.querySelectorAll('[data-kb-delete-branch]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        confirmAndDelete(en ? 'branch' : 'الفرع', 'deleteKbBranch', btn.getAttribute('data-kb-delete-branch'), ctx);
      });
    });

    // Policies
    var polSearch = document.getElementById('kb-pol-search');
    if (polSearch) {
      polSearch.addEventListener('input', function () {
        kbState.policies.search = polSearch.value;
        kbState.policies.page = 1;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { refreshCurrentView(ctx, false); }, 220);
      });
    }
    var polCat = document.getElementById('kb-pol-cat');
    if (polCat) polCat.addEventListener('change', function () { kbState.policies.category = polCat.value; kbState.policies.page = 1; refreshCurrentView(ctx, false); });
    var polCmp = document.getElementById('kb-pol-company');
    if (polCmp) polCmp.addEventListener('change', function () { kbState.policies.companyId = polCmp.value; kbState.policies.page = 1; refreshCurrentView(ctx, false); });
    var polCity = document.getElementById('kb-pol-city');
    if (polCity) polCity.addEventListener('change', function () { kbState.policies.city = polCity.value; kbState.policies.page = 1; refreshCurrentView(ctx, false); });
    var polPub = document.getElementById('kb-pol-status');
    if (polPub) polPub.addEventListener('change', function () { kbState.policies.publishStatus = polPub.value; kbState.policies.page = 1; refreshCurrentView(ctx, false); });
    var addPolBtn = slot.querySelector('[data-kb-action="add-policy"]');
    if (addPolBtn) addPolBtn.addEventListener('click', function () { openPolicyModal(null, ctx); });

    slot.querySelectorAll('[data-kb-toggle-policy]').forEach(function (el) {
      el.addEventListener('click', function () {
        var pid = el.getAttribute('data-kb-toggle-policy');
        var nextOpen = !kbState.expandedPolicyIds[pid];
        kbState.expandedPolicyIds[pid] = nextOpen;
        if (nextOpen) callApi('recordKbPolicyView', { id: pid }).catch(function () {});
        renderPanelOnly(slot, ctx);
      });
    });
    slot.querySelectorAll('[data-kb-copy-policy]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var pid = btn.getAttribute('data-kb-copy-policy');
        var found = (kbState.policies.items || []).find(function (x) { return x.id === pid; });
        if (!found) return;
        await copyToClipboard(found.title + '\n\n' + (found.descriptionText || ''), ctx);
      });
    });
    slot.querySelectorAll('[data-kb-edit-policy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var pid = btn.getAttribute('data-kb-edit-policy');
        var found = (kbState.policies.items || []).find(function (x) { return x.id === pid; });
        openPolicyModal(found, ctx);
      });
    });
    slot.querySelectorAll('[data-kb-delete-policy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        confirmAndDelete(en ? 'policy' : 'السياسة', 'deleteKbPolicy', btn.getAttribute('data-kb-delete-policy'), ctx);
      });
    });

    // FAQs
    var faqSearch = document.getElementById('kb-faq-search');
    if (faqSearch) {
      faqSearch.addEventListener('input', function () {
        kbState.faqs.search = faqSearch.value;
        kbState.faqs.page = 1;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { refreshCurrentView(ctx, false); }, 220);
      });
    }
    var faqCat = document.getElementById('kb-faq-cat');
    if (faqCat) faqCat.addEventListener('change', function () { kbState.faqs.category = faqCat.value; kbState.faqs.page = 1; refreshCurrentView(ctx, false); });
    var faqCmp = document.getElementById('kb-faq-company');
    if (faqCmp) faqCmp.addEventListener('change', function () { kbState.faqs.companyId = faqCmp.value; kbState.faqs.page = 1; refreshCurrentView(ctx, false); });
    var faqSort = document.getElementById('kb-faq-sort');
    if (faqSort) faqSort.addEventListener('change', function () { kbState.faqs.sortBy = faqSort.value; kbState.faqs.page = 1; refreshCurrentView(ctx, false); });
    var addFaqBtn = slot.querySelector('[data-kb-action="add-faq"]');
    if (addFaqBtn) addFaqBtn.addEventListener('click', function () { openFaqModal(null, ctx); });

    slot.querySelectorAll('[data-kb-toggle-faq]').forEach(function (el) {
      el.addEventListener('click', function () {
        var fid = el.getAttribute('data-kb-toggle-faq');
        kbState.expandedFaqIds[fid] = !kbState.expandedFaqIds[fid];
        renderPanelOnly(slot, ctx);
      });
    });
    slot.querySelectorAll('[data-kb-copy-faq]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var fid = btn.getAttribute('data-kb-copy-faq');
        var found = (kbState.faqs.items || []).concat(kbState.faqs.mostSearchedHighlights || []).find(function (x) { return x.id === fid; });
        if (!found) return;
        var ok = await copyToClipboard(found.answerText || '', ctx, en ? 'FAQ answer copied' : 'تم نسخ إجابة السؤال');
        if (ok) {
          await callApi('recordKbFaqUsage', { id: fid }).catch(function () {});
          await refreshCurrentView(ctx, true);
        }
      });
    });
    slot.querySelectorAll('[data-kb-edit-faq]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var fid = btn.getAttribute('data-kb-edit-faq');
        var found = (kbState.faqs.items || []).find(function (x) { return x.id === fid; });
        openFaqModal(found, ctx);
      });
    });
    slot.querySelectorAll('[data-kb-delete-faq]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        confirmAndDelete(en ? 'FAQ' : 'السؤال الشائع', 'deleteKbFaq', btn.getAttribute('data-kb-delete-faq'), ctx);
      });
    });

    // Quick Replies
    var qrSearch = document.getElementById('kb-qr-search');
    if (qrSearch) {
      qrSearch.addEventListener('input', function () {
        kbState.quickReplies.search = qrSearch.value;
        kbState.quickReplies.page = 1;
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () { refreshCurrentView(ctx, false); }, 220);
      });
    }
    var qrCat = document.getElementById('kb-qr-cat');
    if (qrCat) qrCat.addEventListener('change', function () { kbState.quickReplies.category = qrCat.value; kbState.quickReplies.page = 1; refreshCurrentView(ctx, false); });
    var qrLang = document.getElementById('kb-qr-lang');
    if (qrLang) qrLang.addEventListener('change', function () { kbState.quickReplies.language = qrLang.value; kbState.quickReplies.page = 1; refreshCurrentView(ctx, false); });
    var qrCmp = document.getElementById('kb-qr-company');
    if (qrCmp) qrCmp.addEventListener('change', function () { kbState.quickReplies.companyId = qrCmp.value; kbState.quickReplies.page = 1; refreshCurrentView(ctx, false); });
    var qrSort = document.getElementById('kb-qr-sort');
    if (qrSort) qrSort.addEventListener('change', function () { kbState.quickReplies.sortBy = qrSort.value; kbState.quickReplies.page = 1; refreshCurrentView(ctx, false); });
    var addQrBtn = slot.querySelector('[data-kb-action="add-quick-reply"]');
    if (addQrBtn) addQrBtn.addEventListener('click', function () { openQuickReplyModal(null, ctx); });

    slot.querySelectorAll('[data-kb-var-key]').forEach(function (inp) {
      inp.addEventListener('input', function () {
        var k = inp.getAttribute('data-kb-var-key');
        kbState.quickVarValues[k] = inp.value;
        slot.querySelectorAll('.rg-kb-reply-card').forEach(function (card) {
          var copyBtn = card.querySelector('[data-kb-copy-reply]');
          var qid = copyBtn ? copyBtn.getAttribute('data-kb-copy-reply') : '';
          var found = (kbState.quickReplies.items || []).find(function (x) { return x.id === qid; });
          var pre = card.querySelector('.rg-kb-reply-body');
          if (found && pre) {
            pre.textContent = substituteQuickVariables(found.messageText, kbState.quickVarValues);
          }
        });
      });
    });

    slot.querySelectorAll('[data-kb-copy-reply]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var qid = btn.getAttribute('data-kb-copy-reply');
        var found = (kbState.quickReplies.items || []).concat(kbState.quickReplies.mostUsed || []).find(function (x) { return x.id === qid; });
        if (!found) return;
        var finalMsg = substituteQuickVariables(found.messageText, kbState.quickVarValues);
        var ok = await copyToClipboard(finalMsg, ctx, en ? 'Quick reply copied to clipboard' : 'تم نسخ الرد الجاهز إلى الحافظة');
        if (ok) {
          await callApi('recordKbQuickReplyUsage', { id: qid }).catch(function () {});
          await refreshCurrentView(ctx, true);
        }
      });
    });
    slot.querySelectorAll('[data-kb-fill-copy-reply]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var qid = btn.getAttribute('data-kb-fill-copy-reply');
        var found = (kbState.quickReplies.items || []).find(function (x) { return x.id === qid; });
        if (found) openFillAndCopyReplyModal(found, ctx);
      });
    });
    slot.querySelectorAll('[data-kb-edit-reply]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var qid = btn.getAttribute('data-kb-edit-reply');
        var found = (kbState.quickReplies.items || []).find(function (x) { return x.id === qid; });
        openQuickReplyModal(found, ctx);
      });
    });
    slot.querySelectorAll('[data-kb-delete-reply]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        confirmAndDelete(en ? 'quick reply' : 'الرد الجاهز', 'deleteKbQuickReply', btn.getAttribute('data-kb-delete-reply'), ctx);
      });
    });

    // Pagination buttons
    slot.querySelectorAll('[data-kb-page-scope]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sc = btn.getAttribute('data-kb-page-scope');
        var val = Math.max(1, Number(btn.getAttribute('data-kb-page-val') || 1));
        if (kbState[sc]) {
          kbState[sc].page = val;
          refreshCurrentView(ctx, false);
        }
      });
    });
  }

  function bindGlobalDeltaSync() {
    if (deltaBound) return;
    deltaBound = true;
    document.addEventListener('rg:deltasync', function (ev) {
      var detail = (ev && ev.detail) || {};
      var scopes = Array.isArray(detail.scopes) ? detail.scopes : [];
      if (scopes.indexOf('knowledgeBase') === -1) return;
      var activeNav = document.querySelector('.nav-item.active');
      if (!activeNav || activeNav.getAttribute('data-route') !== 'knowledge-base') return;
      var slot = document.querySelector('#page-content .route-view') || document.getElementById('page-content');
      if (!slot) return;
      var ctx = root.RGApp && root.RGApp.buildAppCtx ? root.RGApp.buildAppCtx() : {};
      refreshCurrentView(ctx, true).catch(function () {});
    });
  }

  async function render(slot, ctx) {
    bindGlobalDeltaSync();
    await loadTabData(false);
    slot.innerHTML = renderHeaderAndSearchHtml(ctx);
    bindShellEvents(slot, ctx);
    renderPanelOnly(slot, ctx);
  }

  root.RGKnowledgeBase = {
    render: render,
    getState: function () { return kbState; },
    substituteQuickVariables: substituteQuickVariables
  };
})(window);
