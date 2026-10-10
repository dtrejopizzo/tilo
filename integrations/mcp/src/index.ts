#!/usr/bin/env node
// Local Tilo MCP server (stdio). For Claude, ChatGPT and other clients that support remote MCP,
// prefer https://<your-tilo>/api/mcp: same tools, OAuth sign-in, nothing to install.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { localDate, TiloClient } from "@tilo/core/client"
import { registerTiloTools } from "@tilo/core/mcp"

const apiUrl = process.env.TILO_API_URL
const apiToken = process.env.TILO_API_TOKEN

if (!apiUrl || !apiToken) {
  console.error(
    "tilo-mcp: set TILO_API_URL (e.g. https://your-tilo.vercel.app) and TILO_API_TOKEN " +
      "(generate one in Tilo → Settings → VSCode y MCP)",
  )
  process.exit(1)
}

const server = new McpServer({ name: "tilo", version: "1.0.0" })
registerTiloTools(server, new TiloClient(apiUrl, apiToken), () => localDate())
await server.connect(new StdioServerTransport())
