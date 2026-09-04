"""Upload a folder of experiment renders (images/videos with embedded metadata) to Supabase.

The metadata is expected to be embedded the same way ml-api-requester writes it:
- images: EXIF tag 270 (ImageDescription) holds a JSON string
- videos (.mp4): MP4 "\\xa9cmt" (comment) atom holds a JSON string

Each file is matched to a "request" via metadata["request_file_name"] (falls back to
the file's own stem if missing). All files uploaded together with the same --tag are
grouped under a single "experiment" row, so re-running the requester with a different
tag/config and uploading the results lets you compare two experiments request-by-request.

Usage:
    python upload_results.py --folder ./out/baseline --tag baseline --name "Baseline v1"
    python upload_results.py --folder ./out/magcache --tag magcache --name "MagCache"
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
from pathlib import Path

from dotenv import load_dotenv
from mutagen.mp4 import MP4
from PIL import Image
from supabase import Client, create_client

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".webm"}

BUCKET = "renders"

# Volatile/noisy metadata keys that don't describe the experiment itself.
CONFIG_EXCLUDED_KEYS = {
    "tag",
    "timings",
    "task_uuid",
    "request_file_name",
    "provider",
    "callback_url",
    "nsfw_check",
    "prefix",
}


def load_env() -> tuple[str, str]:
    """Load the Supabase project URL + public API key from the repo-root .env."""
    # override=True: some shells export unrelated SUPABASE_URL/SUPABASE_KEY globally,
    # which would otherwise silently take precedence over this project's .env.
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=True)
    url = os.environ.get("SUPABASE_URL")
    if not url:
        project_id = os.environ.get("SUPABASE_PROJECT_ID")
        if not project_id:
            raise SystemExit("Set SUPABASE_URL or SUPABASE_PROJECT_ID in your .env")
        url = f"https://{project_id}.supabase.co"
    key = os.environ.get("SUPABASE_API_KEY")
    if not key:
        raise SystemExit("Set SUPABASE_API_KEY in your .env")
    return url, key


def extract_metadata(path: Path) -> dict:
    """Read the JSON metadata embedded by ml-api-requester in a result file."""
    ext = path.suffix.lower()
    raw = "{}"
    if ext in IMAGE_EXTENSIONS:
        with Image.open(path) as image:
            exif = image.getexif()
            raw = exif.get(270, "{}")
    elif ext == ".mp4":
        video = MP4(str(path))
        raw = (video.tags or {}).get("\xa9cmt", ["{}"])[0]
    else:
        return {}

    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {}


def media_type_of(path: Path) -> str | None:
    ext = path.suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        return "image"
    if ext in VIDEO_EXTENSIONS:
        return "video"
    return None


def request_id_of(path: Path, metadata: dict) -> str:
    request_file_name = metadata.get("request_file_name")
    if request_file_name:
        return Path(request_file_name).stem
    return path.stem


def get_or_create_experiment(client: Client, tag: str, name: str, config: dict) -> str:
    existing = client.table("experiments").select("id").eq("tag", tag).limit(1).execute()
    if existing.data:
        return existing.data[0]["id"]
    created = client.table("experiments").insert({"name": name, "tag": tag, "config": config}).execute()
    return created.data[0]["id"]


def upload_file(client: Client, tag: str, path: Path) -> str:
    dest_path = f"{tag}/{path.name}"
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        client.storage.from_(BUCKET).upload(
            dest_path,
            f.read(),
            {"content-type": content_type, "upsert": "true"},
        )
    return client.storage.from_(BUCKET).get_public_url(dest_path)


def find_render_by_task_uuid(client: Client, experiment_id: str, task_uuid: str) -> dict | None:
    """task_uuid uniquely identifies a render; reuse it to skip already-uploaded files."""
    existing = (
        client.table("renders")
        .select("request_id")
        .eq("experiment_id", experiment_id)
        .eq("task_uuid", task_uuid)
        .limit(1)
        .execute()
    )
    return existing.data[0] if existing.data else None


def upsert_render(client: Client, experiment_id: str, request_id: str, media_url: str, media_type: str, metadata: dict):
    client.table("renders").upsert(
        {
            "experiment_id": experiment_id,
            "request_id": request_id,
            "media_url": media_url,
            "media_type": media_type,
            "task_uuid": metadata.get("task_uuid"),
            "metadata": metadata,
            "timings": metadata.get("timings") or {},
        },
        on_conflict="experiment_id,request_id",
    ).execute()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--folder", required=True, help="Folder containing rendered images/videos to upload")
    parser.add_argument("--tag", help="Experiment tag (defaults to the 'tag' found in each file's metadata)")
    parser.add_argument("--name", help="Human-readable experiment name (defaults to the tag)")
    args = parser.parse_args()

    folder = Path(args.folder)
    if not folder.is_dir():
        raise SystemExit(f"Not a folder: {folder}")

    url, key = load_env()
    client = create_client(url, key)

    files = [p for p in sorted(folder.rglob("*")) if p.is_file() and media_type_of(p)]
    if not files:
        raise SystemExit(f"No image/video files found in {folder}")

    experiment_id: str | None = None
    experiment_tag: str | None = None
    uploaded = 0
    skipped = 0

    for path in files:
        media_type = media_type_of(path)
        metadata = extract_metadata(path)

        tag = args.tag or metadata.get("tag")
        if not tag:
            print(f"⚠️  Skipping {path.name}: no --tag given and no 'tag' in metadata")
            skipped += 1
            continue

        if experiment_id is None:
            experiment_tag = tag
            name = args.name or tag
            config = {k: v for k, v in metadata.items() if k not in CONFIG_EXCLUDED_KEYS}
            experiment_id = get_or_create_experiment(client, tag, name, config)
            print(f"📦 Experiment '{name}' (tag={tag}) -> {experiment_id}")
        elif tag != experiment_tag:
            print(f"⚠️  Skipping {path.name}: tag '{tag}' differs from experiment tag '{experiment_tag}'")
            skipped += 1
            continue

        request_id = request_id_of(path, metadata)
        task_uuid = metadata.get("task_uuid")
        if task_uuid:
            existing = find_render_by_task_uuid(client, experiment_id, task_uuid)
            if existing:
                print(f"⏭️  {path.name} -> task_uuid already uploaded (request '{existing['request_id']}'), skipping")
                skipped += 1
                continue

        media_url = upload_file(client, tag, path)
        upsert_render(client, experiment_id, request_id, media_url, media_type, metadata)
        print(f"✅ {path.name} -> request '{request_id}'")
        uploaded += 1

    print(f"\nDone: {uploaded} uploaded, {skipped} skipped.")


if __name__ == "__main__":
    main()
