import {
  type ConnInfo,
  type Handler,
  serve,
} from "https://deno.land/std@0.161.0/http/server.ts";
import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.0.5";
import { createServerClient } from "./supabase_server_client.ts";

export type SupabaseHandler<
  Database = Record<string, unknown>,
  SchemaName extends string & keyof Database = "public" extends keyof Database
    ? "public"
    : string & keyof Database
> = (
  request: Request,
  client: SupabaseClient<Database, SchemaName>,
  connInfo: ConnInfo
) => Response | Promise<Response>;

export function serveWithSupabase(handler: SupabaseHandler) {
  const fetchHandler: Handler = async (request, connInfo) => {
    const { client, withSessionCookie } = createServerClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        request,
      }
    );
    const response = await handler(request, client, connInfo);
    return withSessionCookie(response);
  };
  return serve(fetchHandler);
}
