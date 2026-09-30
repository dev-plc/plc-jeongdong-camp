/**
 * 로컬 Postgres 로 Supabase SQL 을 돌려 본다 — 버리는 클러스터를 임시 폴더에 띄운다.
 *
 * Supabase 의 역할을 흉내 낸다: anon(브라우저 publishable 키) · authenticated · service_role(GAS).
 * 'Automatically expose new tables' 를 끈 프로젝트처럼 **새 표에 아무 권한도 없는** 상태에서 시작한다.
 *
 * Postgres 가 없거나 root/postgres 로 돌 수 없으면 find() 가 null — 스위트는 "건너뜀" 을 찍는다.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function find() {
  const base = '/usr/lib/postgresql';
  let bin = null;
  try {
    const vers = fs.readdirSync(base).filter(v => /^\d+$/.test(v)).sort((a, b) => b - a);
    for (const v of vers) { const b = path.join(base, v, 'bin'); if (fs.existsSync(path.join(b, 'initdb'))) { bin = b; break; } }
  } catch (e) { return null; }
  if (!bin) return null;
  const psql = spawnSync('which', ['psql'], { encoding: 'utf8' }).stdout.trim();
  if (!psql) return null;
  // initdb 는 root 로 못 돈다 → root 면 postgres 사용자로
  const asPg = process.getuid && process.getuid() === 0;
  if (asPg && spawnSync('id', ['postgres']).status !== 0) return null;
  return { bin, psql, asPg };
}

function start(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camp-pg-'));
  const port = 55000 + Math.floor(Math.random() * 4000);
  const run = (cmd, args) => {
    const full = env.asPg ? ['-u', 'postgres', '--', cmd].concat(args) : args;
    const r = spawnSync(env.asPg ? 'runuser' : cmd, full, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(cmd + ' 실패: ' + r.stderr + r.stdout);
    return r;
  };
  if (env.asPg) spawnSync('chown', ['postgres', dir]);
  run(path.join(env.bin, 'initdb'), ['-D', path.join(dir, 'data'), '-A', 'trust', '-U', 'postgres', '--no-sync']);
  run(path.join(env.bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-o', `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off`,
    '-l', path.join(dir, 'log'), '-w', 'start']);

  /**
   * SQL 을 돌린다. vars 는 psql 변수(:'이름' 으로 안전하게 인용). role 을 주면 그 역할로.
   * @return {{ok:boolean, out:string, err:string}}
   */
  function sql(query, opt) {
    opt = opt || {};
    const args = ['-h', dir, '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'];
    Object.entries(opt.vars || {}).forEach(([k, v]) => args.push('-v', `${k}=${v}`));
    const input = (opt.role ? `set role ${opt.role};\n` : '') + query + '\n';
    const r = spawnSync(env.psql, args, { input, encoding: 'utf8' });
    return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  }

  // Supabase 역할
  const roles = sql(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant anon, authenticated, service_role to postgres;`);
  if (!roles.ok) throw new Error('역할 만들기 실패: ' + roles.err);

  function stop() {
    try { run(path.join(env.bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', 'stop']); } catch (e) { /* 이미 멈춤 */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { sql, stop };
}

module.exports = { find, start };
