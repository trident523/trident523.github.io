// Cloudflare Worker: handles web form submissions, admin posts, and Twilio
// SMS/voice webhooks for the status page. Writes content entries to the
// repository using the GitHub Contents API so GitHub Actions rebuilds the site.

export interface Env {
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
  ADMIN_NUMBER: string;
  PUBLIC_NUMBER: string;
  ALLOWED_ORIGIN: string;
  GITHUB_TOKEN: string;
  PIN_HASH: string;
  TURNSTILE_SECRET: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  RATE_LIMIT: KVNamespace;
}

type EntryKind = "posts" | "messages";
type EntrySource = "web" | "sms" | "voice";

interface EntryData {
  date: string;
  body: string;
  source: EntrySource;
  author?: string;
  from?: string;
  audio?: string;
  image?: string;
}

const MAX_BODY = 5000;
const MAX_NAME = 80;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "OPTIONS") return cors(env, new Response(null, { status: 204 }));

    try {
      if (req.method === "POST" && path === "/messages") return cors(env, await handleWebMessage(req, env));
      if (req.method === "POST" && path === "/admin/post") return cors(env, await handleAdminPost(req, env));
      if (req.method === "POST" && path === "/twilio/sms") return await handleTwilioSms(req, env);
      if (req.method === "POST" && path === "/twilio/voice") return await handleTwilioVoice(req, env);
      if (req.method === "POST" && path === "/twilio/voice/admin-pin") return await handleAdminPin(req, env);
      if (req.method === "POST" && path === "/twilio/voice/record") return await handleRecord(req, env);

      if (req.method === "GET" && path === "/health") return new Response("ok");
      return new Response("not found", { status: 404 });
    } catch (err) {
      console.error("worker error", err);
      return new Response("internal error", { status: 500 });
    }
  },
};

function cors(env: Env, res: Response): Response {
  const allowed = (env.ALLOWED_ORIGIN || "*").replace(/\/$/, "");
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", allowed || "*");
  h.set("access-control-allow-methods", "POST, OPTIONS");
  h.set("access-control-allow-headers", "content-type");
  h.set("vary", "origin");
  return new Response(res.body, { status: res.status, headers: h });
}

// Web visitor message form.
async function handleWebMessage(req: Request, env: Env): Promise<Response> {
  const ip = clientIp(req);
  const body = await req.json().catch(() => null) as
    | { name?: string; body?: string; turnstile?: string }
    | null;
  if (!body || !body.body) return text("missing body", 400);
  const text_ = sanitizeText(body.body, MAX_BODY);
  const name = body.name ? sanitizeText(body.name, MAX_NAME) : undefined;
  if (!text_) return text("empty message", 400);

  const ok = await verifyTurnstile(body.turnstile || "", ip, env);
  if (!ok) return text("captcha failed", 400);

  await saveEntry(env, "messages", {
    date: new Date().toISOString(),
    body: text_,
    from: name,
    source: "web",
  });
  return text("ok");
}

