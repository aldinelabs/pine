export type WebSignInResult =
  | { status: "signed-in" }
  | { status: "wrong-password" }
  | { status: "locked"; retryAfter: number }
  | { status: "unavailable" };

/** Whether this browser has to sign in before Pine's data can load. */
export async function browserNeedsSignIn(): Promise<boolean> {
  return (await fetch("/api/session")).status === 401;
}

export async function signInBrowser(
  password: string,
): Promise<WebSignInResult> {
  let response: Response;
  try {
    response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  } catch {
    return { status: "unavailable" };
  }
  if (response.ok) return { status: "signed-in" };
  if (response.status === 401) return { status: "wrong-password" };
  if (response.status === 429)
    return {
      status: "locked",
      retryAfter: Number(response.headers.get("Retry-After")) || 30,
    };
  return { status: "unavailable" };
}
