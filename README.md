# Human Eval

Tiny tool to run **A/B human-preference votes** between rendering experiments (image or video),
backed by Supabase, with a small Next.js voting UI and a Python upload script.

## Concepts

- **Experiment**: one generation run, identified by a unique `tag` (e.g. `baseline`, `magcache`) plus
  the config used to produce it. Created automatically the first time you upload renders for that tag.
- **Render**: one result file (image or video) for a given `request_id` inside an experiment. The
  `request_id` is taken from the result's embedded metadata (`request_file_name`, e.g. `001.json` -> `001`),
  so the same request number across two experiments is what gets compared.
- **Vote**: A/B/tie comparison between two experiments for one shared `request_id`. Left/right placement
  is randomized client-side and experiment identity is hidden until you've voted on every common request.

Everything (tables + storage) is **fully public** (no RLS, public storage bucket) for ease of use — anyone
with the project URL/anon key can read and write. Don't put this in front of the public internet.

## 1. Set up Supabase

1. Open your Supabase project's SQL editor and run [supabase/schema.sql](supabase/schema.sql). It creates the
   `experiments`, `renders`, `votes` tables and a public `renders` storage bucket.
2. Fill in [.env](.env) at the repo root (shared by the Python script and the Next.js app):
   ```
   SUPABASE_PROJECT_ID=bqzsxjvbbkskpuxylqxx
   SUPABASE_URL=https://bqzsxjvbbkskpuxylqxx.supabase.co
   SUPABASE_API_KEY=<anon/public API key from Project Settings > API>
   ```

## 2. Upload experiment renders

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r scripts/requirements.txt

python scripts/upload_results.py --folder /path/to/baseline_outputs --tag baseline --name "Baseline v1"
python scripts/upload_results.py --folder /path/to/magcache_outputs --tag magcache --name "MagCache"
```

The script reads the JSON metadata that `ml-api-requester` embeds in each result file (EXIF tag 270 for
images, the `©cmt` MP4 atom for videos), uploads the file to the `renders` storage bucket, and upserts a
row per request. `--tag` can be omitted if every file already carries a `tag` in its metadata.

## 3. Run the voting interface

```bash
cd web
npm install
npm run dev
```

Open http://localhost:3000, pick two experiments to compare, and vote. Once every shared request has a
vote, the app links to a plain-text results page (win counts + percentages, no charts).

## Notes

- Video pairs are started together via `Promise.all([left.play(), right.play()])` once both `<video>`
  elements report `canplaythrough`, with a "Replay both" button to re-sync manually.
- Votes are canonicalized by sorting the two experiment ids, so it doesn't matter which one you pick as
  "A" or "B" when starting a comparison — the same pair always accumulates into the same vote records.
