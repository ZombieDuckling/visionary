"""Failover engine — walks an agent's harness_chain on exhaustion.

Each agent has `harness_chain` (CSV) and `current_harness`. We start at
current_harness in the chain, try it, fail over on exhaustion to the next.
On success, persist user+assistant turns to agent_messages and update
current_harness if it changed.
"""

import logging
from typing import Sequence

from visionary.db.database import Database
from visionary.db.statements import Statements
from visionary.runtimes.base import DispatchContext, DispatchResult
from visionary.runtimes.registry import Registry

logger = logging.getLogger("visionary.runtimes.failover")


def _resolve_chain_from(chain: Sequence[str], current: str) -> list[str]:
    """Start the iteration at `current`, then walk forward."""
    chain = list(chain)
    if current in chain:
        i = chain.index(current)
        return chain[i:]
    return chain


async def execute_with_failover(
    db: Database,
    registry: Registry,
    agent_id: str,
    ctx: DispatchContext,
) -> DispatchResult:
    stmts = Statements(db)
    agent = stmts.get_agent_by_id(agent_id)
    if agent is None:
        return DispatchResult(
            ok=False, output="", error=f"agent not found: {agent_id}",
            exhausted=False,
        )

    chain_csv = agent.get("harness_chain") or ""
    chain = [s.strip() for s in chain_csv.split(",") if s.strip()]
    current = agent.get("current_harness") or (chain[0] if chain else "")
    sequence = _resolve_chain_from(chain, current)

    last_result: DispatchResult | None = None
    for harness in sequence:
        adapter = registry.get(harness)
        if adapter is None:
            logger.info("skipping unregistered harness '%s' for agent %s", harness, agent_id)
            continue

        result = await adapter.dispatch(ctx)
        last_result = result

        if result.ok:
            stmts.insert_agent_message(agent_id, "user", ctx.prompt, harness)
            stmts.insert_agent_message(agent_id, "assistant", result.output, harness)
            if current != harness:
                stmts.update_agent_harness(agent_id, harness)
            stmts.update_agent_health(agent_id, "ok")
            stmts.insert_agent_health_log(agent_id, "ok", harness)
            return result

        if result.exhausted:
            stmts.insert_agent_health_log(
                agent_id, "exhausted", f"{harness}: {result.error or ''}"
            )
            continue

        stmts.insert_agent_health_log(
            agent_id, "fail", f"{harness}: {result.error or ''}"
        )
        return result

    stmts.update_agent_health(agent_id, "fail")
    if last_result is None:
        return DispatchResult(
            ok=False, output="", error="no harnesses available",
            exhausted=False,
        )
    return DispatchResult(
        ok=False, output="", error="all harnesses exhausted",
        exhausted=True, harness_used=last_result.harness_used,
    )
