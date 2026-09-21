var MixxxLrc = {};

MixxxLrc.encode = function (payload) {
  var bytes = [];
  var text = JSON.stringify(payload);
  for (var index = 0; index < text.length; index += 1) {
    var code = text.charCodeAt(index);
    bytes.push(code & 0x7f, (code >> 7) & 0x7f, (code >> 14) & 0x7f);
  }
  return bytes;
};

MixxxLrc.round = function (value, places) {
  var factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
};

// file_key is documented as "detected key of the loaded track" (range not specified), so only trust
// values in the 1-24 Mixxx key table; anything else counts as "unknown".
MixxxLrc.readKey = function (group) {
  var key = engine.getValue(group, 'file_key');
  return key >= 1 && key <= 24 && Math.floor(key) === key ? key : 0;
};

MixxxLrc.sendState = function () {
  var group = '[Channel1]';
  var duration = engine.getValue(group, 'duration');
  var payload = {
    type: 'state',
    version: 2,
    title: '',
    loaded: engine.getValue(group, 'track_loaded') > 0,
    position: MixxxLrc.round(engine.getValue(group, 'playposition') * duration, 3),
    duration: MixxxLrc.round(duration, 3),
    playing: engine.getValue(group, 'play'),
    // Original file values (file_bpm / file_key), not the rate- or pitch-adjusted bpm / key controls.
    // 0 means "not detected yet".
    bpm: MixxxLrc.round(engine.getValue(group, 'file_bpm') || 0, 2),
    key: MixxxLrc.readKey(group),
  };
  var data = [0xf0].concat(MixxxLrc.encode(payload), [0xf7]);
  midi.sendSysexMsg(data, data.length);
};

MixxxLrc.decode = function (data) {
  var text = '';
  for (var index = 1; index < data.length - 1; index += 3) {
    text += String.fromCharCode(data[index] | (data[index + 1] << 7) | (data[index + 2] << 14));
  }
  return JSON.parse(text);
};

MixxxLrc.incoming = function (data) {
  try {
    var payload = MixxxLrc.decode(data);
    if (payload.type === 'seek') {
      console.log('mixxx-lrc seek', JSON.stringify(payload));
      engine.setValue('[Channel1]', 'playposition', payload.position);
    }
  } catch (error) {
    console.log('mixxx-lrc bridge message rejected', error);
  }
};

// Older copies of the mapping XML bind the handler as MixxxLrc.incomingData; keep that name working.
MixxxLrc.incomingData = MixxxLrc.incoming;

MixxxLrc.init = function () {
  MixxxLrc.sendState();
  MixxxLrc.timer = engine.beginTimer(200, MixxxLrc.sendState);
};

MixxxLrc.shutdown = function () {
  if (MixxxLrc.timer) engine.stopTimer(MixxxLrc.timer);
};