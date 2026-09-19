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

MixxxLrc.sendState = function () {
  var group = '[Channel1]';
  var duration = engine.getValue(group, 'duration');
  var payload = {
    type: 'state',
    version: 1,
    title: '',
    loaded: engine.getValue(group, 'track_loaded') > 0,
    position: engine.getValue(group, 'playposition') * duration,
    duration: duration,
    playing: engine.getValue(group, 'play'),
  };
  var data = [0xf0].concat(MixxxLrc.encode(payload), [0xf7]);
  console.log('mixxx-lrc state', JSON.stringify(payload));
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

MixxxLrc.init = function () {
  MixxxLrc.sendState();
  MixxxLrc.timer = engine.beginTimer(200, MixxxLrc.sendState);
};

MixxxLrc.shutdown = function () {
  if (MixxxLrc.timer) engine.stopTimer(MixxxLrc.timer);
};