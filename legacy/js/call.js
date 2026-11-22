// Video calls between two friends: WebRTC for audio/video, Firestore for the ring and the
// connection handshake (calls/<id>), and live captions. Each person's browser turns their own
// speech into text and sends it straight to the other person over the call, so the captions
// still work with the sound off and are never saved anywhere.
import * as F from './firebase.js';
import * as N from './notify.js';
import { $, esc, avatar, I } from './util.js';

const { db } = F;
const RING_FOR = 45e3;           // give up and mark the call missed after this
const RECONNECT_FOR = 15e3;      // how long a dropped connection may try to come back
const CAPTION_HOLD = 6e3;        // a finished caption stays this long after the last word
const CONNECT_FOR = 25e3;        // after answering, give up if the two devices can't reach each other
const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const BLOCKED = "Couldn't connect. This Wi-Fi blocks direct calls between devices, so calls need a relay server.";
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const SR = self.SpeechRecognition || self.webkitSpeechRecognition;

const callRef = (id) => F.doc(db, 'calls', id);
const candRef = (id) => F.collection(db, 'calls', id, 'candidates');
const ts = (t) => t?.toMillis?.() ?? Date.now();

let ctx = null;        // { uid, user(uid), toast(msg, kind), onLog(chatId, text) } from app.js
let call = null;       // the call on screen
let ringing = null;    // an incoming call waiting for an answer
let incomingUnsub = null;

export function initCalls(context) {
  ctx = context;
  incomingUnsub = F.onSnapshot(
    F.query(F.collection(db, 'calls'), F.where('to', '==', ctx.uid), F.where('status', '==', 'ringing')),
    onIncoming,
    (e) => console.warn('call listener', e),
  );
  window.addEventListener('pagehide', onPageHide);
  iceServers(); // fetch relay details ahead of time so calls start faster
}

export function stopCalls() {
  incomingUnsub?.();
  incomingUnsub = null;
  window.removeEventListener('pagehide', onPageHide);
  if (call) hangUp('ended');
  dismissRing();
  ctx = null;
}

export const inCall = () => !!(call || ringing);

function onPageHide() {
  if (call?.created) F.updateDoc(callRef(call.id), { status: 'ended', endedAt: F.serverTimestamp() }).catch(() => {});
}

// ============================================================================
// Placing and answering
// ============================================================================
export async function startCall(chatId, peer) {
  if (call) return ctx.toast("You're already on a call");
  if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) return ctx.toast("This browser can't make video calls", 'error');
  const ref = F.doc(F.collection(db, 'calls'));
  call = newCall({ id: ref.id, chatId, peer, role: 'caller' });
  renderCall();
  try {
    await getMedia();
    if (call?.id !== ref.id) return;
    await setupPeer();
    if (call?.id !== ref.id) return;
    call.dc = call.pc.createDataChannel('captions');
    wireChannel(call.dc);
    const offer = await call.pc.createOffer();
    await call.pc.setLocalDescription(offer);
    await F.setDoc(ref, {
      chatId, from: ctx.uid, to: peer, members: [ctx.uid, peer], status: 'ringing',
      offer: { type: offer.type, sdp: offer.sdp }, createdAt: F.serverTimestamp(),
    });
    if (call?.id !== ref.id) return;
    call.created = true;
    flushCandidates();
    call.unsubs.push(F.onSnapshot(ref, onCallDoc, () => {}));
    listenCandidates();
    call.timers.push(setTimeout(() => { if (call?.id === ref.id && !call.answered) hangUp('missed'); }, RING_FOR));
  } catch (e) {
    failed(e);
  }
}

function onIncoming(snap) {
  const waiting = snap.docs
    .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
    // A caller whose app crashed never marks the call missed; ignore anything that old.
    .filter((c) => Date.now() - ts(c.createdAt) < RING_FOR + 2 * 60e3);
  if (ringing && !waiting.some((c) => c.id === ringing.id)) dismissRing(); // cancelled or answered elsewhere
  const next = waiting.find((c) => c.id !== call?.id);
  if (!next || ringing?.id === next.id) return;
  if (call || ringing) {
    // Busy: let the caller know right away instead of ringing out.
    F.updateDoc(callRef(next.id), { status: 'declined', endedAt: F.serverTimestamp() }).catch(() => {});
    return;
  }
  ringing = next;
  showRing();
}

