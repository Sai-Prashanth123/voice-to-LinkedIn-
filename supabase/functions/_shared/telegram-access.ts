import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export async function isApproved(db: SupabaseClient, chatId: number): Promise<boolean> {
  const { data, error } = await db
    .from("telegram_access")
    .select("status")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) throw new Error(`telegram access lookup failed: ${error.message}`);
  return data?.status === "approved";
}

/** Returns true only when this request created a new pending row. */
export async function requestAccess(db: SupabaseClient, chatId: number): Promise<boolean> {
  const { data, error } = await db
    .from("telegram_access")
    .select("status")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) throw new Error(`telegram access lookup failed: ${error.message}`);
  if (data) return false;

  const result = await db.from("telegram_access").insert({ chat_id: chatId });
  if (result.error) throw new Error(`telegram access request failed: ${result.error.message}`);
  return true;
}

export async function registerAccess(db: SupabaseClient, chatId: number): Promise<void> {
  const now = new Date().toISOString();
  const result = await db.from("telegram_access").upsert({
    chat_id: chatId,
    status: "approved",
    approved_at: now,
    updated_at: now,
  }, { onConflict: "chat_id" });
  if (result.error) throw new Error(`telegram access registration failed: ${result.error.message}`);
}

export async function approveAccess(db: SupabaseClient, chatId: number): Promise<void> {
  const result = await db
    .from("telegram_access")
    .update({ status: "approved", approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("chat_id", chatId);
  if (result.error) throw new Error(`telegram access approval failed: ${result.error.message}`);
}