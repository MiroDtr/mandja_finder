const PASSWORD_KEY = "mandja-password";

export function getPassword(): string {
  try {
    return localStorage.getItem(PASSWORD_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setPassword(value: string) {
  try {
    if (value) localStorage.setItem(PASSWORD_KEY, value);
    else localStorage.removeItem(PASSWORD_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class AuthError extends Error {}

/** Listeners are told when the server rejects the saved password. */
export const authListeners = new Set<() => void>();

export async function callAI<T>(task: string, payload: object = {}, password = getPassword()): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-password": password },
      body: JSON.stringify({ task, ...payload }),
    });
  } catch {
    throw new Error("Няма връзка със сървъра.");
  }
  if (!res.ok) {
    let message = `Грешка ${res.status}`;
    try {
      message = (await res.json()).error ?? message;
    } catch {
      /* not JSON */
    }
    if (res.status === 401) {
      setPassword("");
      authListeners.forEach((fn) => fn());
      throw new AuthError(message);
    }
    throw new Error(message);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Отговорът беше прекъснат. Опитай отново.");
  }
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
