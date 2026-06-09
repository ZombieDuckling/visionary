import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from visionary.comm.blackboard import BlackboardConflictError

router = APIRouter()


class PutRequest(BaseModel):
    value: dict
    by: str | None = None
    expected_version: int | None = None


@router.get("/api/blackboard/{key}")
async def get_bb(key: str, request: Request) -> dict:
    comm = request.app.state.comm
    row = comm.bb_get(key)
    if row is None:
        raise HTTPException(status_code=404, detail=f"key not found: {key}")
    return {
        "key": row["key"],
        "value": json.loads(row["value_json"]),
        "version": row["version"],
        "updated_by": row["updated_by"],
        "updated_at": row["updated_at"],
    }


@router.put("/api/blackboard/{key}")
async def put_bb(key: str, req: PutRequest, request: Request) -> dict:
    comm = request.app.state.comm
    try:
        version = comm.bb_set(key, req.value, req.by, req.expected_version)
    except BlackboardConflictError as e:
        raise HTTPException(status_code=409, detail=str(e)) from e
    return {"key": key, "version": version}


@router.delete("/api/blackboard/{key}")
async def delete_bb(key: str, request: Request) -> dict:
    comm = request.app.state.comm
    comm.bb_delete(key)
    return {"ok": True, "key": key}
