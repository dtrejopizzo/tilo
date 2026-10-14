// Registers (or updates) Tilo as a Google Health API webhook subscriber, once per deployment.
// After this, Google POSTs to /api/webhooks/google-health seconds after a phone or watch syncs,
// for every user who connected Google Health: no polling, no per-user setup.
//
//   GOOGLE_PROJECT_NUMBER=123456789012 \
//   GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
//   npm run health:webhook
//
// Reads NEXT_PUBLIC_APP_URL and GOOGLE_HEALTH_WEBHOOK_SECRET from apps/web/.env.local (or the env).
// The token needs the cloud-platform scope and permission health.subscribers.* on the project
// (role "Google Health API Admin"); `gcloud auth login` with the project owner is enough.
// Instead of GOOGLE_ACCESS_TOKEN you can pass GOOGLE_SERVICE_ACCOUNT_JSON (a key with that role).
import { createSign } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"

const envFile = new URL("../apps/web/.env.local", import.meta.url)
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

const SUBSCRIBER_ID = process.env.GOOGLE_HEALTH_SUBSCRIBER_ID ?? "tilo"
// What Tilo reads (apps/web/lib/server/google.ts). Notifications only arrive for types the user consented to.
const DATA_TYPES = ["steps", "distance", "active-energy-burned", "daily-resting-heart-rate", "exercise", "sleep", "weight", "body-fat", "height"]

function need(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`${name} is not set`)
    process.exit(1)
  }
  return v
}

async function serviceAccountToken(json: string): Promise<string> {
  const sa = JSON.parse(json) as { client_email: string; private_key: string }
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url")
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url")
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`token: ${data.error_description ?? res.status}`)
  return data.access_token
}

async function main() {
  const project = need("GOOGLE_PROJECT_NUMBER")
  const appUrl = need("NEXT_PUBLIC_APP_URL").replace(/\/$/, "")
  const secret = need("GOOGLE_HEALTH_WEBHOOK_SECRET")
  if (!appUrl.startsWith("https://")) throw new Error("NEXT_PUBLIC_APP_URL must be the public https URL (Google has to reach it)")
  const token = process.env.GOOGLE_ACCESS_TOKEN ?? (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? await serviceAccountToken(process.env.GOOGLE_SERVICE_ACCOUNT_JSON) : need("GOOGLE_ACCESS_TOKEN"))

  const base = `https://health.googleapis.com/v4/projects/${project}/subscribers`
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
  const body = {
    endpointUri: `${appUrl}/api/webhooks/google-health`,
    subscriberConfigs: [{ dataTypes: DATA_TYPES, subscriptionCreatePolicy: "AUTOMATIC" }],
    endpointAuthorization: { secret },
  }

  const list = await (await fetch(base, { headers })).json()
  const existing = ((list.subscribers ?? []) as { name: string; endpointUri?: string }[]).find((s) => s.name.endsWith(`/subscribers/${SUBSCRIBER_ID}`))
  let res: Response
  if (existing) {
    console.log(`Updating ${existing.name} (was ${existing.endpointUri})`)
    res = await fetch(`${base}/${SUBSCRIBER_ID}?updateMask=endpointUri,subscriberConfigs,endpointAuthorization`, { method: "PATCH", headers, body: JSON.stringify(body) })
  } else {
    console.log(`Creating subscriber ${SUBSCRIBER_ID} → ${body.endpointUri}`)
    res = await fetch(`${base}?subscriberId=${SUBSCRIBER_ID}`, { method: "POST", headers, body: JSON.stringify(body) })
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`Google Health ${res.status}:`, JSON.stringify(data, null, 2))
    if (res.status === 400 && /FAILED_PRECONDITION|verification/i.test(JSON.stringify(data))) {
      console.error("\nGoogle couldn't verify the endpoint. Is the app deployed with GOOGLE_HEALTH_WEBHOOK_SECRET set to the same value?")
    }
    process.exit(1)
  }
  console.log("OK:", JSON.stringify(data, null, 2))
  console.log(`\nDone. Google will now POST to ${body.endpointUri} when a connected user's data changes.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