async function accept() {
  const inc = ringing;
  const preview = inc?.preview;
  if (inc) inc.preview = null; // the call takes over the camera that was already showing
  dismissRing();
  if (!inc || call) return preview?.getTracks().forEach((t) => t.stop());
  call = newCall({ id: inc.id, chatId: inc.chatId, peer: inc.from, role: 'callee' });
  call.created = true;
  call.status = 'connecting';
  renderCall();
  try {
    await getMedia(preview);
    if (call?.id !== inc.id) return;
    await setupPeer();
    if (call?.id !== inc.id) return;
    listenCandidates();
    await call.pc.setRemoteDescription(inc.offer);
    flushRemoteCandidates();
    const answer = await call.pc.createAnswer();
    await call.pc.setLocalDescription(answer);
    await F.updateDoc(callRef(inc.id), { answer: { type: answer.type, sdp: answer.sdp }, status: 'active' });
    call.answered = true;
    watchConnect();
    call.unsubs.push(F.onSnapshot(callRef(inc.id), onCallDoc, () => {}));
  } catch (e) {
    failed(e);
  }
}

function decline() {
  const inc = ringing;
  dismissRing();
  if (inc) F.updateDoc(callRef(inc.id), { status: 'declined', endedAt: F.serverTimestamp() }).catch(() => {});
}

function onCallDoc(snap) {
  const d = snap.data();
  if (!d || !call || snap.id !== call.id) return;
  if (call.role === 'caller' && d.answer && !call.answered) {
    call.answered = true;
    call.status = 'connecting';
    renderStatus();
    watchConnect();
    call.pc.setRemoteDescription(d.answer).then(flushRemoteCandidates).catch(failed);
  }
  if (['ended', 'declined', 'missed'].includes(d.status)) {
    const name = ctx.user(call.peer).displayName || 'They';
    if (d.status === 'declined' && !call.answered) ctx.toast(`${name} can't talk right now`);
    else if (call.answered) ctx.toast('Call ended');
    hangUp(d.status, true);
  }
}

// ============================================================================
// Media and connection
// ============================================================================
function newCall(c) {
  return {
    ...c, status: 'calling', pc: null, dc: null, local: null, remote: new MediaStream(),
    unsubs: [], timers: [], created: false, answered: false, startedAt: 0,
    localCands: [], remoteCands: [], micOn: true, camOn: true, ccOn: pref('cc') !== 'off',
    peerMic: true, peerCam: true, peerCC: true, captions: new Map(), rec: null,
    corner: ['tl', 'tr', 'bl', 'br'].includes(pref('pip')) ? pref('pip') : 'br',
  };
}

const openCamera = () => navigator.mediaDevices.getUserMedia({
  audio: AUDIO, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
});

async function getMedia(preview = null) {
  try {
    call.local = preview || await openCamera();
  } catch (e) {
    if (e.name === 'NotAllowedError' && !/camera|video/i.test(e.message)) throw e;
    // No camera (or it's busy): carry on with sound and captions only.
    call.local = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
    call.camOn = false;
    ctx.toast('No camera found, so this is a voice call');
  }
  const v = $('#callLocal');
  if (v) v.srcObject = call.local;
  renderControls();
}

// School and shared Wi-Fi often stop devices from reaching each other directly; a relay (TURN)
// server in the middle gets those calls through. Set it up in firebase-config.js.
let iceCache = null;
async function iceServers() {
  if (self.ICE_SERVERS?.length) return [...STUN, ...self.ICE_SERVERS];
  if (!self.TURN_CREDENTIALS_URL) return STUN;
  if (iceCache && Date.now() - iceCache.at < 30 * 60e3) return iceCache.list;
  try {
    const list = await (await fetch(self.TURN_CREDENTIALS_URL)).json();
    if (Array.isArray(list) && list.length) {
      iceCache = { at: Date.now(), list: [...STUN, ...list] };
      return iceCache.list;
    }
  } catch { /* relay unreachable: try a direct connection anyway */ }
  return STUN;
}

