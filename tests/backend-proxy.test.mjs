import test from 'node:test';
import assert from 'node:assert/strict';
import api from '../edge-functions/api/[[path]].js';
import manage from '../edge-functions/manage/index.js';
import manageChild from '../edge-functions/manage/[[path]].js';
import apiRoot from '../edge-functions/api/index.js';
import style from '../edge-functions/static/search_manage/[[path]].js';
import styleRoot from '../edge-functions/static/search_manage/index.js';

const ORIGIN = 'https://book.laiye.site';

test('login POST preserves form, CSRF, authorization and independent redirect cookies', async t => {
    const body = 'email=admin%40example.test&password=not-a-real-password&csrfmiddlewaretoken=test';
    const cookies = [
        'sessionid=mock-session; Path=/; Secure; HttpOnly; SameSite=Lax',
        'csrftoken=mock-csrf; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/; Secure; SameSite=Lax'
    ];
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url, 'http://88.96.42.58/manage/login/?next=%2Fmanage%2Fusers%2F');
        assert.equal(init.method, 'POST');
        assert.equal(new TextDecoder().decode(init.body), body);
        assert.equal(init.redirect, 'manual');
        assert.equal(init.headers.get('cookie'), 'csrftoken=mock-csrf');
        assert.equal(init.headers.get('authorization'), 'Bearer mock');
        assert.equal(init.headers.get('x-csrftoken'), 'mock-csrf');
        assert.equal(init.headers.get('origin'), ORIGIN);
        assert.equal(init.headers.get('referer'), ORIGIN + '/manage/login/');
        assert.equal(init.headers.get('host'), 'book.laiye.site');
        assert.equal(init.headers.get('x-forwarded-proto'), 'https');
        assert.equal(init.headers.get('x-forwarded-for'), null);
        assert.equal(init.headers.get('x-hop'), null);
        assert.equal(init.headers.get('if-none-match'), null);
        const headers = new Headers({ location: '/manage/', 'cache-control': 'public, max-age=3600' });
        for (const cookie of cookies) headers.append('set-cookie', cookie);
        return new Response(null, { status: 302, headers });
    });
    const response = await manageChild({ request: new Request(ORIGIN + '/manage/login/?next=%2Fmanage%2Fusers%2F', {
        method: 'POST', body, headers: {
            'content-type': 'application/x-www-form-urlencoded', cookie: 'csrftoken=mock-csrf',
            authorization: 'Bearer mock', 'x-csrftoken': 'mock-csrf', origin: ORIGIN,
            referer: ORIGIN + '/manage/login/', 'x-forwarded-proto': 'http',
            'x-forwarded-for': 'spoofed', connection: 'X-Hop', 'x-hop': 'remove', 'if-none-match': 'old'
        }
    }) });
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/manage/');
    assert.deepEqual(response.headers.getSetCookie(), cookies);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(response.headers.get('cdn-cache-control'), 'no-store');
});

test('query strings never change the fixed origin; API errors keep status and body', async t => {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url, 'http://88.96.42.58/api/search?url=https%3A%2F%2Fother.test%2F&k=a&k=b');
        assert.equal(init.headers.get('cache-control'), 'no-store');
        return new Response('{"message":"quota exceeded"}', { status: 403, headers: { 'content-type': 'application/json' } });
    });
    const response = await api({ request: new Request(ORIGIN + '/api/search?url=https%3A%2F%2Fother.test%2F&k=a&k=b') });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { message: 'quota exceeded' });
});

test('upstream absolute redirects stay on browser origin; external download redirects remain untouched', async t => {
    let location = 'http://88.96.42.58/manage/login/?next=%2Fmanage%2F';
    t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location } }));
    let response = await manage({ request: new Request(ORIGIN + '/manage') });
    assert.equal(response.headers.get('location'), ORIGIN + '/manage/login/?next=%2Fmanage%2F');
    location = 'http://book.laiye.site/manage/';
    response = await manage({ request: new Request(ORIGIN + '/manage/') });
    assert.equal(response.headers.get('location'), ORIGIN + '/manage/');
    location = 'https://files.example.test/download/book?signature=mock';
    response = await api({ request: new Request(ORIGIN + '/api/download/example') });
    assert.equal(response.headers.get('location'), location);
});

test('only backend namespaces are proxied, including exact roots', async t => {
    const fetched = [];
    t.mock.method(globalThis, 'fetch', async url => { fetched.push(url); return new Response('ok'); });
    for (const path of ['/', '/js/app.js', '/static/other.css', '/static/search_manage_other/file.css', '/api-other', '/manage%2f..%2fadmin', '/api/%5cadmin', '/api/%zz']) {
        const response = await api({ request: new Request(ORIGIN + path) });
        assert.equal(response.status, 404, path);
    }
    assert.equal(fetched.length, 0);
    for (const [handler, path] of [[apiRoot, '/api'], [manage, '/manage/'], [styleRoot, '/static/search_manage']]) {
        assert.equal((await handler({ request: new Request(ORIGIN + path) })).status, 200);
    }
    assert.deepEqual(fetched, ['http://88.96.42.58/api', 'http://88.96.42.58/manage/', 'http://88.96.42.58/static/search_manage']);
});

test('management CSS keeps origin caching and HEAD has no response body', async t => {
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.equal(url, 'http://88.96.42.58/static/search_manage/manage.css');
        assert.equal(init.method, 'HEAD');
        assert.equal(init.body, undefined);
        return new Response(null, { headers: { 'content-type': 'text/css', 'cache-control': 'public, max-age=600' } });
    });
    const response = await style({ request: new Request(ORIGIN + '/static/search_manage/manage.css', { method: 'HEAD' }) });
    assert.equal(response.headers.get('cache-control'), 'public, max-age=600');
    assert.equal(response.headers.get('content-type'), 'text/css');
    assert.equal(await response.text(), '');
});

test('backend transport failure returns an uncached 502 without internal details', async t => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('internal failure detail'); });
    const response = await api({ request: new Request(ORIGIN + '/api/check') });
    assert.equal(response.status, 502);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(await response.text(), 'Backend temporarily unavailable');
});
