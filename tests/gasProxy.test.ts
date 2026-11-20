import test from 'node:test';
import assert from 'node:assert/strict';
import core from '../backend/coreBridge.cjs';
import {
  normalizeAndValidateGasTarget,
  isAllowedGasRedirectHost,
  fetchGasServerSide
} from '../backend/gasProxy';

test('core.validateGasUrl normalizes multi-account /macros/u/N/s/ URLs and authuser params cleanly', () => {
  const res = core.validateGasUrl(
    'http://script.google.com/macros/u/2/s/AKfycbyExampleDeploy123/exec?authuser=2'
  );
  assert.equal(res.valid, true);
  assert.equal(res.isSandbox, false);
  assert.equal(res.normalized, 'https://script.google.com/macros/s/AKfycbyExampleDeploy123/exec');

  const devRes = core.validateGasUrl('https://script.google.com/macros/s/AKfycb123/dev');
  assert.equal(devRes.valid, false);
});

test('normalizeAndValidateGasTarget enforces strict SSRF allowlist and normalizes multi-account GAS URLs', () => {
  const ok = normalizeAndValidateGasTarget(
    'https://script.google.com/macros/u/1/s/AKfycbTestDeploy999/exec?authuser=1'
  );
  assert.equal(ok.valid, true);
  assert.equal(ok.normalized, 'https://script.google.com/macros/s/AKfycbTestDeploy999/exec');

  const ssrfEvil = normalizeAndValidateGasTarget('https://evil.com/macros/s/abc/exec');
  assert.equal(ssrfEvil.valid, false);

  const ssrfSubdomain = normalizeAndValidateGasTarget('https://script.google.com.evil.com/macros/s/abc/exec');
  assert.equal(ssrfSubdomain.valid, false);

  const ssrfLocal = normalizeAndValidateGasTarget('http://127.0.0.1:3000/macros/s/abc/exec');
  assert.equal(ssrfLocal.valid, false);

  const devUrl = normalizeAndValidateGasTarget('https://script.google.com/macros/s/abc/dev');
  assert.equal(devUrl.valid, false);

  assert.equal(isAllowedGasRedirectHost('script.googleusercontent.com'), true);
  assert.equal(isAllowedGasRedirectHost('lh3.googleusercontent.com'), true);
  assert.equal(isAllowedGasRedirectHost('evil.com'), false);
});

test('fetchGasServerSide follows 302 script.googleusercontent.com redirects and returns viaServerProxy=true', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const mockFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: String(init?.method || 'GET') });
    if (String(url).startsWith('https://script.google.com/')) {
      return new Response('', {
        status: 302,
        headers: { location: 'https://script.googleusercontent.com/macros/echo?user_content_key=ok123' }
      });
    }
    return new Response(
      JSON.stringify({
        success: true,
        message: 'RENTAL GATE CRM API متصل ويعمل بنجاح.',
        data: { service: 'RENTAL GATE CRM' }
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as unknown as typeof fetch;

  const res = await fetchGasServerSide(
    'https://script.google.com/macros/u/1/s/AKfycbTest123/exec',
    'ping',
    '',
    {},
    mockFetch
  );
  assert.equal(res.success, true);
  assert.equal(res.data?.viaServerProxy, true);
  assert.equal(res.data?.service, 'RENTAL GATE CRM');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://script.google.com/macros/s/AKfycbTest123/exec');
  assert.equal(calls[1].method, 'GET');
});

test('fetchGasServerSide diagnoses accounts.google.com redirect as GAS_AUTH_REQUIRED (Anyone permission missing)', async () => {
  const mockFetch = (async () => {
    return new Response('', {
      status: 302,
      headers: {
        location: 'https://accounts.google.com/ServiceLogin?continue=https://script.google.com/macros/s/abc/exec'
      }
    });
  }) as unknown as typeof fetch;

  const res = await fetchGasServerSide(
    'https://script.google.com/macros/s/AKfycbPrivate123/exec',
    'ping',
    '',
    {},
    mockFetch
  );
  assert.equal(res.success, false);
  assert.equal(res.error, 'GAS_AUTH_REQUIRED');
  assert.ok(res.message.includes('Anyone'));
});

test('fetchGasServerSide falls back to GET ?action=ping when POST throws network error and diagnoses 404/HTML', async () => {
  let postAttempted = false;
  const fallbackFetch = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      postAttempted = true;
      throw new TypeError('fetch failed');
    }
    assert.ok(String(url).includes('action=ping'));
    return new Response(JSON.stringify({ success: true, message: 'OK', data: { ping: true } }), {
      status: 200
    });
  }) as unknown as typeof fetch;

  const okRes = await fetchGasServerSide(
    'https://script.google.com/macros/s/AKfycbGetOk/exec',
    'ping',
    '',
    {},
    fallbackFetch
  );
  assert.equal(postAttempted, true);
  assert.equal(okRes.success, true);
  assert.equal(okRes.data?.viaServerProxy, true);

  const notFoundFetch = (async () => new Response('Not Found', { status: 404 })) as unknown as typeof fetch;
  const nfRes = await fetchGasServerSide(
    'https://script.google.com/macros/s/AKfycbMissing/exec',
    'ping',
    '',
    {},
    notFoundFetch
  );
  assert.equal(nfRes.success, false);
  assert.equal(nfRes.error, 'GAS_NOT_FOUND');

  const htmlFetch = (async () =>
    new Response('<!DOCTYPE html><html><head><title>Error</title></head><body>Script error</body></html>', {
      status: 200
    })) as unknown as typeof fetch;
  const htmlRes = await fetchGasServerSide(
    'https://script.google.com/macros/s/AKfycbHtml/exec',
    'getDashboard',
    'TOK',
    {},
    htmlFetch
  );
  assert.equal(htmlRes.success, false);
  assert.equal(htmlRes.error, 'HTML_RESPONSE');
});