// Web admin post. Accepts multipart: pin, body, optional file (image or audio).
async function handleAdminPost(req: Request, env: Env): Promise<Response> {
  const ip = clientIp(req);
  const locked = await isLockedOut(env, ip);
  if (locked) return text("too many attempts; try again later", 429);

  const form = await req.formData().catch(() => null);
  if (!form) return text("bad form", 400);
  const pin = (form.get("pin") || "").toString();
  const body = sanitizeText((form.get("body") || "").toString(), MAX_BODY);
  const file = form.get("file");

  if (!(await verifyPin(pin, env))) {
    await registerBadPin(env, ip);
    return text("unauthorized", 401);
  }
  await clearBadPin(env, ip);

  const data: EntryData = {
    date: new Date().toISOString(),
    body: body || "",
    source: "web",
  };

  if (file && file instanceof File && file.size > 0) {
    if (file.size > MAX_MEDIA_BYTES) return text("file too large", 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = file.type.startsWith("audio/") ? "audio" : file.type.startsWith("image/") ? "image" : null;
    if (!kind) return text("unsupported file type", 400);
    const mediaPath = await uploadMedia(env, kind, bytes, file.name || guessName(file.type));
    if (kind === "audio") data.audio = mediaPath;
    else data.image = mediaPath;
  }

  if (!data.body && !data.audio && !data.image) return text("nothing to post", 400);
  await saveEntry(env, "posts", data);
  return text("ok");
}

// Twilio SMS webhook. Twilio POSTs application/x-www-form-urlencoded fields:
// From, To, Body, NumMedia, MediaUrl0..N, MediaContentType0..N, etc.
async function handleTwilioSms(req: Request, env: Env): Promise<Response> {
  const form = await req.formData().catch(() => null);
  if (!form) return twiml(`<Response/>`);

  const to = (form.get("To") || "").toString();
  const from = (form.get("From") || "").toString();
  const bodyText = (form.get("Body") || "").toString();

  const kind: EntryKind = to === env.ADMIN_NUMBER ? "posts" : "messages";

  // MMS media: Twilio requires Basic Auth (Account SID : Auth Token) to fetch.
  const numMedia = parseInt((form.get("NumMedia") || "0").toString(), 10) || 0;
  let image: string | undefined;
  let audio: string | undefined;
  for (let i = 0; i < numMedia; i++) {
    const mediaUrl = (form.get(`MediaUrl${i}`) || "").toString();
    const contentType = (form.get(`MediaContentType${i}`) || "").toString();
    if (!mediaUrl) continue;
    const res = await fetch(mediaUrl, { headers: { authorization: twilioAuthHeader(env) } });
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_MEDIA_BYTES) continue;
    const ct = contentType || res.headers.get("content-type") || "";
    if (ct.startsWith("image/") && !image) {
      image = await uploadMedia(env, "image", bytes, guessName(ct));
    } else if (ct.startsWith("audio/") && !audio) {
      audio = await uploadMedia(env, "audio", bytes, guessName(ct));
    }
  }

  if (kind === "posts") {
    // Admin SMS: expect "PIN body..." — first whitespace token is the PIN.
    const trimmed = bodyText.trim();
    const spaceIdx = trimmed.search(/\s/);
    const pin = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);
    if (!(await verifyPin(pin, env))) {
      console.log("admin sms failed pin", { from });
      return twiml(`<Response/>`);
    }
    await saveEntry(env, "posts", {
      date: new Date().toISOString(),
      body: sanitizeText(rest, MAX_BODY),
      source: "sms",
      image,
      audio,
    });
  } else {
    await saveEntry(env, "messages", {
      date: new Date().toISOString(),
      body: sanitizeText(bodyText, MAX_BODY),
      from: maskPhone(from),
      source: "sms",
      image,
      audio,
    });
  }
  return twiml(`<Response/>`);
}

// Twilio voice TwiML entry point. Branches on which number was dialed.
async function handleTwilioVoice(req: Request, env: Env): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const to = (form?.get("To") || "").toString();
  const base = new URL(req.url);
  base.search = "";
  if (to === env.ADMIN_NUMBER) {
    return twiml(`
      <Response>
        <Gather action="${base.origin}/twilio/voice/admin-pin" numDigits="12" finishOnKey="#" timeout="10">
          <Say voice="Polly.Joanna">Enter your PIN followed by the pound key.</Say>
        </Gather>
        <Say voice="Polly.Joanna">No input received. Goodbye.</Say>
        <Hangup/>
      </Response>
    `);
  }
  return twiml(`
    <Response>
      <Say voice="Polly.Joanna">Hello. Please leave a message after the beep, then hang up.</Say>
      <Record action="${base.origin}/twilio/voice/record?mode=message" maxLength="180" playBeep="true" trim="trim-silence"/>
      <Say voice="Polly.Joanna">Thank you. Goodbye.</Say>
      <Hangup/>
    </Response>
  `);
}

async function handleAdminPin(req: Request, env: Env): Promise<Response> {
  const form = await req.formData().catch(() => null);
  const digits = (form?.get("Digits") || "").toString();
  const base = new URL(req.url);
  base.search = "";
  if (!(await verifyPin(digits, env))) {
    return twiml(`
      <Response>
        <Say voice="Polly.Joanna">PIN incorrect. Goodbye.</Say>
        <Hangup/>
      </Response>
    `);
  }
  return twiml(`
    <Response>
      <Say voice="Polly.Joanna">PIN accepted. Record your update after the beep, then press pound.</Say>
      <Record action="${base.origin}/twilio/voice/record?mode=post" maxLength="300" finishOnKey="#" playBeep="true" trim="trim-silence"/>
      <Say voice="Polly.Joanna">Thank you. Goodbye.</Say>
      <Hangup/>
    </Response>
  `);
}

