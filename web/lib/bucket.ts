import { supabase } from "./supabase";

const BUCKET = "renders";

/**
 * Lists every file across the given storage folders (experiment tags) and returns a
 * basename -> public URL map, so metadata that references a local input filename
 * (not a URL) can be resolved to whatever copy of that file ended up in the bucket.
 */
export async function buildBucketBasenameIndex(
  tags: string[],
): Promise<Record<string, string>> {
  const uniqueTags = Array.from(new Set(tags.filter(Boolean)));
  const index: Record<string, string> = {};
  await Promise.all(
    uniqueTags.map(async (tag) => {
      const { data } = await supabase.storage
        .from(BUCKET)
        .list(tag, { limit: 1000 });
      for (const file of data ?? []) {
        if (index[file.name]) continue;
        const path = `${tag}/${file.name}`;
        index[file.name] = supabase.storage.from(BUCKET).getPublicUrl(path)
          .data.publicUrl;
      }
    }),
  );
  return index;
}
