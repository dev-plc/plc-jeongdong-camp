/**
 * ────────────────────────────────────────────────────────────────
 * Journal.gs · v15 · 2026-09-26
 * ────────────────────────────────────────────────────────────────
 * 변경 이력 (최근 5건 — 전체는 docs-dev/spec/DECISIONS.md · git log)
 *  v15   2026-09-26  파일 버전 표시 시작
 *  v12   2026-09-22  반려된 일지를 다시 낼 수 있게 + 운영콘솔 편의 네 가지
 *  —     2026-09-19  시트에는 진짜 Date, 통신에는 ISO
 *  —     2026-09-11  일정 변경·부서 분리·응답 속도 개선, Firebase 설계 문서화
 *  —     2026-08-28  정동 신앙탐험대 앱 - 시트 스키마·GAS 백엔드·참가자/운영 화면
 *
 * 버전: vN = GAS 배포 번호. vN.k = 서버는 vN 그대로 두고 앱·도구만 고친 k번째.
 *       — 는 버전 기록을 시작하기 전(v12 이전)의 변경.
 * 🔴 이 파일을 고치면 맨 위 줄(이름·버전·날짜)과 이력을 함께 고친다 (CLAUDE.md).
 * ────────────────────────────────────────────────────────────────
 */
var VERSION_JOURNAL = 'v15';   // 헤더의 버전과 같아야 한다. health 가 이 값을 알려 준다.

/**
 * Journal.gs — 탐험일지 (글 + 사진)
 *
 * 공개 범위: Config.GALLERY_SCOPE = ALL | TEAM | SELF   (D-004)
 * 수정/삭제: 작성자 본인 / 소속 조장 / 전체 관리자        (D-009)
 * 삭제는 소프트 삭제(상태=삭제) + Drive 사진 휴지통 이동.
 */

var JOURNAL_TEXT_MAX = 1000;

// ---------------------------------------------------------------- 권한

/** D-009 의 세 부류만 true. 조장은 "자기 조" 일지에 한한다. */
function canEditJournal_(ctx, row) {
  if (ctx.isAdmin) return true;
  if (str_(row['참가자ID']) === ctx.pid) return true;
  // 조장은 "자기 조"(같은 참여 일자 + 같은 조 배정)의 일지에 한한다.
  if (ctx.isLeader && ctx.group && rowTeamKey_(row) === ctx.teamKey) return true;
  return false;
}

function findJournalById_(id) {
  var target = str_(id);
  var rows = readTable_(SHEETS.JOURNAL);
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i]['일지ID']) === target) return rows[i];
  }
  return null;
}

// ---------------------------------------------------------------- 사진

function getDriveFolder_() {
  var id = confStr_('DRIVE_FOLDER_ID', '');
  if (!id) throw new AppError('SERVER_ERROR', 'Config 시트의 DRIVE_FOLDER_ID 가 비어 있습니다.');
  try {
    return DriveApp.getFolderById(id);
  } catch (e) {
    throw new AppError('SERVER_ERROR', 'DRIVE_FOLDER_ID 폴더에 접근할 수 없습니다.');
  }
}

/**
 * base64 사진을 Drive 에 저장하고 { id, url } 을 돌려준다.
 * 갤러리가 <img> 로 바로 읽어야 하므로 링크 공개로 전환한다.
 * (승인 전 일지는 목록 API 가 걸러내므로 URL 이 유출되지 않는 한 노출되지 않는다.)
 */
function savePhoto_(photo, filenameHint) {
  if (!photo || !photo.dataBase64) return null;

  var maxBytes = confInt_('PHOTO_MAX_BYTES', 4000000);
  var bytes;
  try {
    bytes = Utilities.base64Decode(photo.dataBase64);
  } catch (e) {
    throw new AppError('BAD_REQUEST', '사진 데이터를 읽을 수 없습니다.');
  }
  if (bytes.length > maxBytes) {
    throw new AppError('TOO_LARGE', '사진 용량이 너무 큽니다. 다시 촬영하거나 크기를 줄여 주세요.');
  }

  var mime = str_(photo.mimeType) || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(mime)) {
    throw new AppError('BAD_REQUEST', '이미지 파일만 올릴 수 있습니다.');
  }

  var ext = mime.split('/')[1].replace('jpeg', 'jpg');
  var name = filenameHint + '_' + Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss') + '.' + ext;
  var file = getDriveFolder_().createFile(Utilities.newBlob(bytes, mime, name));

  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    // 조직 정책으로 링크 공개가 막힌 경우: 파일은 남기고 URL 만 비운다.
    console.warn('setSharing failed: ' + e);
  }

  return { id: file.getId(), url: photoUrl_(file.getId()) };
}