// The ring and handshake can succeed while the devices still can't reach each other; say so
// instead of sitting on "Connecting…".
function watchConnect() {
  const id = call.id;
  call.timers.push(setTimeout(() => {
    if (call?.id !== id || call.startedAt) return;
    ctx.toast(BLOCKED, 'error', 8000);
    hangUp('ended');
  }, CONNECT_FOR));
}

async function setupPeer() {
  const pc = new RTCPeerConnection({ iceServers: await iceServers() });
  call.pc = pc;
  call.local.getTracks().forEach((t) => pc.addTrack(t, call.local));
  pc.ontrack = (e) => {
    if (call?.pc !== pc) return;
    call.remote.addTrack(e.track);
    const v = $('#callRemote');
    if (v && v.srcObject !== call.remote) v.srcObject = call.remote;
    v?.play().catch(() => {});
  };
  pc.ondatachannel = (e) => { call.dc = e.channel; wireChannel(e.channel); };
  pc.onicecandidate = (e) => {
    if (!e.candidate || call?.pc !== pc) return;
    call.localCands.push(JSON.stringify(e.candidate.toJSON()));
    if (call.created) flushCandidates();
  };
  pc.onconnectionstatechange = () => {
    if (!call || call.pc !== pc) return;
    const s = pc.connectionState;
    if (s === 'connected') {
      clearTimeout(call.dropTimer);
      if (!call.startedAt) {
        call.startedAt = Date.now();
        call.timers.push(setInterval(renderStatus, 1000));
      }
      call.status = 'active';
      renderCall();
    } else if (s === 'disconnected') {
      call.status = 'reconnecting';
      renderStatus();
      clearTimeout(call.dropTimer);
      call.dropTimer = setTimeout(() => { if (call?.pc === pc) { ctx.toast('Call dropped', 'error'); hangUp('ended'); } }, RECONNECT_FOR);
    } else if (s === 'failed') {
      ctx.toast(call.startedAt ? 'Call dropped' : BLOCKED, 'error', 8000);
      hangUp('ended');
    }
  };
}

function flushCandidates() {
  const id = call.id;
  for (const c of call.localCands.splice(0)) {
    F.setDoc(F.doc(candRef(id)), { from: ctx.uid, c }).catch(() => {});
  }
}

function listenCandidates() {
  const id = call.id;
  call.unsubs.push(F.onSnapshot(F.query(candRef(id), F.where('from', '==', call.peer)), (snap) => {
    if (call?.id !== id) return;
    for (const ch of snap.docChanges()) {
      if (ch.type !== 'added') continue;
      const cand = JSON.parse(ch.doc.data().c);
      if (call.pc?.remoteDescription) call.pc.addIceCandidate(cand).catch(() => {});
      else call.remoteCands.push(cand);
    }
  }, () => {}));
}

function flushRemoteCandidates() {
  for (const c of call?.remoteCands.splice(0) || []) call.pc.addIceCandidate(c).catch(() => {});
}

function failed(e) {
  console.error(e);
  const denied = e?.name === 'NotAllowedError';
  ctx?.toast(denied ? 'Allow microphone access to make calls' : "Couldn't start the call", 'error', 5000);
  if (call) hangUp('ended');
}

// Ends the call on this side; `remote` means the other person already ended it.
function hangUp(status = 'ended', remote = false) {
  const c = call;
  if (!c) return;
  call = null;
  stopCaptions(c);
  c.unsubs.forEach((u) => u());
  c.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
  clearTimeout(c.dropTimer);
  try { c.dc?.close(); } catch { /* already closed */ }
  c.pc?.close();
  c.local?.getTracks().forEach((t) => t.stop());
  $('#callRoot .call')?.remove();
  if (!remote && c.created) {
    F.updateDoc(callRef(c.id), { status: c.answered && status === 'missed' ? 'ended' : status, endedAt: F.serverTimestamp() }).catch(() => {});
  }
  // The caller leaves one note in the chat so both people see the call happened.
  if (c.role === 'caller' && c.created) {
    ctx?.onLog(c.chatId, c.startedAt ? `started a video call · ${duration(Date.now() - c.startedAt)}` : 'tried to video call');
  }
}

