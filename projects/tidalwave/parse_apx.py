#!/usr/bin/env python3
"""Parse a .apx (Attempt Playback mod v8) file and dump per-attempt metadata as JSON.

Reads the ORIGINAL file read-only, writes a fresh copy of the .apx alongside
the JSON so the game's file is never touched. Format reference:
https://github.com/manshoety/AttemptPlaybackMod/blob/main/src/core/apx_io.cpp
"""
import json
import shutil
import struct
import sys
from pathlib import Path

CHUNK_ATT3 = 0x33545441  # 'ATT3'
CHUNK_PATH = 0x48544150  # 'PATH'
CHUNK_ATTZ = 0x5A545441  # legacy
CHUNK_SEGZ = 0x5A474553  # legacy
CHUNK_CP_Z2 = 0x325A5043  # legacy

# APXMetaCompactPrefix_ (packed - fields fall on natural boundaries, 32 bytes)
#   uint32 serial, float startPct, float endPct, u8 flags, u8 _pad1,
#   uint16 streamVersion, uint32 p1Count, uint32 p2Count, float startX, float startY
PREFIX_FMT = "<I f f B B H I I f f"
PREFIX_SIZE = struct.calcsize(PREFIX_FMT)  # 32

TAIL_V2_FMT = "<d Q"           # baseTimeOffset, seed  -> 16 bytes
TAIL_V2_SIZE = struct.calcsize(TAIL_V2_FMT)

# V1 tail: int32 startCheckpointId, double baseTimeOffset, uint64 seed
# In C++ the double forces 8-byte alignment -> 4 pad bytes after the int32.
TAIL_V1_FMT = "<i 4x d Q"
TAIL_V1_SIZE = struct.calcsize(TAIL_V1_FMT)  # 24

TRACK_HDR_FMT = "<I"
TRACK_HDR_SIZE = 4


def parse_apx(path: Path, verbose: bool = True):
    data = path.read_bytes()
    if len(data) < 8 or data[:4] != b"APX2":
        raise ValueError(f"Not an APX2 file: {path}")
    version = struct.unpack_from("<I", data, 4)[0]

    attempts = []
    skipped_versions: dict[int, int] = {}
    other_chunks: dict[str, int] = {}
    off = 8
    while off < len(data):
        if off + 8 > len(data):
            if verbose and off != len(data):
                print(f"  ! trailing {len(data)-off} bytes at EOF (no chunk header)")
            break
        chunk_type, chunk_size = struct.unpack_from("<II", data, off)
        off += 8
        payload_start = off
        payload_end = off + chunk_size
        if payload_end > len(data):
            if verbose:
                print(f"  ! chunk at {off-8} says size={chunk_size} but only "
                      f"{len(data)-off} bytes remain — stopping")
            break

        if chunk_type == CHUNK_ATT3:
            p = payload_start
            (serial, start_pct, end_pct, flags, _pad, stream_ver,
             p1_count, p2_count, start_x, start_y) = struct.unpack_from(
                PREFIX_FMT, data, p
            )
            p += PREFIX_SIZE
            if stream_ver == 2:
                base_time, seed = struct.unpack_from(TAIL_V2_FMT, data, p)
                p += TAIL_V2_SIZE
            elif stream_ver == 1:
                _cp_id, base_time, seed = struct.unpack_from(TAIL_V1_FMT, data, p)
                p += TAIL_V1_SIZE
            else:
                skipped_versions[stream_ver] = skipped_versions.get(stream_ver, 0) + 1
                off = payload_end
                continue

            attempts.append({
                "serial": serial,
                "startPercent": round(start_pct, 4),
                "endPercent": round(end_pct, 4),
                "practice": bool(flags & 1),
                "completed": bool(flags & 2),
                "hadDual": bool(flags & 4),
                "startX": round(start_x, 3),
                "startY": round(start_y, 3),
                "baseTimeOffset": base_time,
                "p1Frames": p1_count,
                "p2Frames": p2_count,
            })
        else:
            # tag other chunk types so we can see what's in the file
            tag = chunk_type.to_bytes(4, "little", signed=False)
            key = tag.decode("ascii", "replace") if all(32 <= b < 127 for b in tag) \
                  else f"0x{chunk_type:08x}"
            other_chunks[key] = other_chunks.get(key, 0) + 1

        off = payload_end

    if verbose:
        max_serial = max((a["serial"] for a in attempts), default=0)
        print(f"  apx v{version} · {len(attempts)} ATT3 attempts decoded · "
              f"highest serial seen: {max_serial}")
        if other_chunks:
            print(f"  other chunks: {other_chunks}")
        if skipped_versions:
            print(f"  ! skipped ATT3s with unknown streamVersion: {skipped_versions}")

    return {
        "apxVersion": version,
        "levelId": int(path.stem.split("_")[0]),
        "attemptCount": len(attempts),
        "attempts": attempts,
    }


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        "/Users/sandeep/Library/Application Support/GeometryDash/"
        "geode/mods/manshoety.attemptplayback/attempts/86407629_attempts.apx"
    )
    out_dir = Path(__file__).parent

    # 1. Read-only copy of the raw .apx alongside our data (game file untouched)
    apx_copy = out_dir / src.name
    shutil.copyfile(src, apx_copy)

    # 2. Parse and dump JSON
    parsed = parse_apx(apx_copy)
    json_path = out_dir / "attempts.json"
    with json_path.open("w") as f:
        json.dump(parsed, f, separators=(",", ":"))

    print(f"copied  {src}")
    print(f"     -> {apx_copy}")
    print(f"wrote   {json_path}  ({parsed['attemptCount']} attempts)")


if __name__ == "__main__":
    main()
