/**
 * 탐험일지 사진 여러 장 (D-064, GAS v22).
 *   칸은 그대로 — `사진ID`·`사진URL` 에 쉼표 목록 · 한도 PHOTO_MAX_COUNT(기본 4) ·
 *   🔴 모두 먼저 검사하고 나서 Drive 에 만든다(거절된 요청이 사진을 남기지 않는다) ·
 *   예전 앱 필드(`photo`·`removePhoto`)도 받는다 · ★ 는 사진마다(`photoId`), 예전 `★` 는 첫 사진.
 */
const { camp } = require('../lib/gas');
const { ok, section, done } = require('../lib/check');

const S1 = '10/31(토)';
const G = camp();
const { post, run } = G;

G.addPeople([
  [S1, '가조장', '1조', '조장', '010-1000-1001', '', ''],
  [S1, '나조원', '1조', '일반', '010-1000-1002', '', ''],
  [S1, '다조장', '2조', '조장', '010-1000-2001', '', '']
]);
const leader = G.token('가조장', '1001');
const member = G.token('나조원', '1002');
const other = G.token('다조장', '2001');
const admin = G.adminToken();

let seq = 0;
const PH = () => ({ name: 'p.jpg', mimeType: 'image/jpeg', dataBase64: Buffer.from('jpeg-bytes-' + (++seq)).toString('base64') });
const BIG = () => ({ name: 'big.jpg', mimeType: 'image/jpeg', dataBase64: Buffer.alloc(400, 7).toString('base64') });
const files = () => G.DRIVE.files.length;
const rowOf = (id) => { const t = G.sheet('Journal'); const h = t[0]; const r = t.find(x => x[0] === id); return h.reduce((o, k, i) => (o[k] = r[i], o), {}); };
const ids = (j) => j.photos.map(p => p.id);
const create = (body) => post(Object.assign({ action: 'journal.create', token: member }, body));
const update = (id, body, tok) => post(Object.assign({ action: 'journal.update', token: tok || member, id }, body));
const award = (id, photoId, on) => post(Object.assign({ action: 'admin.journal.award', token: admin, id, award: on }, photoId ? { photoId } : {}));

// ------------------------------------------------------------------ 올리기
section('여러 장 올리기 — 칸은 그대로, 쉼표 목록');
let r = create({ text: '세 장', photos: [PH(), PH(), PH()] });
ok('세 장 → Drive 파일 셋', r.ok && files() === 3, r.error || G.DRIVE.files);
const j3 = r.data;
ok('응답의 photos 세 장, Drive 순서 그대로', ids(j3).join() === 'FILE1,FILE2,FILE3', j3.photos);
ok('photoUrl 은 첫 장 (예전 앱·"사진 있는 글만")', j3.photoUrl === j3.photos[0].url && /FILE1/.test(j3.photoUrl), j3.photoUrl);
ok('🔴 시트 칸에 쉼표 목록', rowOf(j3.id)['사진ID'] === 'FILE1,FILE2,FILE3' && rowOf(j3.id)['사진URL'].split(',').length === 3, rowOf(j3.id));
ok('파일 이름이 겹치지 않는다 (같은 초에 만들어도)', new Set(G.DRIVE.files.map(f => f.name)).size === 3, G.DRIVE.files.map(f => f.name));
ok('모두 링크 공유', G.DRIVE.files.every(f => f.shared));

r = create({ text: '예전 앱', photo: PH() });
ok('예전 앱의 photo(한 장)도 받는다', r.ok && r.data.photos.length === 1 && files() === 4, r.error || r.data);
r = create({ text: '글만' });
ok('사진 없이 글만 — photos 는 빈 배열', r.ok && r.data.photos.length === 0 && r.data.photoUrl === '', r.data);

section('🔴 한도 · 먼저 검사');
ok('공개 설정에 한도 4', G.get({ action: 'bootstrap' }).data.config.PHOTO_MAX_COUNT === 4);
let before = files();
r = create({ text: '다섯 장', photos: [PH(), PH(), PH(), PH(), PH()] });
ok('다섯 장은 거절 — "4장까지"', !r.ok && r.error.code === 'BAD_REQUEST' && /4장까지/.test(r.error.message), r.error);
ok('🔴 거절되면 Drive 에 아무것도 안 만든다', files() === before, G.DRIVE.files.length);
ok('네 장은 된다', create({ photos: [PH(), PH(), PH(), PH()] }).ok);