// ============================================================================
// Captions
// ============================================================================
// The data channel carries tiny JSON messages: {k:'cap', id, text, final}, plus mic/camera/caption state.
function wireChannel(dc) {
  dc.onopen = () => {
    sendState();
    startCaptions();
  };
  dc.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (!call) return;
    if (m.k === 'cap') showCaption('them', m.id, String(m.text || '').slice(0, 500), !!m.final);
    else if (m.k === 'state') {
      Object.assign(call, { peerMic: !!m.mic, peerCam: !!m.cam, peerCC: !!m.cc });
      if (!m.mic) showCaption('them', 'muted', '', true);
      renderCall();
    }
  };
}

const send = (m) => { if (call?.dc?.readyState === 'open') call.dc.send(JSON.stringify(m)); };
const sendState = () => send({ k: 'state', mic: call.micOn, cam: call.camOn, cc: !!SR && !call.ccBroken });

async function startCaptions() {
  if (!call || call.rec || !call.micOn) return;
  if (!SR) return;
  const c = call;
  const rec = new SR();
  c.rec = rec;
  rec.lang = navigator.language || 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  // Newer Chrome can listen to the call's own microphone track (already echo-cancelled, so the
  // other person's voice from the speakers isn't captioned as yours) and run on the device.
  let useTrack = true;
  try {
    if (SR.available && 'processLocally' in rec) {
      const local = await SR.available({ langs: [rec.lang], processLocally: true });
      if (local === 'available') rec.processLocally = true;
    }
  } catch { /* not supported: use the browser's normal recognition */ }
  let n = 0;
  let utter = `${Date.now()}`;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const text = r[0].transcript.trim();
      if (!text) continue;
      if (r.isFinal) {
        emit(utter, text, true);
        utter = `${Date.now()}-${++n}`;
      } else interim += ` ${text}`;
    }
    if (interim.trim()) emit(utter, interim.trim(), false);
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      rec.dead = true;
      c.ccBroken = true;
      if (call === c) sendState();
    } else if (e.error === 'audio-capture' && useTrack) useTrack = false;
  };
  // Recognition stops after a pause or about a minute; restart it so captions never go quiet.
  rec.onend = () => {
    if (call !== c || c.rec !== rec || rec.dead || !c.micOn) { if (c.rec === rec) c.rec = null; return; }
    rec.restarts = (rec.restarts || 0) + 1;
    setTimeout(() => listen(), rec.restarts > 20 ? 1500 : 150);
  };
  const listen = () => {
    if (call !== c || c.rec !== rec) return;
    try { rec.start(useTrack ? c.local.getAudioTracks()[0] : undefined); } catch {
      if (useTrack) { useTrack = false; try { rec.start(); } catch { /* already running */ } }
    }
  };
  // Restarts count against a stuck engine only; a good stretch of speech resets the count.
  c.timers.push(setInterval(() => { rec.restarts = 0; }, 60e3));
  listen();
}

function emit(id, text, final) {
  if (!call) return;
  text = text.charAt(0).toUpperCase() + text.slice(1);
  send({ k: 'cap', id, text, final });
  showCaption('me', id, text, final);
}

function stopCaptions(c = call) {
  const rec = c?.rec;
  if (!rec) return;
  c.rec = null;
  rec.onend = null;
  try { rec.abort(); } catch { /* not running */ }
}

// Up to two recent lines per person; the line still being spoken updates in place.
function showCaption(who, id, text, final) {
  const lines = call.captions;
  const key = `${who}:${id}`;
  if (!text) { for (const k of [...lines.keys()]) if (k.startsWith(`${who}:`) && !lines.get(k).final) lines.delete(k); }
  else lines.set(key, { who, text, final, at: Date.now() });
  const mine = [...lines.keys()].filter((k) => k.startsWith(`${who}:`));
  while (mine.length > 2) lines.delete(mine.shift());
  renderCaptions();
  clearTimeout(call.capTimer);
  call.capTimer = setTimeout(pruneCaptions, CAPTION_HOLD + 100);
}

function pruneCaptions() {
  if (!call) return;
  const now = Date.now();
  for (const [k, l] of call.captions) if (now - l.at > (l.final ? CAPTION_HOLD : CAPTION_HOLD * 2)) call.captions.delete(k);
  renderCaptions();
  if (call.captions.size) call.capTimer = setTimeout(pruneCaptions, 1000);
}

