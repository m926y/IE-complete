// Isolated PostgREST substitute for account integration tests and local UI preview.
// Never connects to a business database or model service.
import { createServer } from 'node:http';
import { scryptSync } from 'node:crypto';
export function passwordHash(value) {
  const salt = 'f1'.repeat(16);
  return `scrypt$16384$8$1$${salt}$${scryptSync(value, Buffer.from(salt, 'hex'), 64).toString('hex')}`;
}
export async function startFixtureDatabase() {
  const tables = {
    app_users: [
      { user_id: 'test-admin', username: 'preview_admin', display_name: '安全员', role: 'safety_admin', fleet_scope: '*', account_status: 'active', password_hash: passwordHash('PreviewAdmin2026'), must_change_password: false, avatar_url: null },
      { user_id: 'test-driver', username: 'preview_driver', display_name: '司机', role: 'driver', driver_id: 'driver-one', fleet_scope: 'fleet-one', binding_verified: true, account_status: 'active', password_hash: passwordHash('PreviewDriver2026'), must_change_password: false, avatar_url: null },
    ],
    app_sessions: [], audit_logs: [],
    drivers: [{ driver_id: 'driver-one', gpsno: 'TEST-VEHICLE-RAW-01', fleet_id: 'fleet-one' }, { driver_id: 'driver-two', gpsno: 'TEST-VEHICLE-RAW-02', fleet_id: 'fleet-two' }],
    vehicle_labels: [{ gpsno: 'TEST-VEHICLE-RAW-01', display_no: 1 }, { gpsno: 'TEST-VEHICLE-RAW-02', display_no: 2 }],
    driver_profiles: [], user_bindings: [], score_snapshots: [], score_history: [],
  };
  const database = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://fixture');
      const table = url.pathname.split('/').at(-1);
      const list = tables[table] ||= [];
      const match = row => [...url.searchParams].every(([key, value]) => {
        if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) return true;
        if (value === 'is.null') return row[key] === null || row[key] === undefined;
        if (value.startsWith('like.')) return new RegExp('^'+value.slice(5).split('%').map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(String(row[key]));
        if (value.startsWith('neq.')) return String(row[key]) !== value.slice(4);
        if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
        if (value.startsWith('in.(')) return value.slice(4,-1).split(',').includes(String(row[key]));
        return true;
      });
      let body = '';
      for await (const part of req) body += part;
      const parsed = body ? JSON.parse(body) : null;
      let rows = list.filter(match), result;
      if (req.method === 'GET') {
        const total = rows.length;
        const sort = url.searchParams.get('order');
        if (sort) { const [field, direction] = sort.split('.'); rows.sort((a,b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (direction === 'desc' ? -1 : 1)); }
        const offset = Number(url.searchParams.get('offset') || 0);
        rows = rows.slice(offset, offset + Number(url.searchParams.get('limit') || 1000));
        const fields = url.searchParams.get('select');
        result = fields && fields !== '*' ? rows.map(row => Object.fromEntries(fields.split(',').map(key => [key, row[key] ?? null]))) : rows;
        res.setHeader('content-range', `0-${Math.max(0, rows.length - 1)}/${total}`);
      } else if (req.method === 'POST') {
        const incoming = Array.isArray(parsed) ? parsed : [parsed];
        if (table === 'app_users' && incoming.some(x => list.some(y => y.username === x.username))) { res.writeHead(409); res.end('{"code":"23505"}'); return; }
        list.push(...incoming); result = incoming;
      } else if (req.method === 'PATCH') {
        if (table === 'app_users' && parsed.username && list.some(x => !rows.includes(x) && x.username === parsed.username)) { res.writeHead(409); res.end('{"code":"23505"}'); return; }
        for (const row of rows) Object.assign(row, parsed);
        result = rows;
      } else if (req.method === 'DELETE') { tables[table] = list.filter(x => !rows.includes(x)); result = []; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result || []));
    } catch { res.writeHead(500); res.end('{"error":"fixture_error"}'); }
  });
  await new Promise(resolve => database.listen(0, '127.0.0.1', resolve));
  return { tables, url: `http://127.0.0.1:${database.address().port}`, close: () => new Promise(resolve => database.close(resolve)) };
}
