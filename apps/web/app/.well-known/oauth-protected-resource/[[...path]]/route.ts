import { NextResponse } from "next/server"
import { resourceMetadata } from "@/lib/server/mcpOauth"

export const GET = () => NextResponse.json(resourceMetadata(), { headers: { "Access-Control-Allow-Origin": "*" } })