function photoUrl_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w1200';
}

function trashPhoto_(fileId) {
  var id = str_(fileId);
  if (!id) return;
  try {
    DriveApp.getFileById(id).setTrashed(true);
  } catch (e) {
    console.warn('trashPhoto_ failed for ' + id + ': ' + e);
  }
}

// ---------------------------------------------------------------- 목록

function journalList_(ctx, body) {
  var scope = str_(body.scope) || 'gallery';
  var limit = Math.min(Math.max(parseInt(body.limit, 10) || 30, 1), 100);
  var cursor = Math.max(parseInt(body.cursor, 10) || 0, 0);

  var rows = readTable_(SHEETS.JOURNAL).filter(function (r) {
    return str_(r['상태']) !== '삭제';
  });

  if (scope === 'mine') {
    rows = rows.filter(function (r) { return str_(r['참가자ID']) === ctx.pid; });
  } else if (scope === 'team') {
    if (!ctx.isLeader && !ctx.isAdmin) throw new AppError('FORBIDDEN', '조장만 볼 수 있습니다.');
    rows = rows.filter(function (r) { return rowTeamKey_(r) === ctx.teamKey; });
  } else {
    // gallery
    if (confBool_('JOURNAL_REQUIRE_APPROVAL', true) && !ctx.isAdmin) {
      rows = rows.filter(function (r) {
        // 승인 전이라도 본인 글은 본인에게 보인다.
        return str_(r['상태']) === '승인' || str_(r['참가자ID']) === ctx.pid;
      });
    }
    var galleryScope = confStr_('GALLERY_SCOPE', 'ALL').toUpperCase();
    if (!ctx.isAdmin) {
      if (galleryScope === 'SELF') {
        rows = rows.filter(function (r) { return str_(r['참가자ID']) === ctx.pid; });
      } else if (galleryScope === 'TEAM') {
        rows = rows.filter(function (r) { return rowTeamKey_(r) === ctx.teamKey; });
      } else {
        // ALL — 같은 참여 일자 안에서만 공개한다(10/31 과 11/07 은 서로 섞지 않는다).
        rows = rows.filter(function (r) { return str_(r[COL.SESSION]) === ctx.session; });
      }
    }
  }

  rows.sort(function (a, b) {
    return toIso_(b['작성일시']).localeCompare(toIso_(a['작성일시']));
  });

  var total = rows.length;
  var page = rows.slice(cursor, cursor + limit).map(function (r) {
    return serializeJournal_(r, ctx);
  });

  return {
    items: page,
    total: total,
    nextCursor: cursor + page.length < total ? cursor + page.length : null,
    galleryScope: confStr_('GALLERY_SCOPE', 'ALL').toUpperCase(),
    requiresApproval: confBool_('JOURNAL_REQUIRE_APPROVAL', true)
  };
}

function serializeJournal_(r, ctx) {
  return {
    id: str_(r['일지ID']),
    session: str_(r[COL.SESSION]),
    group: str_(r[COL.GROUP]),
    authorId: str_(r['참가자ID']),
    authorName: str_(r['작성자명']),
    checkpoint: str_(r['지점코드']),
    text: str_(r['내용']),
    photoUrl: str_(r['사진URL']),
    status: str_(r['상태']),
    rejectReason: str_(r['반려사유']),
    createdAt: toIso_(r['작성일시']),
    updatedAt: toIso_(r['수정일시']),
    isMine: str_(r['참가자ID']) === ctx.pid,
    canEdit: canEditJournal_(ctx, r)
  };
}

// ---------------------------------------------------------------- 생성

