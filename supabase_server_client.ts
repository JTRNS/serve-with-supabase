import { type Cookie } from "https://deno.land/std@0.161.0/http/cookie.ts";
import {
  CookieMap,
  mergeHeaders,
} from "https://deno.land/std@0.161.0/http/cookie_map.ts";
import {
  createClient,
  Session,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.0.5";
import { isNonEmptyString } from "./utils.ts";
import { isNull } from "./utils.ts";

const defaultCookieOptions: Omit<Cookie, "value"> = {
  name: "supabase-auth-token",
  path: "/",
  sameSite: "Lax",
  maxAge: 31536000000,
};

type SessionTokens = [
  Session["access_token"],
  Session["refresh_token"],
  Session["provider_token"],
  Session["provider_refresh_token"]
];

interface SupabaseSessionCookie extends Cookie {
  name: "supabase-auth-token";
  value:
    | string
    | `[${Session["access_token"]},${Session["refresh_token"]},${Session["provider_token"]},${Session["provider_refresh_token"]}]`;
}

function validTokens(
  tokens: Array<string | null | undefined>
): tokens is SessionTokens {
  return (
    isNonEmptyString(tokens[0]) &&
    isNonEmptyString(tokens[1]) &&
    (isNonEmptyString(tokens[2]) || isNull(tokens[2])) &&
    (isNonEmptyString(tokens[3]) || isNull(tokens[3]))
  );
}

function parseSupabaseCookie(
  value?: SupabaseSessionCookie["value"]
): Session | null {
  try {
    if (!value) return null;

    const tokens = JSON.parse(value) as unknown;
    if (!Array.isArray(tokens) || tokens.length !== 4) {
      throw new Error(`Unexpected format: ${value.constructor.name}`);
    }

    if (!validTokens(tokens)) {
      throw new Error("Cookie contains invalid tokens");
    }

    const [
      access_token,
      refresh_token,
      provider_token,
      provider_refresh_token,
    ] = tokens;
    const { exp, sub, ...user } = parseAccessToken(access_token);

    return {
      expires_at: exp,
      expires_in: exp - Math.round(Date.now() / 1000),
      token_type: "bearer",
      access_token,
      refresh_token,
      provider_token,
      provider_refresh_token,
      user: {
        id: sub,
        ...user,
      },
    };
  } catch (err) {
    console.warn("Failed to parse cookie string:", err);
    return null;
  }
}

function stringifySupabaseSession(session: Session): string {
  return JSON.stringify([
    session.access_token,
    session.refresh_token,
    session.provider_token,
    session.provider_refresh_token,
  ]);
}

function parseAccessToken(access_token: Session["access_token"]) {
  let [_header, payload, _signature] = access_token.split(".");
  payload = atob(payload.replace(/[-]/g, "+").replace(/[_]/g, "/"));
  const { exp, sub, ...user } = JSON.parse(payload);
  return { exp, sub, ...user };
}

export function createServerClient(
  supabaseUrl: string,
  supabaseKey: string,
  {
    request,
    response,
    cookieOptions,
  }: {
    request: Request;
    response?: Response;
    cookieOptions?: Partial<Omit<Cookie, "value">>;
  }
): {
  client: SupabaseClient;
  withSessionCookie: (response: Response) => Response;
} {
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "supabaseUrl and supabaseKey are required to create a Supabase client! Find these under `Settings` > `API` in your Supabase dashboard."
    );
  }

  if (!request) {
    throw new Error(
      "request must be passed to createSupabaseClient function, when called from loader or action"
    );
  }

  const sessionCookieOptions = {
    ...defaultCookieOptions,
    ...cookieOptions,
  };

  const sessionResponse = response ?? new Response();

  const cookies = new CookieMap(request, {
    response: sessionResponse,
    secure: new URL(request.url).protocol === "https",
  });

  return {
    client: createClient(supabaseUrl, supabaseKey, {
      auth: {
        detectSessionInUrl: false,
        autoRefreshToken: false,
        storageKey: sessionCookieOptions["name"],
        storage: {
          getItem(key: string) {
            const session = parseSupabaseCookie(cookies.get(key));
            return session ? JSON.stringify(session) : null;
          },
          setItem(key: string, value: string) {
            const session = JSON.parse(value) as Session;
            cookies.set(key, stringifySupabaseSession(session));
          },
          removeItem(key: string) {
            cookies.set(key, null);
          },
        },
      },
    }),
    withSessionCookie: (response) => {
      const { body, headers, ...init } = response;
      return new Response(body, {
        headers: mergeHeaders(cookies, headers),
        ...init,
      });
    },
  };
}
