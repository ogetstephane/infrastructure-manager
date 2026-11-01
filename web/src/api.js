export const api = async (method, path, body) => {
  const r = await fetch(`/api/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(localStorage.getItem('operator') ? { 'X-Operator': localStorage.getItem('operator') } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, fields: data.errors });
  return data;
};
