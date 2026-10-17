// Wake-up hints only: consumers still claim atomically from the durable queue.
export async function* workEvents(base, token, clientId) {
 const abort = new AbortController();
 let timer = setTimeout(() => abort.abort(), 15000);
 let reader;
 try {
  const response = await fetch(base + '/ai/agent-runtime/work/stream?clientId=' + encodeURIComponent(clientId), {
   headers: {Authorization: 'Bearer ' + token, Accept: 'text/event-stream'}, signal: abort.signal,
  });
  clearTimeout(timer);
  if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
   throw Error('Work event stream unavailable HTTP ' + response.status);
  reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', event = '', data = [];
  while (true) {
   timer = setTimeout(() => abort.abort(), 45000);
   const chunk = await reader.read();
   clearTimeout(timer);
   if (chunk.done) throw Error('Work event stream disconnected');
   buffer += decoder.decode(chunk.value, {stream: true});
   if (buffer.length > 65536) throw Error('Work event buffer too large');
   let end;
   while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
    if (!line) {
     if (event === 'ready' || event === 'work_available') {
      const payload = JSON.parse(data.join('\n'));
      if (payload.clientId !== clientId) throw Error('Work event worker mismatch');
      yield payload;
     }
     event = ''; data = [];
    } else if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) {
     data.push(line.slice(5).trim());
     if (data.join('').length > 16384) throw Error('Work event data too large');
    }
   }
  }
 } finally {
  clearTimeout(timer); abort.abort();
  if (reader) await reader.cancel().catch(() => undefined);
 }
}
