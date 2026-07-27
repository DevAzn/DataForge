"""
Incremental delivery jobs: plan random-sized chunks over a window so min and max
chunk sizes each appear at least once; run chunks on demand (or future cron).

SQLite stores job metadata + plan only. Generated artifacts write to disk paths.
"""
from __future__ import annotations

import json
import random
import re
import uuid
from pathlib import Path
from typing import Any

from app import database as db
from app.services import package_svc


def _can_guarantee_min_and_max(target: int, chunk_min: int, chunk_max: int) -> bool:
    """
    True when we can build chunks in [chunk_min, chunk_max] that sum to target
    and include both chunk_min and chunk_max at least once.
    """
    if target < chunk_min + chunk_max:
        return False
    remaining = target - chunk_min - chunk_max
    # Remaining must be partitionable into pieces each in [min, max], or zero.
    # A positive remainder strictly less than min cannot form a valid extra chunk
    # without breaking bounds (and dumping onto min/max can erase the other).
    if remaining == 0:
        return True
    if remaining < chunk_min:
        return False
    return True


def _fill_remaining(
    remaining: int,
    chunk_min: int,
    chunk_max: int,
    rng: random.Random,
) -> list[int]:
    """Partition remaining into sizes in [chunk_min, chunk_max] (best effort)."""
    chunks: list[int] = []
    while remaining > 0:
        if remaining <= chunk_max:
            chunks.append(remaining)
            break
        upper = min(chunk_max, remaining)
        lower = chunk_min
        # Prefer leaving a valid tail when possible
        if remaining - upper > 0 and remaining - upper < chunk_min:
            upper = remaining - chunk_min
            upper = max(chunk_min, min(chunk_max, upper))
        if upper < lower:
            chunks.append(remaining)
            break
        size = rng.randint(lower, upper)
        size = max(1, min(size, remaining))
        chunks.append(size)
        remaining -= size
    return chunks


def build_chunk_plan(
    target: int,
    chunk_min: int,
    chunk_max: int,
    *,
    seed: int | None = None,
) -> list[int]:
    """
    Plan chunk sizes summing to target.
    Guarantees chunk_min and chunk_max each appear at least once when target allows
    (i.e. when both fit and the remainder can be partitioned into valid chunk sizes).
    """
    target = max(1, int(target))
    chunk_min = max(1, int(chunk_min))
    chunk_max = max(chunk_min, int(chunk_max))
    rng = random.Random(seed if seed is not None else random.randint(0, 2**31 - 1))

    if target <= chunk_max:
        # Single chunk — may equal min, max, or something in between / below min
        return [target]

    if not _can_guarantee_min_and_max(target, chunk_min, chunk_max):
        # Cannot place both min and max as separate in-range chunks; best-effort fill
        chunks = _fill_remaining(target, chunk_min, chunk_max, rng)
        # Prefer including min when possible without changing the total
        if chunk_min not in chunks and chunks and target >= chunk_min:
            for i, c in enumerate(chunks):
                if c >= chunk_min and c != chunk_max:
                    chunks[i] = chunk_min
                    break
        return chunks if sum(chunks) == target else _rebalance(chunks, target)

    # Reserve min and max once; partition the rest into valid sizes
    remaining = target - chunk_min - chunk_max
    chunks = [chunk_min, chunk_max] + _fill_remaining(remaining, chunk_min, chunk_max, rng)
    chunks = chunks if sum(chunks) == target else _rebalance(chunks, target)
    rng.shuffle(chunks)

    # Soft guarantees — never crash the API over plan shape
    if sum(chunks) != target:
        chunks = _rebalance(chunks, target)
    return chunks


def _rebalance(chunks: list[int], target: int) -> list[int]:
    s = sum(chunks)
    if s == target:
        return chunks
    if not chunks:
        return [target]
    chunks = list(chunks)
    chunks[-1] += target - s
    if chunks[-1] <= 0:
        chunks[-1] = 1
    return chunks


def create_job(data: dict[str, Any]) -> dict[str, Any]:
    target = max(1, int(data.get("targetTotal") or 100))
    chunk_min = max(1, int(data.get("chunkMin") or 1))
    chunk_max = max(chunk_min, int(data.get("chunkMax") or chunk_min))
    seed = data.get("seed")
    if seed is not None:
        try:
            seed = int(seed)
        except (TypeError, ValueError):
            seed = None
    plan = build_chunk_plan(target, chunk_min, chunk_max, seed=seed)
    job_id = str(uuid.uuid4())
    name = (data.get("name") or "").strip() or f"delivery-{job_id[:8]}"
    dest_type = data.get("destinationType") or "local_dir"
    dest_path = (data.get("destinationPath") or "").strip() or None
    package_id = data.get("packageId")
    if not package_id:
        raise ValueError("packageId is required")
    if not db.get_package(package_id):
        raise ValueError("Package not found")

    doc = {
        "id": job_id,
        "name": name,
        "packageId": package_id,
        "targetTotal": target,
        "windowHours": max(1, int(data.get("windowHours") or 24)),
        "chunkMin": chunk_min,
        "chunkMax": chunk_max,
        "destinationType": dest_type,
        "destinationPath": dest_path,
        "status": "planned",
        "sentTotal": 0,
        "nextChunkIndex": 0,
        "plan": plan,
        "seed": seed,
        "createdAt": db.now_iso(),
        "updatedAt": db.now_iso(),
    }
    return db.save_delivery_job(doc)


