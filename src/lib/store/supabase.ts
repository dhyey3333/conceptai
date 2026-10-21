/**
 * Optional Supabase backend. Each browser signs in anonymously, and RLS
 * policies (supabase/schema.sql) restrict every row to its owner. Only the
 * public anon key is used here; no service keys ever reach the client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { lessonMeta, noteMeta, type Lesson, type Note } from "@/lib/lesson/types";
import type { Backend } from "./index";

export async function supabaseBackend(): Promise<Backend | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || typeof window === "undefined") return null;

  const { createClient } = await import("@supabase/supabase-js");
  const sb: SupabaseClient = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await sb.auth.getSession();
  let userId = data.session?.user.id;
  if (!userId) {
    const { data: signIn, error } = await sb.auth.signInAnonymously();
    if (error || !signIn.user) throw error ?? new Error("Anonymous sign-in failed (enable it in Supabase Auth settings).");
    userId = signIn.user.id;
  }
  const uid = userId;

  const check = <T>(r: { data: T; error: unknown }) => {
    if (r.error) throw r.error;
    return r.data;
  };

  return {
    name: "supabase",
    async listLessons() {
      const rows = check(
        await sb.from("lessons").select("id,title,topic,subject,sample,updated_at").order("updated_at", { ascending: false }).limit(200),
      ) as { id: string; title: string; topic: string; subject: string | null; sample: boolean | null; updated_at: string }[];
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        topic: r.topic,
        subject: r.subject ?? undefined,
        sample: r.sample ?? undefined,
        updatedAt: Date.parse(r.updated_at),
      }));
    },
    async getLesson(id) {
      const row = check(await sb.from("lessons").select("data").eq("id", id).maybeSingle()) as { data: Lesson } | null;
      return row?.data;
    },
    async saveLesson(l) {
      const m = lessonMeta(l);
      check(
        await sb.from("lessons").upsert({
          id: l.id,
          user_id: uid,
          title: m.title,
          topic: l.topic,
          subject: m.subject ?? null,
          sample: !!l.sample,
          data: l,
          updated_at: new Date(l.updatedAt).toISOString(),
        }),
      );
    },
    async deleteLesson(id) {
      check(await sb.from("lessons").delete().eq("id", id));
    },
    async listNotes() {
      const rows = check(
        await sb.from("notes").select("id,title,topic,content,updated_at").order("updated_at", { ascending: false }).limit(200),
      ) as { id: string; title: string; topic: string; content: string; updated_at: string }[];
      return rows.map((r) => noteMeta({ ...r, updatedAt: Date.parse(r.updated_at) } as unknown as Note));
    },
    async allNotes() {
      const rows = check(await sb.from("notes").select("data").order("updated_at", { ascending: false }).limit(200)) as { data: Note }[];
      return rows.map((r) => r.data);
    },
    async getNote(id) {
      const row = check(await sb.from("notes").select("data").eq("id", id).maybeSingle()) as { data: Note } | null;
      return row?.data;
    },
    async saveNote(n) {
      check(
        await sb.from("notes").upsert({
          id: n.id,
          user_id: uid,
          title: n.title,
          topic: n.topic,
          content: n.content,
          data: n,
          updated_at: new Date(n.updatedAt).toISOString(),
        }),
      );
    },
    async deleteNote(id) {
      check(await sb.from("notes").delete().eq("id", id));
    },
  };
}
