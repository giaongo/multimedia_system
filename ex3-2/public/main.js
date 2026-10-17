'use strict';
//
// CS-E4265 A3.2 — the part you write.
//
// Fill in the two functions below. Everything else in this assignment is provided: the
// signaling service, this page, and the grader's peer.
//
// ## The contract
//
// `connect(signalingUrl)` is called once. When it returns, or shortly after, your peer must
// be on its way to a working connection: joined to the signaling room, sending your camera,
// and ready to receive the other peer's.
//
// `stats()` is called repeatedly, and must return an object with these three fields, read
// from the connection's own statistics:
//
//     { roundTripTimeMs: <number>, incomingBitrateKbps: <number>, packetsLost: <number> }
//
// Return zeros before there is anything to report. Do not compute them from wall-clock timing
// of your own -- they come from RTCPeerConnection.getStats().
//
// ## What the signaling service gives you
//
// It is a relay and nothing more. It never looks inside a message.
//
//     socket.emit('create or join', 'foo')   ask to be put in the room
//     socket.on('created', fn)               you are the first peer in it
//     socket.on('joined', fn)                you are the second
//     socket.on('ready', fn)                 both peers are present
//     socket.emit('message', obj)            send obj to the other peer
//     socket.on('message', fn)               receive one
//
// Whoever is in the room *first* has to make the offer, because the second peer has nothing
// to answer until it arrives. So: `created` makes you the peer that offers; wait for `ready`
// before offering, since until then there is nobody to answer; and every `message` is an
// offer, an answer or an ICE candidate from the other side, told apart by its `type` field
// ("offer" / "answer") or its `candidate` field. Add your tracks to the connection before
// you create the offer, or the offer describes no media.
//
// `created`, `joined` and `ready` can arrive **more than once**. The service re-assigns the
// roles every time the room's membership changes, because a peer leaving can change which of
// you is first and so which of you has to offer. Treat a role event that arrives after you
// have already started negotiating as a fresh start: close the RTCPeerConnection you built,
// forget the candidates you were holding, and negotiate again from the new role. A client
// that offers only once can be left waiting on a peer that is no longer there.
//
// ## Hints
//
//  - `navigator.mediaDevices.getUserMedia({audio: true, video: true})` opens the camera. It
//    needs a secure context, so test against your deployed HTTPS URL rather than a plain
//    http:// one.
//  - An `RTCPeerConnection` needs a STUN server to discover its own address from behind NAT.
//    `stun:stun.l.google.com:19302` will do.
//  - ICE candidates arrive asynchronously, after the offer or answer has been sent. They have
//    to go through signaling too. They can also arrive from the other peer *before* its offer
//    or answer does, and `addIceCandidate` throws until a remote description is set: keep the
//    early ones and add them once it is.
//  - `getStats()` reports `bytesReceived` as a running total, not a rate. A bitrate needs two
//    readings and the time between them, so keep the previous sample and return 0 on the
//    first call. The grader calls `stats()` several times for exactly this reason.
//  - `getStats()` returns a map of report objects. The ones you want here are the
//    `inbound-rtp` report for the incoming video and the `candidate-pair` report whose state
//    is `succeeded`. The API, on MDN:
//      https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats
//      https://developer.mozilla.org/en-US/docs/Web/API/RTCInboundRtpStreamStats
//          (bytesReceived, packetsLost, timestamp)
//      https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidatePairStats
//          (currentRoundTripTime, in seconds)
//    and for the connection itself:
//      https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection
//          (createOffer, createAnswer, setLocalDescription, setRemoteDescription,
//           addIceCandidate, the icecandidate and track events)
//      https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
//  - Chrome's `chrome://webrtc-internals` shows you the same statistics live, which is the
//    fastest way to see whether your connection is doing what you think.

var pc = null;             // your RTCPeerConnection
var localStream = null;    // your camera
var socket = null;         // the signaling channel

var isInitiator = false;   // true when we were told 'created' and so make the offer
var pendingCandidates = []; // candidates that arrived before the remote description
var prevSample = null;     // previous inbound-rtp reading, for the bitrate

// Throw away any negotiation in progress and build a fresh connection for the current role.
function resetPeer() {
  if (pc) pc.close();
  pendingCandidates = [];
  prevSample = null;
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });

  // Tracks go on before any offer is made, or the offer describes no media.
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('message', e.candidate.toJSON());
  };
  pc.ontrack = (e) => {
    document.querySelector('#remoteVideo').srcObject = e.streams[0];
  };
}

async function flushCandidates() {
  for (const c of pendingCandidates) await pc.addIceCandidate(c);
  pendingCandidates = [];
}

async function sendDescription(desc) {
  await pc.setLocalDescription(desc);
  socket.emit('message', { type: desc.type, sdp: desc.sdp });
}

async function connect(signalingUrl) {
  socket = io(signalingUrl);

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  document.querySelector('#localVideo').srcObject = localStream;

  socket.on('created', () => { isInitiator = true; resetPeer(); });
  socket.on('joined', () => { isInitiator = false; resetPeer(); });

  socket.on('ready', async () => {
    if (!isInitiator) return;
    try {
      await sendDescription(await pc.createOffer());
    } catch (e) {
      console.error('offer failed', e);
    }
  });

  socket.on('message', async (m) => {
    if (!pc) return;
    try {
      if (m.type === 'offer') {
        await pc.setRemoteDescription(m);
        await flushCandidates();
        await sendDescription(await pc.createAnswer());
      } else if (m.type === 'answer') {
        await pc.setRemoteDescription(m);
        await flushCandidates();
      } else if (m.candidate) {
        if (pc.remoteDescription) await pc.addIceCandidate(m);
        else pendingCandidates.push(m);
      }
    } catch (e) {
      // Most likely a message from a negotiation that a role change has already replaced.
      console.warn('ignoring signaling message', m, e);
    }
  });

  socket.emit('create or join', 'foo');
}

async function stats() {
  const zero = { roundTripTimeMs: 0, incomingBitrateKbps: 0, packetsLost: 0 };
  if (!pc) return zero;

  const reports = await pc.getStats();
  let rtt = 0;
  let inbound = null;

  reports.forEach((r) => {
    if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime !== undefined) {
      rtt = r.currentRoundTripTime * 1000;
    } else if (r.type === 'inbound-rtp' && r.kind === 'video') {
      inbound = r;
    }
  });

  if (!inbound) return { ...zero, roundTripTimeMs: rtt };

  // bytesReceived is a running total, so the rate needs the previous reading.
  let kbps = 0;

  const bytes = inbound.bytesReceived || 0;

  if (prevSample) {
    const dBytes = bytes - prevSample.bytes;
    const dMs = inbound.timestamp - prevSample.timestamp;
    if (dBytes >= 0 && dMs > 0) kbps = (dBytes * 8) / dMs;   // bits per ms == kbit/s
  }

  prevSample = { bytes, timestamp: inbound.timestamp };

  return { roundTripTimeMs: rtt, incomingBitrateKbps: kbps, packetsLost: inbound.packetsLost || 0 };
}