def run_next_chunk(
    job_id: str,
    *,
    history_lookup=None,
    custom_lookup=None,
    theme_lookup=None,
    theme_prefer: bool = True,
) -> dict[str, Any]:
    job = db.get_delivery_job(job_id)
    if not job:
        raise ValueError("Job not found")
    if job["status"] == "completed":
        return {
            "ok": True,
            "message": "Job already completed",
            "sentTotal": job["sentTotal"],
            "targetTotal": job["targetTotal"],
            "status": job["status"],
        }

    plan: list[int] = job.get("plan") or []
    idx = int(job.get("nextChunkIndex") or 0)
    if idx >= len(plan):
        job["status"] = "completed"
        db.save_delivery_job(job)
        return {
            "ok": True,
            "message": "No more chunks",
            "sentTotal": job["sentTotal"],
            "targetTotal": job["targetTotal"],
            "status": "completed",
        }

    size = int(plan[idx])
    package_id = job["packageId"]
    seed = job.get("seed")
    # Offset seed per chunk for variety
    chunk_seed = (int(seed) + idx * 9973) & 0xFFFFFFFF if seed is not None else None

    result = package_svc.generate_package_variants(
        package_id,
        record_count=size,
        seed=chunk_seed,
        ci_mode=False,
        record_history=False,
        default_field_mode="random",
        history_lookup=history_lookup,
        custom_lookup=custom_lookup,
        theme_lookup=theme_lookup,
        theme_prefer=theme_prefer,
        settings=db.get_settings(),
    )

    # Write artifact to destination
    out_dir = _resolve_dest_dir(job)
    out_dir.mkdir(parents=True, exist_ok=True)
    import base64

    raw = base64.b64decode(result.get("zipBase64") or result.get("archiveBase64") or "")
    # Prefer tar.gz when chunk has multiple package variants (matches package_svc default)
    from app.services import archive_svc

    arch_ext = archive_svc.extension_for_format(
        result.get("archiveFormat") or archive_svc.default_bundle_format(size)
    )
    # Keep result's chosen extension if fileName already set
    result_name = result.get("fileName") or ""
    if result_name.endswith(".tar.gz"):
        arch_ext = ".tar.gz"
    elif result_name.endswith(".zip"):
        arch_ext = ".zip"
    artifact = f"chunk_{idx + 1:04d}_{size}vars{arch_ext}"
    out_path = out_dir / artifact
    out_path.write_bytes(raw)

    # Record chunk meta (not file body in sqlite — just path/name)
    db.add_delivery_chunk(
        {
            "id": str(uuid.uuid4()),
            "jobId": job_id,
            "seq": idx,
            "size": size,
            "status": "done",
            "artifactName": artifact,
            "artifactPath": str(out_path),
            "sentAt": db.now_iso(),
        }
    )

    job["sentTotal"] = int(job.get("sentTotal") or 0) + size
    job["nextChunkIndex"] = idx + 1
    job["status"] = "running" if job["nextChunkIndex"] < len(plan) else "completed"
    job["updatedAt"] = db.now_iso()
    db.save_delivery_job(job)

    return {
        "ok": True,
        "message": f"Wrote chunk {idx + 1}/{len(plan)} ({size} variants) → {out_path}",
        "chunkIndex": idx,
        "chunkSize": size,
        "artifactPath": str(out_path),
        "sentTotal": job["sentTotal"],
        "targetTotal": job["targetTotal"],
        "status": job["status"],
        "planLength": len(plan),
        "chunksDone": job["nextChunkIndex"],
    }


def _resolve_dest_dir(job: dict[str, Any]) -> Path:
    custom = (job.get("destinationPath") or "").strip()
    if custom:
        return Path(custom).expanduser()
    base = db.DATA_DIR / "exports" / "delivery" / job["id"]
    return base


def job_summary(job: dict[str, Any]) -> dict[str, Any]:
    plan = job.get("plan") or []
    return {
        "id": job["id"],
        "name": job["name"],
        "packageId": job.get("packageId"),
        "status": job.get("status"),
        "sentTotal": job.get("sentTotal") or 0,
        "targetTotal": job.get("targetTotal"),
        "chunkMin": job.get("chunkMin"),
        "chunkMax": job.get("chunkMax"),
        "windowHours": job.get("windowHours"),
        "destinationPath": job.get("destinationPath"),
        "destinationType": job.get("destinationType"),
        "planLength": len(plan),
        "chunksDone": job.get("nextChunkIndex") or 0,
        "plan": plan,
        "seed": job.get("seed"),
        "createdAt": job.get("createdAt"),
        "updatedAt": job.get("updatedAt"),
    }
