import { NextResponse } from "next/server"
import { authServerMetadata } from "@/lib/server/mcpOauth"

export const GET = () => NextResponse.json(authServerMetadata(), { headers: { "Access-Control-Allow-Origin": "*" } })
