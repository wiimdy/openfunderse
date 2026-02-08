#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any


def canonical_json_bytes(obj: Any) -> bytes:
    """
    POC canonicalization:
    - sort keys
    - no whitespace
    - UTF-8
    Note: for cross-language stability, keep numeric values as strings.
    """
    txt = json.dumps(
        obj,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return txt.encode("utf-8")


def _keccak256(data: bytes) -> bytes:
    # Ethereum uses Keccak-256 (not NIST SHA3-256).
    try:
        from Crypto.Hash import keccak  # type: ignore

        h = keccak.new(digest_bits=256)
        h.update(data)
        return h.digest()
    except Exception:
        pass

    try:
        from eth_hash.auto import keccak as eth_keccak  # type: ignore

        return eth_keccak(data)
    except Exception as e:  # pragma: no cover
        raise RuntimeError(
            "Keccak-256 backend not found. Install one of:\n"
            "  pip install pycryptodome\n"
            "  pip install eth-hash[pycryptodome]\n"
        ) from e


def digest(data: bytes, algo: str) -> bytes:
    if algo == "sha256":
        return sha256(data).digest()
    if algo == "keccak256":
        return _keccak256(data)
    raise ValueError(f"Unsupported algo: {algo}")


def hex0x(b: bytes) -> str:
    return "0x" + b.hex()


@dataclass(frozen=True)
class HashResult:
    canonical_json: bytes
    digest: bytes


def compute_hash(obj: Any, algo: str) -> HashResult:
    cj = canonical_json_bytes(obj)
    d = digest(cj, algo)
    return HashResult(canonical_json=cj, digest=d)


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description="OpenClaw POC canonical-json + hash helper")
    p.add_argument("kind", choices=["claim", "intent", "snapshot", "raw"], help="Object kind (used for field checks)")
    p.add_argument("json_path", type=Path, help="Path to JSON file")
    p.add_argument("--algo", choices=["keccak256", "sha256"], default="keccak256")
    p.add_argument("--print-canonical", action="store_true", help="Print canonical JSON to stdout")
    p.add_argument("--set-hash-field", action="store_true", help="Write computed *Hash into claimHash/intentHash/snapshotHash")
    args = p.parse_args(argv)

    obj = json.loads(args.json_path.read_text(encoding="utf-8"))

    # Avoid self-referential hashing: ignore existing hash field on input.
    if args.kind == "claim":
        obj.pop("claimHash", None)
    elif args.kind == "intent":
        obj.pop("intentHash", None)
    elif args.kind == "snapshot":
        obj.pop("snapshotHash", None)

    res = compute_hash(obj, args.algo)
    if args.print_canonical:
        sys.stdout.buffer.write(res.canonical_json + b"\n")

    h = hex0x(res.digest)
    sys.stderr.write(h + "\n")

    if args.set_hash_field and args.kind in ("claim", "intent", "snapshot"):
        full_obj = json.loads(args.json_path.read_text(encoding="utf-8"))
        if args.kind == "claim":
            full_obj["claimHash"] = h
        elif args.kind == "intent":
            full_obj["intentHash"] = h
        else:
            full_obj["snapshotHash"] = h
        args.json_path.write_text(
            json.dumps(full_obj, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

