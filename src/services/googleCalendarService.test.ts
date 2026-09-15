import assert from "node:assert/strict";
import { test, beforeEach, afterEach, type TestContext } from "node:test";
import { mapClaseToGoogleCalendarEvent } from "../utils/googleCalendarMapping.ts";
import {
  createGoogleCalendarEvent, updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent, getGoogleCalendarEvent, GoogleCalendarServiceError,
  type GoogleCalendarLinkMetadata,
} from "./googleCalendarService.ts";

function jsonBody(value: unknown): unknown {
  assert.equal(typeof value, "string");
  if (typeof value !== "string") throw new Error("Expected JSON body");
  const parsed: unknown = JSON.parse(value);
  return parsed;
}

const TOKEN = "fake-service-access-token";
const payload = mapClaseToGoogleCalendarEvent({
  id: "local-id", alumnoId: "private", tipo: "alma", fecha: "2026-09-15",
  horaInicio: "10:00", horaFin: "11:00", tema: "private", estado: "programada",
  createdAt: "2026-09-01", updatedAt: "2026-09-01",
}).event;
let calls: Array<{ url: string; init: RequestInit }>;
let response: () => Response | Promise<Response>;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

beforeEach((t: TestContext) => {
  calls = [];
  response = () => new Response(JSON.stringify({ id: "event123", ...payload, etag: '"body-etag"' }), {
    status: 200, headers: { ETag: '"header-etag"' },
  });
  t.mock.method(globalThis, "fetch", async (input, init) => {
    assert.ok(init);
    calls.push({ url: String(input), init });
    return response();
  });
  for (const key of ["localStorage", "sessionStorage", "indexedDB"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, get() { assert.fail(`Storage: ${key}`); } });
  }
  for (const method of ["log", "warn", "error", "info", "debug"] as const) {
    t.mock.method(console, method, (...args: unknown[]) => {
      assert.equal(JSON.stringify(args).includes(TOKEN), false);
    });
  }
});
afterEach(() => {
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("import does not call fetch", () => assert.equal(calls.length, 0));

test("POST accepts mapper payload; PATCH uses If-Match; GET and DELETE use primary", async () => {
  assert.equal((await createGoogleCalendarEvent(TOKEN, payload)).etag, '"header-etag"');
  assert.equal((await updateGoogleCalendarEvent(TOKEN, "event123", { summary: "Changed" }, '"old"')).etag, '"header-etag"');
  await getGoogleCalendarEvent(TOKEN, "event123");
  response = () => new Response(null, { status: 204 });
  assert.equal(await deleteGoogleCalendarEvent(TOKEN, "event123"), undefined);
  assert.deepEqual(calls.map(({ init }) => init.method), ["POST", "PATCH", "GET", "DELETE"]);
  for (const { url, init } of calls) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://www.googleapis.com");
    assert.ok(parsed.pathname.startsWith("/calendar/v3/calendars/primary/events"));
    assert.equal(parsed.searchParams.get("sendUpdates"), "none");
    assert.equal(new Headers(init.headers).get("Authorization"), `Bearer ${TOKEN}`);
    assert.equal(url.includes(TOKEN), false);
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
  }
  assert.deepEqual(jsonBody(calls[0].init.body), payload);
  assert.deepEqual(jsonBody(calls[1].init.body), { summary: "Changed" });
  assert.equal(new Headers(calls[1].init.headers).get("If-Match"), '"old"');
  assert.equal(calls[2].init.body, undefined);
  assert.equal(calls[3].init.body, undefined);
});

test("optional ETag is omitted and body ETag is returned when the header is absent", async () => {
  response = () => new Response(JSON.stringify({ id: "event123", etag: '"body"' }));
  const result = await updateGoogleCalendarEvent(TOKEN, "event123", { summary: "Changed" });
  assert.equal(new Headers(calls[0].init.headers).has("If-Match"), false);
  assert.equal(result.etag, '"body"');
});

test("strips guests, Meet and recurrence even when passed as runtime extras", async () => {
  const extras = {
    ...payload, attendees: [{ email: "nobody@example.test" }],
    recurrence: ["RRULE:FREQ=DAILY"], conferenceData: { createRequest: {} },
  };
  await createGoogleCalendarEvent(TOKEN, extras);
  assert.deepEqual(jsonBody(calls[0].init.body), payload);
});

for (const [status, code] of [
  [401, "unauthorized"], [403, "forbidden"], [404, "not_found"],
  [409, "conflict"], [412, "precondition_failed"], [429, "rate_limited"],
  [500, "server_error"], [503, "server_error"], [400, "http_error"],
] as const) {
  test(`HTTP ${status} is typed and never exposes the response or token`, async () => {
    response = () => new Response(TOKEN, { status });
    await assert.rejects(getGoogleCalendarEvent(TOKEN, "event123"), (error: unknown) => {
      assert.ok(error instanceof GoogleCalendarServiceError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      assert.equal(error.retryable, status === 429 || status >= 500);
      assert.equal(`${error.stack}${JSON.stringify(error)}`.includes(TOKEN), false);
      assert.equal("cause" in error, false);
      return true;
    });
    assert.equal(calls.length, 1); // No automatic retries.
  });
}

test("network exceptions are replaced with safe errors", async () => {
  response = () => { throw new Error(`Authorization: Bearer ${TOKEN}`); };
  await assert.rejects(getGoogleCalendarEvent(TOKEN, "event123"), (error: unknown) => {
    assert.ok(error instanceof GoogleCalendarServiceError);
    assert.equal(error.code, "network_error");
    assert.equal(`${error.stack}${JSON.stringify(error)}`.includes(TOKEN), false);
    return true;
  });
});

test("malformed and missing-id success bodies are safe errors", async () => {
  for (const body of [TOKEN, JSON.stringify({ message: TOKEN })]) {
    response = () => new Response(body);
    await assert.rejects(getGoogleCalendarEvent(TOKEN, "event123"), (error: unknown) => {
      assert.ok(error instanceof GoogleCalendarServiceError);
      assert.equal(error.code, "invalid_response");
      assert.equal(`${error.stack}${JSON.stringify(error)}`.includes(TOKEN), false);
      return true;
    });
  }
});

test("rejects missing tokens, unsafe ids and ETags before any request", async () => {
  await assert.rejects(getGoogleCalendarEvent("", "event123"), { code: "invalid_request" });
  await assert.rejects(deleteGoogleCalendarEvent(TOKEN, "../other"), { code: "invalid_request" });
  await assert.rejects(updateGoogleCalendarEvent(TOKEN, "event123", {}, "\r\nInjected"), { code: "invalid_request" });
  assert.equal(calls.length, 0);
});

const link: GoogleCalendarLinkMetadata = {
  app: "profesor-agenda", syncJobId: "pa_stable_job", entityType: "clase", entityId: "firestore-id",
};

test("POST with caller ID preserves ID, uses collection URL and conferenceDataVersion", async () => {
  const id = "pa0123456789abcdef";
  await createGoogleCalendarEvent(TOKEN, payload, id);
  assert.deepEqual(jsonBody(calls[0].init.body), { ...payload, id });
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/calendar/v3/calendars/primary/events");
  assert.equal(url.searchParams.get("conferenceDataVersion"), "1");
  assert.equal(url.searchParams.get("sendUpdates"), "none");
  assert.equal(calls.length, 1);
});

test("POST without caller ID keeps original body and query", async () => {
  await createGoogleCalendarEvent(TOKEN, payload);
  assert.deepEqual(jsonBody(calls[0].init.body), payload);
  assert.equal(new URL(calls[0].url).search, "?sendUpdates=none");
});

test("POST/PATCH preserve only approved private link and legacy fields", async () => {
  const privateFields = { ...payload.extendedProperties.private, ...link };
  const withExtras = { ...payload, extendedProperties: { private: {
    ...privateFields, notas: "private-notes", alumno: "private-student", contacto: "private-contact",
    honorarios: 100, accessToken: TOKEN, refreshToken: "fake-refresh",
  } } };
  const expected = { ...payload, extendedProperties: { private: privateFields } };
  await createGoogleCalendarEvent(TOKEN, withExtras, "abcde");
  await updateGoogleCalendarEvent(TOKEN, "abcde", withExtras);
  assert.deepEqual(jsonBody(calls[0].init.body), { ...expected, id: "abcde" });
  assert.deepEqual(jsonBody(calls[1].init.body), expected);
  assert.equal(String(calls[0].init.body).includes(TOKEN), false);
});

test("GET returns event ID, ETag and link metadata, stripping response extras", async () => {
  response = () => new Response(JSON.stringify({ id: "abcde", etag: '"v1"',
    extendedProperties: { private: { ...link, token: TOKEN, notas: "private" } } }));
  const event = await getGoogleCalendarEvent(TOKEN, "abcde");
  assert.equal(event.id, "abcde");
  assert.equal(event.etag, '"v1"');
  assert.deepEqual(jsonBody(JSON.stringify(event.extendedProperties?.private)), link);
  assert.equal(JSON.stringify(event).includes(TOKEN), false);
});

test("DELETE sends If-Match only when provided", async () => {
  response = () => new Response(null, { status: 204 });
  await deleteGoogleCalendarEvent(TOKEN, "abcde", '"v1"');
  await deleteGoogleCalendarEvent(TOKEN, "abcde");
  assert.equal(new Headers(calls[0].init.headers).get("If-Match"), '"v1"');
  assert.equal(new Headers(calls[1].init.headers).has("If-Match"), false);
  assert.equal(calls[0].init.body, undefined);
});

for (const status of [404, 412]) test(`DELETE ${status} remains a typed error without retries`, async () => {
  response = () => new Response(TOKEN, { status });
  await assert.rejects(deleteGoogleCalendarEvent(TOKEN, "abcde", '"v1"'), (error: unknown) => {
    assert.ok(error instanceof GoogleCalendarServiceError);
    assert.equal(error.status, status);
    assert.equal(error.code, status === 404 ? "not_found" : "precondition_failed");
    assert.equal(JSON.stringify(error).includes(TOKEN), false);
    return true;
  });
  assert.equal(calls.length, 1);
});

test("invalid caller IDs, incomplete links and unsafe DELETE ETags fail before fetch", async () => {
  for (const id of ["", "abcd", "UPPERCASE", "abc/wrong", "wxyz0", "a".repeat(1025)]) {
    await assert.rejects(createGoogleCalendarEvent(TOKEN, payload, id), { code: "invalid_request" });
  }
  await assert.rejects(createGoogleCalendarEvent(TOKEN, {
    ...payload, extendedProperties: { private: { syncJobId: "incomplete" } },
  }), { code: "invalid_request" });
  await assert.rejects(deleteGoogleCalendarEvent(TOKEN, "abcde", "\r\nunsafe"), { code: "invalid_request" });
  assert.equal(calls.length, 0);
});