// Recording callback: Twilio POSTs the finished recording URL here as
// `RecordingUrl`. Append `.mp3` to download the MP3 with Basic Auth.
async function handleRecord(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "post" ? "posts" : "messages";
  const form = await req.formData().catch(() => null);
  const recordingUrl = (form?.get("RecordingUrl") || "").toString();
  const from = (form?.get("From") || "").toString();
  if (!recordingUrl) return twiml(`<Response><Hangup/></Response>`);

  const mp3Url = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
  const res = await fetch(mp3Url, { headers: { authorization: twilioAuthHeader(env) } });
  if (!res.ok) {
    console.error("failed to fetch recording", res.status, await res.text());
    return twiml(`<Response><Hangup/></Response>`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    console.error("recording too large", bytes.byteLength);
    return twiml(`<Response><Hangup/></Response>`);
  }
  const audioPath = await uploadMedia(env, "audio", bytes, "voicemail.mp3");

  if (mode === "posts") {
    await saveEntry(env, "posts", {
      date: new Date().toISOString(),
      body: "",
      source: "voice",
      audio: audioPath,
    });
  } else {
    await saveEntry(env, "messages", {
      date: new Date().toISOString(),
      body: "",
      from: maskPhone(from),
      source: "voice",
      audio: audioPath,
    });
  }
  return twiml(`<Response><Hangup/></Response>`);
}

// --- helpers ---------------------------------------------------------------

function clientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function text(s: string, status = 200): Response {
  return new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

function twiml(xml: string): Response {
  return new Response(xml.trim(), {
    status: 200,
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}

function twilioAuthHeader(env: Env): string {
  return "Basic " + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
}

function sanitizeText(s: string, max: number): string {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
}

function maskPhone(e164: string): string {
  if (!e164) return "caller";
  const digits = e164.replace(/\D/g, "");
  if (digits.length < 4) return "caller";
  return `caller …${digits.slice(-4)}`;
}

function guessName(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "photo.jpg",
    "image/jpg": "photo.jpg",
    "image/png": "photo.png",
    "image/gif": "photo.gif",
    "image/webp": "photo.webp",
    "audio/mpeg": "audio.mp3",
    "audio/mp3": "audio.mp3",
    "audio/mp4": "audio.m4a",
    "audio/ogg": "audio.ogg",
    "audio/wav": "audio.wav",
    "audio/webm": "audio.webm",
  };
  return map[contentType.toLowerCase()] || "file.bin";
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPin(pin: string, env: Env): Promise<boolean> {
  if (!pin || !env.PIN_HASH) return false;
  const trimmed = pin.replace(/\D/g, "");
  if (!trimmed) return false;
  const hash = await sha256Hex(trimmed);
  return timingSafeEqual(hash, env.PIN_HASH.toLowerCase());
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function verifyTurnstile(token: string, ip: string, env: Env): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return true; // dev mode: allow if unset
  if (!token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => null) as { success?: boolean } | null;
  return !!data?.success;
}

async function registerBadPin(env: Env, ip: string) {
  const key = `pin-fail:${ip}`;
  const current = parseInt((await env.RATE_LIMIT.get(key)) || "0", 10);
  const next = current + 1;
  await env.RATE_LIMIT.put(key, String(next), { expirationTtl: 3600 });
  if (next >= 10) {
    await env.RATE_LIMIT.put(`lockout:${ip}`, "1", { expirationTtl: 86400 });
  }
}
async function clearBadPin(env: Env, ip: string) {
  await env.RATE_LIMIT.delete(`pin-fail:${ip}`);
}
async function isLockedOut(env: Env, ip: string): Promise<boolean> {
  return !!(await env.RATE_LIMIT.get(`lockout:${ip}`));
}

// --- GitHub writes ---------------------------------------------------------

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function saveEntry(env: Env, kind: EntryKind, data: EntryData): Promise<void> {
  const filename = `${ts()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const path = `src/content/${kind}/${filename}`;
  const json = JSON.stringify(data, null, 2) + "\n";
  const contentB64 = bytesToBase64(new TextEncoder().encode(json));
  await githubPut(env, path, contentB64, `${kind}: new entry (${data.source})`);
}

async function uploadMedia(
  env: Env,
  kind: "image" | "audio",
  bytes: Uint8Array,
  filename: string,
): Promise<string> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60) || "file";
  const path = `public/media/${kind}/${ts()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const contentB64 = bytesToBase64(bytes);
  await githubPut(env, path, contentB64, `media: upload ${kind}`);
  // public/ contents are served at the site root, preserving subpaths.
  return "/" + path.replace(/^public\//, "");
}

async function githubPut(env: Env, path: string, contentBase64: string, message: string): Promise<void> {
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
  const res = await fetch(api, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "miniature-enigma-worker",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch: env.GITHUB_BRANCH,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`github put failed: ${res.status} ${body}`);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}
