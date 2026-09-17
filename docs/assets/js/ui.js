/**
 * ui.js — DOM / 토스트 / 다이얼로그 / 사진 리사이즈 유틸
 */
(function (global) {
  'use strict';

  var CFG = global.APP_CONFIG;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** 문자열을 HTML 에 안전하게 넣기 위한 이스케이프. 사용자 입력은 전부 이걸 통과시킨다. */
  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    }

  /** 줄바꿈을 <br> 로. 반드시 esc() 이후에 쓴다. */
  function nl2br(escaped) {
    return String(escaped).replace(/\n/g, '<br>');
  }

  var toastTimer = null;
  function toast(message, kind) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show' + (kind ? ' toast--' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
  }

  /** window.confirm 대체. Promise<boolean> */
  function confirmDialog(message, confirmLabel) {
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML =
        '<div class="modal__panel" role="dialog" aria-modal="true">' +
        '<p class="modal__msg">' + nl2br(esc(message)) + '</p>' +
        '<div class="modal__actions">' +
        '<button type="button" class="btn btn--ghost" data-act="cancel">취소</button>' +
        '<button type="button" class="btn btn--danger" data-act="ok">' + esc(confirmLabel || '확인') + '</button>' +
        '</div></div>';
      document.body.appendChild(wrap);

      function close(result) {
        wrap.remove();
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }
      function onKey(e) { if (e.key === 'Escape') close(false); }

      wrap.addEventListener('click', function (e) {
        var act = e.target.getAttribute('data-act');
        if (act === 'ok') close(true);
        else if (act === 'cancel' || e.target === wrap) close(false);
      });
      document.addEventListener('keydown', onKey);
      wrap.querySelector('[data-act="ok"]').focus();
    });
  }

  function setBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = busyLabel || '처리 중…';
      button.disabled = true;
    } else {
      if (button.dataset.label) button.textContent = button.dataset.label;
      button.disabled = false;
    }
  }

  /**
   * 사진을 업로드 전에 줄인다.
   * 원본 그대로 보내면 GAS 요청 한도와 Drive 용량을 금방 먹고, 현장 LTE 에서 업로드가 느리다.
   * 긴 변 PHOTO_MAX_EDGE px, JPEG 품질 PHOTO_QUALITY 로 맞춘다.
   */
  function resizePhoto(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject(new Error('사진을 선택해 주세요.'));
        return;
      }
      // 🔴 file.type 으로 미리 거르지 않는다.
      //
      // 예전 코드는 `!/^image\//.test(file.type)` 로 막았다. 그런데 안드로이드
      // 갤러리·클라우드 피커는 타입을 **빈 값이나 application/octet-stream** 으로
      // 넘긴다. 그러면 사진을 골랐는데도 "이미지 파일만 올릴 수 있습니다" 가 떴다.
      // 카메라 촬영은 항상 image/jpeg 라 이 구멍이 드러나지 않았다 (D-027).
      //
      // 브라우저는 blob 을 **바이트로 판별해** 디코드한다(확인함 — 타입이
      // application/octet-stream 인 PNG 도 그대로 열린다). 판단의 주인은 디코더다.
      // 이미지가 아니면 아래 img.onerror 가 받는다.
      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        var maxEdge = CFG.PHOTO_MAX_EDGE;
        var scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);

        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);

        var dataUrl = canvas.toDataURL('image/jpeg', CFG.PHOTO_QUALITY);
        var base64 = dataUrl.split(',')[1];
        resolve({
          name: file.name || 'photo.jpg',
          mimeType: 'image/jpeg',
          dataBase64: base64,
          previewUrl: dataUrl,
          approxBytes: Math.round(base64.length * 0.75)
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('사진을 읽지 못했습니다. 이미지 파일인지 확인하고 다시 시도해 주세요.'));
      };
      img.src = url;
    });
  }

  /** '2026-10-31T14:05:00+09:00' → '14:05' */
  function hhmm(iso) {
    if (!iso) return '';
    var m = String(iso).match(/T(\d{2}):(\d{2})/);
    return m ? m[1] + ':' + m[2] : '';
  }

  /** '2026-10-31T14:05:00+09:00' → '10월 31일 14:05' */
  function prettyDateTime(iso) {
    if (!iso) return '';
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return String(iso);
    return Number(m[2]) + '월 ' + Number(m[3]) + '일 ' + m[4] + ':' + m[5];
  }

  global.UI = {
    $: $, $$: $$, esc: esc, nl2br: nl2br,
    toast: toast, confirmDialog: confirmDialog, setBusy: setBusy,
    resizePhoto: resizePhoto, hhmm: hhmm, prettyDateTime: prettyDateTime
  };
})(window);