run("configSet_({isAdmin:true}, {key:'PHOTO_MAX_BYTES', value:'100'})");
before = files();
r = create({ text: '셋째가 크다', photos: [PH(), PH(), BIG()] });
ok('한 장이라도 크면 TOO_LARGE', !r.ok && r.error.code === 'TOO_LARGE', r.error);
ok('🔴 앞의 두 장도 Drive 에 남지 않는다 (먼저 검사)', files() === before, G.DRIVE.files.slice(before));
run("configSet_({isAdmin:true}, {key:'PHOTO_MAX_BYTES', value:'4000000'})");
r = create({ photos: [PH(), { mimeType: 'application/pdf', dataBase64: PH().dataBase64 }] });
ok('이미지가 아닌 것이 섞여도 전부 거절', !r.ok && r.error.code === 'BAD_REQUEST' && files() === before, r.error);

// Drive 가 둘째 장에서 실패하면 첫째 장을 치운다
run(`var __realCreate = createPhotoFile_; var __made = 0;
     createPhotoFile_ = function (c, h) { if (++__made === 2) throw new Error('Drive 일시 오류'); return __realCreate(c, h); };`);
const trashedBefore = G.DRIVE.trashed.length;
before = files();
r = create({ text: 'Drive 실패', photos: [PH(), PH(), PH()] });
run('createPhotoFile_ = __realCreate;');
ok('Drive 가 중간에 실패하면 요청은 실패', !r.ok, r);
ok('🔴 이미 만든 첫째 장은 휴지통으로 (고아 파일 없음)', files() === before + 1 &&
  G.DRIVE.trashed.slice(trashedBefore).join() === G.DRIVE.files[before].id, { made: G.DRIVE.files.slice(before), trashed: G.DRIVE.trashed.slice(trashedBefore) });
ok('글도 남지 않는다', !post({ action: 'admin.journal.list', token: admin }).data.items.some(j => j.text === 'Drive 실패'));

run("configSet_({isAdmin:true}, {key:'PHOTO_MAX_COUNT', value:'2'})");
ok('한도는 Config 를 따른다 (2)', /2장까지/.test((create({ photos: [PH(), PH(), PH()] }).error || {}).message || '') &&
  G.get({ action: 'bootstrap' }).data.config.PHOTO_MAX_COUNT === 2);
run("configSet_({isAdmin:true}, {key:'PHOTO_MAX_COUNT', value:'4'})");

// ------------------------------------------------------------------ 고치기
section('고치기 — 추가 · 빼기');
let j = create({ text: '고칠 글', photos: [PH(), PH()] }).data;
const [a, b] = ids(j);
r = update(j.id, { removePhotoIds: [a], addPhotos: [PH()] });
ok('하나 빼고 하나 더하면 [남은 것, 새 것] 순서', r.ok && r.data.photos.length === 2 && r.data.photos[0].id === b && r.data.photos[1].id !== a, r.error || r.data.photos);
ok('뺀 사진은 휴지통', G.DRIVE.trashed.includes(a) && !G.DRIVE.trashed.includes(b));
j = r.data;
before = files();
r = update(j.id, { addPhotos: [PH(), PH(), PH()] });
ok('🔴 고친 뒤 5장이면 거절 · Drive 에 안 만든다', !r.ok && /4장까지/.test(r.error.message) && files() === before, r.error);
r = update(j.id, { addPhotos: [PH(), PH()] });
ok('고친 뒤 4장이면 된다', r.ok && r.data.photos.length === 4);
j = r.data;
r = update(j.id, { removePhotoIds: ['FILE_남의것'] });
ok('이 글의 사진이 아닌 ID 는 무시', r.ok && r.data.photos.length === 4);

const t0 = create({ photos: [PH(), PH()] }).data;
before = files();
const trashed0 = G.DRIVE.trashed.length;
r = update(t0.id, { removePhotoIds: ids(t0), text: '' });
ok('🔴 글도 사진도 안 남으면 거절 — 아무것도 안 지운다', !r.ok && r.error.code === 'BAD_REQUEST' && G.DRIVE.trashed.length === trashed0, r.error);
r = update(t0.id, { removePhotoIds: ids(t0), addPhotos: [PH()] });
ok('다 빼고 새로 하나 — 된다', r.ok && r.data.photos.length === 1 && G.DRIVE.trashed.length === trashed0 + 2);