function journalCreate_(ctx, body) {
  if (!confBool_('JOURNAL_OPEN', true)) {
    throw new AppError('CLOSED', '탐험일지 작성이 마감되었습니다.');
  }
  if (ctx.isAdmin) throw new AppError('BAD_REQUEST', '관리자 계정으로는 일지를 작성할 수 없습니다.');

  var text = str_(body.text);
  if (text.length > JOURNAL_TEXT_MAX) {
    throw new AppError('BAD_REQUEST', '소감은 ' + JOURNAL_TEXT_MAX + '자까지 쓸 수 있습니다.');
  }
  var hasPhoto = !!(body.photo && body.photo.dataBase64);
  if (!text && !hasPhoto) throw new AppError('BAD_REQUEST', '소감이나 사진 중 하나는 있어야 합니다.');

  var checkpoint = normalizeCheckpoint_(body.checkpoint);
  var saved = hasPhoto ? savePhoto_(body.photo, ctx.pid) : null;

  return withLock_(function () {
    var id = nextId_(SHEETS.JOURNAL, '일지ID', 'J', 4);
    var now = nowStamp_();
    appendRow_(SHEETS.JOURNAL, {
      '일지ID': id,
      [COL.SESSION]: ctx.session,
      [COL.GROUP]: ctx.group,
      '참가자ID': ctx.pid,
      '작성자명': ctx.name,
      '지점코드': checkpoint,
      '내용': text,
      '사진ID': saved ? saved.id : '',
      '사진URL': saved ? saved.url : '',
      '상태': confBool_('JOURNAL_REQUIRE_APPROVAL', true) ? '대기' : '승인',
      '반려사유': '',
      '작성일시': now,
      '수정일시': now,
      '수정자ID': ctx.pid,
      '검토자': '',
      '검토일시': ''
    });
    logEvent_('journal.create', ctx.pid, id, 'OK', checkpoint);
    var row = findJournalById_(id);
    return serializeJournal_(row, ctx);
  });
}

// ---------------------------------------------------------------- 수정

/**
 * 작성자 본인 / 소속 조장 / 관리자만 (D-009).
 * 승인된 글을 본인·조장이 고치면 다시 '대기' 로 내려간다. 관리자 수정은 상태를 유지한다.
 */
function journalUpdate_(ctx, body) {
  var row = findJournalById_(body.id);
  if (!row || str_(row['상태']) === '삭제') throw new AppError('NOT_FOUND', '해당 일지를 찾을 수 없습니다.');
  if (!canEditJournal_(ctx, row)) {
    throw new AppError('FORBIDDEN', '본인 또는 조장, 관리자만 수정할 수 있습니다.');
  }
  if (!confBool_('JOURNAL_OPEN', true) && !ctx.isAdmin) {
    throw new AppError('CLOSED', '탐험일지 수정이 마감되었습니다.');
  }

  var patch = { '수정일시': nowStamp_(), '수정자ID': ctx.pid };

  if (body.text !== undefined) {
    var text = str_(body.text);
    if (text.length > JOURNAL_TEXT_MAX) {
      throw new AppError('BAD_REQUEST', '소감은 ' + JOURNAL_TEXT_MAX + '자까지 쓸 수 있습니다.');
    }
    patch['내용'] = text;
  }
  if (body.checkpoint !== undefined) {
    patch['지점코드'] = normalizeCheckpoint_(body.checkpoint);
  }

  var oldPhotoId = str_(row['사진ID']);
  if (body.photo && body.photo.dataBase64) {
    var saved = savePhoto_(body.photo, ctx.pid);
    patch['사진ID'] = saved.id;
    patch['사진URL'] = saved.url;
  } else if (body.removePhoto) {
    patch['사진ID'] = '';
    patch['사진URL'] = '';
  }

  var finalText = patch['내용'] !== undefined ? patch['내용'] : str_(row['내용']);
  var finalPhoto = patch['사진ID'] !== undefined ? patch['사진ID'] : oldPhotoId;
  if (!finalText && !finalPhoto) {
    throw new AppError('BAD_REQUEST', '소감이나 사진 중 하나는 남겨야 합니다. 지우려면 삭제를 눌러 주세요.');
  }

  // 🔴 **이미 검수를 거친 글**은 고치면 다시 검수를 받는다 (D-046).
  //
  // 두 가지를 동시에 한다.
  //  · 승인 후 내용을 갈아 검수를 우회하는 길을 막는다
  //  · **반려된 글을 고치면 다시 올라간다** — 예전에는 `승인` 일 때만 되돌려서,
  //    반려된 글은 고쳐도 계속 `반려` 였다. 검수대기 목록에 다시 뜨지 않으니
  //    운영진은 고친 줄도 몰랐고, 참가자는 다시 낼 방법이 없었다.
  var reviewed = str_(row['상태']);
  if (!ctx.isAdmin && confBool_('JOURNAL_REQUIRE_APPROVAL', true) &&
      (reviewed === '승인' || reviewed === '반려')) {
    patch['상태'] = '대기';
    patch['검토자'] = '';
    patch['검토일시'] = '';
    // 옛 반려 사유를 지운다. 안 그러면 새로 낸 글에 지난 사유가 붙어 있다.
    patch['반려사유'] = '';
  }

  return withLock_(function () {
    updateRow_(SHEETS.JOURNAL, row.__row, patch);
    if ((body.photo && body.photo.dataBase64) || body.removePhoto) trashPhoto_(oldPhotoId);
    logEvent_('journal.update', ctx.pid, str_(row['일지ID']), 'OK',
      { before: str_(row['상태']), after: patch['상태'] || str_(row['상태']) });
    return serializeJournal_(findJournalById_(row['일지ID']), ctx);
  });
}

