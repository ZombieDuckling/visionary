// MCP (Model Context Protocol) connector — STUB.
//
// Odysseus uses MCP to let its single agent reach external tool servers
// (Linear, Slack, browser drivers, etc.). For Visionary to do the same we
// need the MCP SDK as a dependency, which breaks the project rule of "only
// better-sqlite3". Decide whether to add that dep before wiring this in.
//
// Implementation plan when we're ready:
//   1. `npm i @modelcontextprotocol/sdk`
//   2. Add an `mcp_servers` table: id, name, transport (stdio|sse|http),
//      command/args/url, allowed_agents (JSON array).
//   3. On boot, spawn a stdio client per registered server, collect tool
//      descriptors (tools/list).
//   4. Extend runtime adapters so when an agent's dispatch prompt requests a
//      tool, we route to the MCP client. (Each runtime expresses tools
//      differently — claude-code via Tool Use, codex via function calling,
//      etc. The mcp.js shim normalizes these.)
//   5. Surface MCP servers + their tools in Settings: enable/disable per agent.
//
// References:
//   - odysseus/src/mcp_manager.py — connection lifecycle pattern
//   - odysseus/src/builtin_mcp.py — local MCP server implementations
//   - https://modelcontextprotocol.io — spec

function notImplemented() {
  return {
    error: 'MCP integration not yet enabled',
    next_step: 'npm i @modelcontextprotocol/sdk and follow the plan in src/mcp.js'
  };
}

module.exports = {
  enabled: false,
  listServers: notImplemented,
  listTools: notImplemented,
  callTool: notImplemented
};