const old = create({ text: '예전 앱 고치기', photos: [PH(), PH()] }).data;
r = update(old.id, { photo: PH() });
ok('예전 앱의 photo = 전부 교체', r.ok && r.data.photos.length === 1 && ids(old).every(id => G.DRIVE.trashed.includes(id)), r.data && r.data.photos);
r = update(old.id, { removePhoto: true });
ok('예전 앱의 removePhoto = 전부 삭제', r.ok && r.data.photos.length === 0 && rowOf(old.id)['사진ID'] === '');
r = update(old.id, { text: '글만 고침' });
ok('글만 고치면 사진 칸은 그대로', r.ok && rowOf(old.id)['사진ID'] === '');

section('지우기 — 사진 전부 휴지통');
const d = create({ photos: [PH(), PH(), PH()] }).data;
r = post({ action: 'journal.delete', token: member, id: d.id });
ok('세 장 모두 휴지통', r.ok && ids(d).every(id => G.DRIVE.trashed.includes(id)), G.DRIVE.trashed);

section('갤러리 — 승인되면 남에게도 여러 장');
const g = create({ text: '보여 줄 글', photos: [PH(), PH(), PH()] }).data;
post({ action: 'admin.journal.review', token: admin, id: g.id, decision: '승인' });
const seen = post({ action: 'journal.list', token: other }).data.items.find(x => x.id === g.id);
ok('다른 조도 세 장을 받는다', seen && seen.photos.length === 3 && seen.photos.every(p => p.url && p.award === false), seen);
ok('수정 권한은 그대로 (다른 조장은 못 고침)', seen.canEdit === false);

// ------------------------------------------------------------------ ★
section('★ 는 사진마다 (D-064)');
const [p1, p2, p3] = ids(g);
r = award(g.id, p2, true);
ok('둘째 사진에만 ★', r.ok && r.data.photos.map(p => p.award).join() === 'false,true,false' && r.data.award === true, r.error || r.data.photos);
ok('시트 수상 칸 = 그 사진ID', rowOf(g.id)['수상'] === p2, rowOf(g.id)['수상']);
r = award(g.id, p3, true);
ok('여러 장 ★ — 사진 순서대로 적는다', r.ok && rowOf(g.id)['수상'] === p2 + ',' + p3);
r = award(g.id, p2, false);
ok('하나만 해제', r.ok && r.data.photos.map(p => p.award).join() === 'false,false,true' && r.data.award === true);
r = award(g.id, 'FILE_남의것', true);
ok('🔴 이 글의 사진이 아니면 거절', !r.ok && r.error.code === 'BAD_REQUEST' && /이 글의 사진/.test(r.error.message), r.error);
r = award(g.id, null, false);
ok('예전 콘솔의 해제(photoId 없음) = 전부 해제', r.ok && r.data.award === false && rowOf(g.id)['수상'] === '');
r = award(g.id, null, true);
ok('예전 콘솔의 지정(photoId 없음) = 첫 사진', r.ok && r.data.photos[0].award && rowOf(g.id)['수상'] === p1);

G.fresh();
run(`readTable_(SHEETS.JOURNAL).forEach(function (r) { if (r['일지ID'] === ${JSON.stringify(g.id)}) updateRow_(SHEETS.JOURNAL, r.__row, { '수상': '★' }); });`);
const legacy = post({ action: 'admin.journal.list', token: admin }).data.items.find(x => x.id === g.id);
ok('🔴 예전 값 ★ (글 단위, D-052) 는 첫 사진 ★ 로 읽는다', legacy.award === true && legacy.photos.map(p => p.award).join() === 'true,false,false', legacy.photos);
r = award(g.id, p3, true);
ok('예전 값에 더하면 첫 사진 ★ 는 남는다', r.ok && rowOf(g.id)['수상'] === p1 + ',' + p3, rowOf(g.id)['수상']);

r = update(g.id, { removePhotoIds: [p3] }, leader);
ok('★ 사진을 빼면 ★ 도 빠진다', r.ok && rowOf(g.id)['수상'] === p1, rowOf(g.id)['수상']);
const pending = create({ photos: [PH()] }).data;
r = award(pending.id, pending.photos[0].id, true);
ok('🔴 승인 전 사진은 여전히 ★ 불가', !r.ok && /승인된 사진 글만/.test(r.error.message));

done();
