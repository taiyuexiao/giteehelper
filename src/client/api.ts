const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${baseUrl}/api`;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function getToken() {
  return localStorage.getItem("giteehelper-token") ?? "";
}

export function setToken(token: string) {
  localStorage.setItem("giteehelper-token", token);
}

export function clearToken() {
  localStorage.removeItem("giteehelper-token");
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API}${path}`, { ...options, headers });
  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("giteehelper:unauthorized"));
  }
  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // 反向代理或网关可能返回 HTML，直接 JSON.parse 会抛出难以定位的 SyntaxError
      throw new ApiError(response.status, `服务器返回了非 JSON 响应（HTTP ${response.status}）`);
    }
  }
  if (!response.ok) {
    const message = (data as { error?: string }).error ?? `请求失败：${response.status}`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

/** 需要鉴权的文件下载不能直接用 <a href>，否则不会带上 Bearer Token。 */
export async function downloadFile(path: string, filename: string) {
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API}${path}`, { headers });
  if (response.status === 401) {
    clearToken();
    window.dispatchEvent(new Event("giteehelper:unauthorized"));
  }
  if (!response.ok) throw new ApiError(response.status, `下载失败：HTTP ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
