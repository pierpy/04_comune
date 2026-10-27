// Google Calendar API v3 in sola lettura, con token OAuth ottenuto da chrome.identity.

const API = 'https://www.googleapis.com/calendar/v3';

export function getToken(interactive = true) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) reject(new Error(chrome.runtime.lastError?.message || 'Accesso a Google non concesso'));
      else resolve(typeof token === 'string' ? token : token.token);
    });
  });
}

async function gget(path, params = {}, retry = true) {
  const token = await getToken(true);
  const url = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401 && retry) {
    // Token scaduto o revocato: lo togliamo dalla cache e riproviamo una volta.
    await new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r));
    return gget(path, params, false);
  }
  if (!res.ok) throw new Error(`Google Calendar ha risposto ${res.status}`);
  return res.json();
}

export async function listCalendars() {
  const data = await gget('/users/me/calendarList', { minAccessRole: 'reader' });
  return (data.items || []).map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, primary: Boolean(c.primary), color: c.backgroundColor }));
}

/** Eventi di un calendario con le ricorrenze già espanse (singleEvents=true). */
export async function listEvents(calendarId, from, to) {
  const items = [];
  let pageToken;
  do {
    const data = await gget(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      pageToken,
    });
    items.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return items;
}