// ---------------------------------------------------------------- 삭제 (소프트)

function journalDelete_(ctx, body) {
  var row = findJournalById_(body.id);
  if (!row) throw new AppError('NOT_FOUND', '해당 일지를 찾을 수 없습니다.');
  if (str_(row['상태']) === '삭제') return { id: str_(row['일지ID']), status: '삭제' };
  if (!canEditJournal_(ctx, row)) {
    throw new AppError('FORBIDDEN', '본인 또는 조장, 관리자만 삭제할 수 있습니다.');
  }

  return withLock_(function () {
    updateRow_(SHEETS.JOURNAL, row.__row, {
      '상태': '삭제',
      '수정일시': nowStamp_(),
      '수정자ID': ctx.pid
    });
    trashPhoto_(row['사진ID']);
    logEvent_('journal.delete', ctx.pid, str_(row['일지ID']), 'OK', { before: str_(row['상태']) });
    return { id: str_(row['일지ID']), status: '삭제' };
  });
}

// ---------------------------------------------------------------- 관리자 검수

/**
 * 운영콘솔용 **전체 목록** (D-046). 삭제만 뺀다.
 *
 * `journalPending_` 는 `대기` 만 돌려줘서, 승인·반려된 글은 운영콘솔에서 **아예 볼 수
 * 없었다.** 잘못 올라간 사진을 뒤늦게 지우려 해도 방법이 없었다.
 * 상태 거르기는 앱이 한다 — 한 번 받아 두고 필터는 그 데이터로 돈다.
 */
function journalAll_(ctx) {
  var rows = readTable_(SHEETS.JOURNAL)
    .filter(function (r) { return str_(r['상태']) !== '삭제'; })
    .sort(function (a, b) { return toIso_(b['작성일시']).localeCompare(toIso_(a['작성일시'])); });
  return { items: rows.map(function (r) { return serializeJournal_(r, ctx); }), total: rows.length };
}

function journalPending_(ctx) {
  var rows = readTable_(SHEETS.JOURNAL)
    .filter(function (r) { return str_(r['상태']) === '대기'; })
    .sort(function (a, b) { return toIso_(a['작성일시']).localeCompare(toIso_(b['작성일시'])); });
  return { items: rows.map(function (r) { return serializeJournal_(r, ctx); }), total: rows.length };
}

function journalReview_(ctx, body) {
  var decision = str_(body.decision);
  if (['승인', '반려'].indexOf(decision) < 0) {
    throw new AppError('BAD_REQUEST', '승인 또는 반려만 가능합니다.');
  }
  var row = findJournalById_(body.id);
  if (!row || str_(row['상태']) === '삭제') throw new AppError('NOT_FOUND', '해당 일지를 찾을 수 없습니다.');

  return withLock_(function () {
    updateRow_(SHEETS.JOURNAL, row.__row, {
      '상태': decision,
      '반려사유': decision === '반려' ? str_(body.reason) : '',
      '검토자': str_(body.reviewer) || 'ADMIN',
      '검토일시': nowStamp_()
    });
    logEvent_('journal.review', 'ADMIN', str_(row['일지ID']), decision, str_(body.reason));
    return serializeJournal_(findJournalById_(row['일지ID']), ctx);
  });
}

// ---------------------------------------------------------------- 공용

function normalizeCheckpoint_(code) {
  var c = str_(code);
  if (!c) return '';
  var exists = readTable_(SHEETS.CHECKPOINTS).some(function (r) { return str_(r['지점코드']) === c; });
  if (!exists) throw new AppError('BAD_REQUEST', '알 수 없는 답사 지점입니다.');
  return c;
}