// ============================================================================
// Controls
// ============================================================================
function toggleMic() {
  call.micOn = !call.micOn;
  call.local?.getAudioTracks().forEach((t) => { t.enabled = call.micOn; });
  if (call.micOn) startCaptions();
  else { stopCaptions(); showCaption('me', 'muted', '', true); }
  sendState();
  renderControls();
}

function toggleCam() {
  const tracks = call.local?.getVideoTracks() || [];
  if (!tracks.length) return ctx.toast('No camera on this device');
  call.camOn = !call.camOn;
  tracks.forEach((t) => { t.enabled = call.camOn; });
  sendState();
  renderCall();
}

function toggleCC() {
  call.ccOn = !call.ccOn;
  setPref('cc', call.ccOn ? 'on' : 'off');
  renderCall();
}

// ============================================================================
// UI
// ============================================================================
function pref(k) { try { return localStorage.getItem(`bubbles.${k}`); } catch { return null; } }
function setPref(k, v) { try { localStorage.setItem(`bubbles.${k}`, v); } catch { /* private mode */ } }
const duration = (t) => { const s = Math.floor(t / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// Like FaceTime: the incoming call fills the screen with your own camera already on behind it.
function showRing() {
  const inc = ringing;
  const u = ctx.user(inc.from);
  const el = document.createElement('div');
  el.className = 'ring-screen';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-label', `Incoming video call from ${u.displayName || 'a friend'}`);
  el.innerHTML = `
    <div class="call-peer">${avatar(u, 120)}</div>
    <video class="ring-cam" autoplay playsinline muted hidden></video>
    <header class="call-top"><b>${esc(u.displayName || 'Someone')}</b><span>Bubbles Video…</span></header>
    <div class="ring-actions">
      <span><button class="call-btn big end" data-call="decline" title="Decline">${I.phoneOff}</button>Decline</span>
      <span><button class="call-btn big accept" data-call="accept" title="Accept">${I.video}</button>Accept</span>
    </div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-call]');
    if (b) (b.dataset.call === 'accept' ? accept : decline)();
  });
  $('#callRoot').append(el);
  N.startRing();
  if (document.visibilityState !== 'visible') {
    N.notify({ title: `${u.displayName || 'Someone'} is calling`, body: 'Video call · open Bubbles to answer', chatId: inc.chatId, messageId: `call-${inc.id}` });
  }
  // Only turn the camera on by itself if it was allowed before; never pop a permission prompt mid-ring.
  navigator.permissions?.query({ name: 'camera' }).then(async (p) => {
    if (p.state !== 'granted') return;
    const stream = await openCamera();
    if (ringing !== inc) return stream.getTracks().forEach((t) => t.stop());
    inc.preview = stream;
    const v = $('.ring-cam', el);
    v.srcObject = stream;
    v.hidden = false;
  }).catch(() => {});
}

function dismissRing() {
  ringing?.preview?.getTracks().forEach((t) => t.stop());
  ringing = null;
  N.stopRing();
  $('#callRoot .ring-screen')?.remove();
}

function renderCall() {
  if (!call) return;
  let el = $('#callRoot .call');
  if (!el) {
    el = document.createElement('div');
    el.className = 'call';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Video call');
    el.innerHTML = `
      <video id="callRemote" class="call-remote" autoplay playsinline></video>
      <div class="call-peer" id="callPeer"></div>
      <header class="call-top"><b id="callName"></b><span id="callStatus"></span></header>
      <video id="callLocal" class="call-local" autoplay playsinline muted></video>
      <div class="call-cc" id="callCC" aria-live="polite"></div>
      <div class="call-bar" id="callBar"></div>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-call]');
      if (!b || !call) return;
      ({ mic: toggleMic, cam: toggleCam, cc: toggleCC, end: () => hangUp(call.answered ? 'ended' : 'missed') })[b.dataset.call]?.();
    });
    $('#callRoot').append(el);
    if (call.local) $('#callLocal').srcObject = call.local;
    dragPip($('#callLocal'), el);
  }
  const u = ctx.user(call.peer);
  const live = call.status === 'active' || call.status === 'reconnecting';
  el.classList.toggle('live', live);
  el.classList.toggle('self-off', !call.camOn);
  el.dataset.corner = call.corner;
  $('#callName').textContent = u.displayName || 'Call';
  // Like FaceTime, your own camera fills the screen until they pick up. Their picture shows
  // instead when there's nothing to look at: no camera of yours before, or theirs off during.
  const showPeer = live ? !call.peerCam : !call.camOn;
  $('#callPeer').hidden = !showPeer;
  $('#callPeer').innerHTML = showPeer
    ? `${avatar(u, 120)}${live && !call.peerMic ? `<span class="call-flag">${I.micOff} Muted</span>` : ''}` : '';
  $('#callRemote').hidden = !live || showPeer;
  renderStatus();
  renderControls();
  renderCaptions();
}

