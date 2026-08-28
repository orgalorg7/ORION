// ---------------------------------------------------------------------------
// Demo mode: an axios adapter that routes every request to the in-browser
// backend instead of the network. The rest of the app is unchanged.
// ---------------------------------------------------------------------------

import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

import { handle } from './backend';
import './routes2';

export async function demoAdapter(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  const base = config.baseURL ?? '';
  let path = config.url ?? '';
  if (base && path.startsWith(base)) path = path.slice(base.length);
  if (/^https?:\/\//.test(path)) path = new URL(path).pathname.replace(/^\/api\/v1/, '');
  if (!path.startsWith('/')) path = `/${path}`;

  const headers: Record<string, string> = {};
  const rawHeaders =
    config.headers instanceof AxiosHeaders ? config.headers.toJSON() : (config.headers ?? {});
  for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
    if (value !== undefined && value !== null) headers[key.toLowerCase()] = String(value);
  }

  const result = handle({
    method: (config.method ?? 'get').toUpperCase(),
    path,
    params: (config.params ?? {}) as Record<string, unknown>,
    data: config.data,
    headers,
  });

  const response: AxiosResponse = {
    data: result.data,
    status: result.status,
    statusText: result.status >= 400 ? 'Error' : 'OK',
    headers: {},
    config,
    request: {},
  };
  if (result.status >= 400) {
    const code = result.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST;
    throw new AxiosError(
      `Request failed with status code ${result.status}`,
      code,
      config,
      response.request,
      response,
    );
  }
  return response;
}