// Drag your own picture anywhere during a call; it snaps to the nearest corner, like FaceTime.
function dragPip(v, screen) {
  let start = null;
  v.addEventListener('pointerdown', (e) => {
    if (!screen.classList.contains('live')) return;
    start = { x: e.clientX, y: e.clientY };
    v.setPointerCapture(e.pointerId);
    v.classList.add('dragging');
  });
  v.addEventListener('pointermove', (e) => {
    if (start) v.style.translate = `${e.clientX - start.x}px ${e.clientY - start.y}px`;
  });
  const drop = () => {
    if (!start || !call) return;
    start = null;
    v.classList.remove('dragging');
    const r = v.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    v.style.translate = '';
    call.corner = `${cy < innerHeight / 2 ? 't' : 'b'}${cx < innerWidth / 2 ? 'l' : 'r'}`;
    setPref('pip', call.corner);
    screen.dataset.corner = call.corner;
  };
  v.addEventListener('pointerup', drop);
  v.addEventListener('pointercancel', drop);
}

function renderStatus() {
  const el = $('#callStatus');
  if (!el || !call) return;
  const text = {
    calling: 'Bubbles Video…', connecting: 'Connecting…', reconnecting: 'Reconnecting…',
    active: call.startedAt ? duration(Date.now() - call.startedAt) : '',
  }[call.status];
  el.textContent = `${text}${call.status === 'active' && !call.peerMic ? ' · they\'re muted' : ''}`;
}

function renderControls() {
  const bar = $('#callBar');
  if (!bar || !call) return;
  bar.innerHTML = `
    <button class="call-btn ${call.micOn ? '' : 'off'}" data-call="mic" title="${call.micOn ? 'Mute' : 'Unmute'}" aria-pressed="${!call.micOn}">${call.micOn ? I.mic : I.micOff}</button>
    <button class="call-btn ${call.camOn ? '' : 'off'}" data-call="cam" title="${call.camOn ? 'Turn camera off' : 'Turn camera on'}" aria-pressed="${!call.camOn}">${call.camOn ? I.video : I.videoOff}</button>
    <button class="call-btn ${call.ccOn ? 'on' : ''}" data-call="cc" title="${call.ccOn ? 'Hide captions' : 'Show captions'}" aria-pressed="${call.ccOn}">${I.cc}</button>
    <button class="call-btn end" data-call="end" title="${call.answered ? 'End call' : 'Cancel'}">${I.phoneOff}</button>`;
}

function renderCaptions() {
  const box = $('#callCC');
  if (!box || !call) return;
  const live = call.status === 'active' || call.status === 'reconnecting';
  box.hidden = !call.ccOn || !live;
  if (box.hidden) return;
  const lines = [...call.captions.values()].sort((a, b) => a.at - b.at).slice(-3);
  let note = '';
  if (!SR) note = 'Your browser can\'t make captions of your voice. Chrome or Edge can.';
  else if (!call.peerCC) note = `${esc(ctx.user(call.peer).displayName || 'They')}'s browser can't make captions. Chrome or Edge can.`;
  box.innerHTML = lines.length || note
    ? `${lines.map((l) => `<p class="cc-line ${l.who} ${l.final ? '' : 'interim'}"><b>${l.who === 'me' ? 'You' : esc(ctx.user(call.peer).displayName || 'Them')}</b> ${esc(l.text)}</p>`).join('')}${note ? `<p class="cc-note">${note}</p>` : ''}`
    : '<p class="cc-note">Captions are on. Start talking.</p>';
}
